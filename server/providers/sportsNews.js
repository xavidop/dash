import { fetchJson, fetchText, settleAll } from '../lib/http.js';
import { t } from '../lib/i18n.js';
import { parser, asArray, text, stripHtml, tokens, similarity } from './news.js';
import { leagueByKey } from '../catalog.js';
import { norm } from './sports/provider.js';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const MAX_AGE = 72 * 3600e3;

/** ESPN sport path for a catalog competition. */
function espnPath(key) {
  const l = leagueByKey(key);
  if (!l) return null;
  if (l.provider === 'mlb') return 'baseball/mlb';
  if (l.provider !== 'espn') return null;
  return `${{ soccer: 'soccer', basketball: 'basketball', football: 'football', hockey: 'hockey' }[l.sport] || 'soccer'}/${key}`;
}

/**
 * Sports news about what I follow:
 *  - ESPN news for each favourite's home competition (images, team tags), in my language
 *  - Google News RSS searches for each team / driver / player (localized, very specific)
 * Stories about my teams rank first; near-duplicates are merged.
 */
const ESPN_NEWS = { en: 'us', es: 'es', pt: 'br' };

export class SportsNewsProvider {
  constructor(config) {
    this.language = config.language;
    const locale = config.locale || t('meta.locale') || 'en-US';
    const [, region = 'US'] = locale.split('-');
    // Google News editions: Brazil is "pt-419"; the rest use the bare language.
    this.google = `hl=${locale}&gl=${region}&ceid=${region}:${region === 'BR' ? 'pt-419' : config.language}`;
    this.perTeam = config.sportsNews.perTeam || 4;
  }

  async espnNews(path, max = 12) {
    // ESPN only writes news in English, Spanish and Brazilian Portuguese; other languages rely on
    // Google News rather than mixing English stories in.
    if (!ESPN_NEWS[this.language]) return [];
    const lang = `lang=${this.language}&region=${ESPN_NEWS[this.language]}`;
    const d = await fetchJson(`${ESPN}/${path}/news?limit=${max}&${lang}`);
    return (d.articles || []).map((a) => ({
      id: `espn:${a.id || a.headline}`,
      title: stripHtml(a.headline),
      summary: stripHtml(a.description || '').slice(0, 240),
      image: a.images?.[0]?.url || null,
      source: 'ESPN',
      publishedAt: a.published || a.lastModified || null,
      teamIds: (a.categories || []).filter((c) => c.type === 'team' && c.teamId).map((c) => String(c.teamId)),
      path,
    }));
  }

  async googleNews(query, tag) {
    const xml = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${this.google}`);
    const items = asArray(parser.parse(xml)?.rss?.channel?.item);
    return items.slice(0, this.perTeam * 2).map((it) => {
      const raw = stripHtml(text(it.title));
      // Google News titles end with " - Source".
      const cut = raw.lastIndexOf(' - ');
      const source = text(it.source) || (cut > 0 ? raw.slice(cut + 3) : 'Google News');
      return {
        id: `gn:${text(it.guid) || raw}`,
        title: cut > 0 ? raw.slice(0, cut) : raw,
        summary: '',
        image: null,
        source,
        publishedAt: new Date(text(it.pubDate)).toISOString(),
        tags: [tag],
      };
    });
  }

  /**
   * @param {{teams: {key,name,sport,provider,id,home}[], drivers: {name}[], players: {name}[]}} targets
   */
  async fetch(targets) {
    const tasks = [];
    const paths = new Set();
    for (const t of targets.teams) {
      const p = espnPath(t.home);
      if (p) paths.add(p);
    }
    const leagueByPath = new Map();
    for (const l of targets.leagues || []) {
      const p = espnPath(l.key);
      if (p) {
        paths.add(p);
        leagueByPath.set(p, l);
      }
    }
    if (targets.drivers.length) paths.add('racing/f1');
    for (const p of paths) tasks.push(() => this.espnNews(p));
    for (const t of targets.teams) tasks.push(() => this.googleNews(`"${t.name}"`, { key: t.key, name: t.name }));
    for (const d of targets.drivers.slice(0, 3)) tasks.push(() => this.googleNews(`"${d.name}" F1`, { key: `driver:${d.id}`, name: d.name }));
    for (const p of targets.players.slice(0, 3)) tasks.push(() => this.googleNews(`"${p.name}"`, { key: `player:${p.id}`, name: p.name }));
    for (const l of (targets.leagues || []).slice(0, 4)) tasks.push(() => this.googleNews(`"${l.name}"`, { key: `league:${l.key}`, name: l.name }));

    const results = await settleAll(tasks, 4);
    const ok = results.filter(Boolean);
    if (!ok.length && tasks.length) throw new Error('all sports news sources failed');

    const now = Date.now();
    const byTeamName = targets.teams.map((t) => ({ key: t.key, name: t.name, id: t.id, sport: t.sport, words: norm(t.name) }));
    const items = ok
      .flat()
      .filter((a) => a.title && a.publishedAt && now - Date.parse(a.publishedAt) < MAX_AGE)
      .map((a) => {
        // Tag ESPN stories with my teams (by ESPN team id, or by name in the headline).
        const tags = [...(a.tags || [])];
        for (const t of byTeamName) {
          const idHit = a.teamIds?.includes(String(t.id));
          const nameHit = norm(a.title).includes(t.words);
          if ((idHit || nameHit) && !tags.some((x) => x.key === t.key)) tags.push({ key: t.key, name: t.name });
        }
        // Stories from a followed league's ESPN feed that aren't about one of my teams: tag the league.
        const league = a.path && leagueByPath.get(a.path);
        if (league && !tags.length) tags.push({ key: `league:${league.key}`, name: league.name });
        return { ...a, tags, teamIds: undefined };
      });

    // Dedupe near-identical headlines, keeping the one with an image.
    const kept = [];
    for (const it of items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
      const tk = tokens(it.title);
      // Short headlines share words easily: require a strong overlap on a reasonable number of words.
      const dup = tk.size >= 4 && kept.find((k) => k._tk.size >= 4 && similarity(k._tk, tk) >= 0.75);
      if (dup) {
        if (!dup.image && it.image && !dup.summary) Object.assign(dup, { image: it.image, summary: it.summary });
        for (const tag of it.tags) if (!dup.tags.some((x) => x.key === tag.key)) dup.tags.push(tag);
        continue;
      }
      kept.push({ ...it, _tk: tk });
    }

    // My teams first (each team gets its share), then the rest by recency.
    const mine = kept.filter((k) => k.tags.length);
    const perTag = new Map();
    const picked = [];
    for (const it of mine) {
      const key = it.tags[0].key;
      const n = perTag.get(key) || 0;
      if (n >= this.perTeam) continue;
      perTag.set(key, n + 1);
      picked.push(it);
    }
    const rest = kept.filter((k) => !picked.includes(k));
    const list = [...picked, ...rest].slice(0, 24).map(({ _tk, ...x }) => x);
    return { items: list };
  }
}
