import { fetchJson } from '../lib/http.js';
import { leagueByKey, leagueName } from '../catalog.js';
import { t } from '../lib/i18n.js';

// Playoff brackets: NBA, NHL, NFL (ESPN), MLB (MLB Stats API) and the Champions League / Europa
// League knockouts (ESPN), shown only while that postseason is on.
//
// One shape for all of them:
//   { key, name, sport, rounds: [{ name, matchups: [{ id, conf, a, b, summary, winner, live, next }] }] }
// where a/b = { id, name, abbr, logo, wins?, score? } and `wins` counts games won in a series,
// `score` is the aggregate of a two-legged tie or the score of a single game.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const MLB = 'https://statsapi.mlb.com/api/v1';

// North American postseasons (months, 1-12): outside them nothing is fetched at all.
const WINDOWS = { nba: [4, 5, 6], nhl: [4, 5, 6], nfl: [1, 2], mlb: [9, 10, 11], euroleague: [3, 4, 5, 6], eurocup: [2, 3, 4, 5] };
const PATH = { nba: 'basketball/nba', nhl: 'hockey/nhl', nfl: 'football/nfl' };
const ACTIVE_DAYS = 3; // a bracket shows while a knockout game is within this many days
// Knockout competitions on ESPN: cups, continental and national-team tournaments (not qualifiers,
// friendlies or plain leagues). Their rounds come as season slugs ("round-of-16", "third-round").
const KNOCKOUT_KINDS = new Set(['cup', 'continental', 'national']);
const NOT_KNOCKOUT = /group|league-phase|regular|qualif.*group|^league$/;
const SKIP = new Set(['fifa.friendly', 'uefa.euroq', 'fifa.worldq.uefa', 'fifa.worldq.conmebol', 'fifa.worldq.concacaf', 'fifa.worldq.afc', 'fifa.worldq.caf', 'uefa.nations']);
const MAX_COLUMNS = 5;
const MAX_FIRST = 8; // leading rounds with more ties than this are left out (FA Cup third round…)

const team = (c) => ({ id: String(c.team?.id ?? c.id), name: c.team?.shortDisplayName || c.team?.displayName || c.team?.name || '?', abbr: c.team?.abbreviation || '', logo: c.team?.logo || c.team?.logos?.[0]?.href || null });
const yyyymm = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export class BracketService {
  constructor({ store, followed = () => [], homes = () => [], providers = {} }) {
    this.store = store;
    this.followed = followed; // league keys followed
    this.homes = homes; // league keys your teams play in
    this.providers = providers; // espn (calendars), euroleague
    this.months = new Map(); // `${key}|YYYYMM` → events (past months never change)
  }

  /** Is this a competition with a bracket? (US playoffs, MLB, EuroLeague/EuroCup, cups and tournaments.) */
  static kind(key) {
    if (key === 'mlb') return 'mlb';
    if (PATH[key]) return 'series';
    if (key === 'euroleague' || key === 'eurocup') return 'euroleague';
    const l = leagueByKey(key);
    if (l?.provider === 'espn' && KNOCKOUT_KINDS.has(l.kind) && !SKIP.has(key)) return 'knockout';
    return null;
  }

  /** Leagues worth checking now: followed or played by a favourite, and in season. */
  leagues(now = new Date()) {
    const wanted = [...new Set([...this.followed(), ...this.homes()])];
    return wanted.filter((k) => {
      const kind = BracketService.kind(k);
      if (!kind) return false;
      return kind === 'knockout' || WINDOWS[k].includes(now.getUTCMonth() + 1);
    });
  }

  /**
   * A cup only gets a bracket around its rounds: its ESPN calendar (known from the live poller, or
   * one scoreboard request) must have a match day within ACTIVE_DAYS, otherwise nothing is fetched.
   */
  async cupIsOn(key) {
    const espn = this.providers.espn;
    if (!espn?.matchDays) return true;
    let days = espn.matchDays(key);
    if (!days) {
      await espn.getScoreboard(key).catch(() => null);
      days = espn.matchDays(key);
    }
    if (!days) return false;
    const now = Date.now();
    for (const d of days) {
      const t0 = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), 12);
      if (Math.abs(t0 - now) <= (ACTIVE_DAYS + 0.5) * 864e5) return true;
    }
    return false;
  }

  async all() {
    const out = [];
    for (const key of this.leagues()) {
      try {
        const kind = BracketService.kind(key);
        let b = null;
        if (kind === 'mlb') b = await this.mlb();
        else if (kind === 'series') b = await this.espnSeries(key);
        else if (kind === 'euroleague') b = await this.euroleague(key);
        else if (await this.cupIsOn(key)) b = await this.knockouts(key);
        if (b && b.rounds.length && isActive(b)) out.push(trim(b));
      } catch (err) {
        console.warn(`[brackets] ${key}:`, err.message);
      }
    }
    return { brackets: out };
  }

  /** ESPN events, month by month (finished months are kept): the postseason months, or for a
   *  cup the last 10 months (a season's rounds). */
  async espnEvents(key) {
    const now = new Date();
    const path = PATH[key] || `${leagueByKey(key)?.sport === 'basketball' ? 'basketball' : 'soccer'}/${key}`;
    const months = [];
    if (WINDOWS[key]) {
      for (const m of WINDOWS[key]) if (m <= now.getUTCMonth() + 1) months.push(`${now.getUTCFullYear()}${String(m).padStart(2, '0')}`);
    } else {
      for (let i = 9; i >= 0; i--) months.push(yyyymm(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15))));
    }
    const events = [];
    for (const ym of months) {
      const cacheKey = `${key}|${ym}`;
      if (this.months.has(cacheKey)) {
        events.push(...this.months.get(cacheKey));
        continue;
      }
      const d = await fetchJson(`${ESPN}/${path}/scoreboard?dates=${ym}&limit=500`);
      const list = d.events || [];
      // A past month is final once every game in it is: right after the 1st (UTC) US games from
      // the last night can still be live, and caching them then would freeze them until a restart.
      const done = list.every((e) => ['post', 'postponed', 'canceled'].includes(e.status?.type?.state) || /postponed|canceled/i.test(e.status?.type?.name || ''));
      if (ym < yyyymm(now) && done) this.months.set(cacheKey, list);
      events.push(...list);
    }
    return events;
  }

  /** NBA, NHL, NFL: playoff games grouped into series, rounds from ESPN's notes ("East 2nd Round - Game 3"). */
  async espnSeries(key) {
    // Postseason games, minus exhibitions that ESPN files there too (the NFL's Pro Bowl).
    const games = (await this.espnEvents(key)).filter((e) => e.season?.type === 3 && !/pro bowl|all-star/i.test(e.competitions?.[0]?.notes?.[0]?.headline || e.name || ''));
    if (!games.length) return null;
    const series = new Map();
    const stageFirst = new Map();
    for (const e of games.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
      const c = e.competitions?.[0];
      const comps = c?.competitors || [];
      if (comps.length !== 2) continue;
      const headline = c.notes?.[0]?.headline || e.name || '';
      const label = headline.replace(/\s*-\s*Game \d+$/i, '').trim();
      const conf = label.match(/^(East|West|Eastern|Western|AFC|NFC)\b/)?.[1] || null;
      const stage = (conf ? label.slice(conf.length) : label).trim() || label;
      if (!stageFirst.has(stage)) stageFirst.set(stage, Date.parse(e.date));
      const [x, y] = comps.map(team).sort((p, q) => p.id.localeCompare(q.id));
      const id = `${stage}|${conf}|${x.id}|${y.id}`;
      const s = series.get(id) || { id, stage, conf, a: x, b: y, games: [] };
      s.games.push(e);
      series.set(id, s);
    }
    const rounds = [...stageFirst.entries()]
      .sort((p, q) => p[1] - q[1])
      .map(([stage]) => ({
        name: stage,
        matchups: [...series.values()]
          .filter((s) => s.stage === stage)
          .sort((p, q) => String(p.conf).localeCompare(String(q.conf)))
          .map((s) => espnMatchup(s, key === 'nfl')),
      }));
    return { key, name: leagueName(key), sport: leagueByKey(key)?.sport, rounds };
  }

  /** Cups and tournaments: knockout ties (one game or two legs with an aggregate), rounds by date. */
  async knockouts(key) {
    const games = (await this.espnEvents(key)).filter((e) => e.season?.slug && !NOT_KNOCKOUT.test(e.season.slug));
    if (!games.length) return null;
    const ties = new Map();
    const firstDate = new Map();
    for (const e of games.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
      const c = e.competitions?.[0];
      const comps = c?.competitors || [];
      if (comps.length !== 2) continue;
      const stage = e.season.slug;
      if (!firstDate.has(stage)) firstDate.set(stage, Date.parse(e.date));
      const [x, y] = comps.map(team).sort((p, q) => p.id.localeCompare(q.id));
      const id = `${stage}|${x.id}|${y.id}`;
      const tie = ties.get(id) || { id, stage, a: { ...x, score: 0 }, b: { ...y, score: 0 }, played: 0, games: [], winner: null };
      const state = e.status?.type?.state;
      if (state !== 'pre') {
        for (const comp of comps) {
          const side = String(comp.team?.id) === tie.a.id ? tie.a : tie.b;
          side.score += Number(comp.score ?? 0);
        }
        if (state === 'post') tie.played++;
      }
      // Who goes through: ESPN's series flag, "advance" on a competitor, or (one-off ties, even on
      // penalties) the match winner once it's over.
      const adv = c.series?.competitors?.find((x2) => x2.winner) || comps.find((x2) => x2.advance) || (state === 'post' && !c.series?.totalCompetitions ? comps.find((x2) => x2.winner) : null) || (state === 'post' && c.series?.totalCompetitions === 1 ? comps.find((x2) => x2.winner) : null);
      if (adv) tie.winner = String(adv.id ?? adv.team?.id) === tie.a.id ? 'a' : 'b';
      tie.games.push(e);
      ties.set(id, tie);
    }
    const rounds = [...firstDate.entries()]
      .sort((p, q) => p[1] - q[1])
      .map(([st]) => ({
        name: stageName(st),
        matchups: [...ties.values()]
          .filter((x) => x.stage === st)
          .map((x) => {
            const next = x.games.find((e) => e.status?.type?.state === 'pre');
            const live = x.games.some((e) => e.status?.type?.state === 'in');
            const legs = x.games.length;
            const champ = st === 'final';
            const summary = x.winner ? t(champ ? 'brackets.winner' : 'brackets.through', { team: (x.winner === 'a' ? x.a : x.b).name }) : x.played && legs > 1 ? t('brackets.aggregate', { a: x.a.score, b: x.b.score }) : null;
            return { id: x.id, conf: null, a: x.played ? x.a : { ...x.a, score: undefined }, b: x.played ? x.b : { ...x.b, score: undefined }, summary, winner: x.winner, live, next: next ? { start: next.date } : null, last: Date.parse(x.games.at(-1).date) };
          }),
      }));
    return { key, name: leagueName(key), sport: leagueByKey(key)?.sport || 'soccer', rounds };
  }

  /** EuroLeague (play-in, playoffs, Final Four) and EuroCup (8F → Final): the end of the season. */
  async euroleague(key) {
    const el = this.providers.euroleague;
    if (!el?.seasonTail) return null;
    const games = await el.seasonTail(key);
    const phases = new Map();
    const series = new Map();
    for (const g of games.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
      if (!phases.has(g.phase)) phases.set(g.phase, Date.parse(g.start));
      const [x, y] = [g.home, g.away].map((s2) => ({ id: String(s2.id), name: s2.name, abbr: s2.abbr || '', logo: s2.logo || null })).sort((p, q) => p.id.localeCompare(q.id));
      const id = `${g.phase}|${x.id}|${y.id}`;
      const m = series.get(id) || { id, phase: g.phase, a: { ...x, wins: 0 }, b: { ...y, wins: 0 }, games: [] };
      if (g.state === 'final') {
        const winnerId = String((g.home.score ?? 0) > (g.away.score ?? 0) ? g.home.id : g.away.id);
        if (winnerId === m.a.id) m.a.wins++;
        else m.b.wins++;
      }
      m.games.push(g);
      series.set(id, m);
    }
    const rounds = [...phases.entries()]
      .sort((p, q) => p[1] - q[1])
      .map(([phase]) => ({
        name: phase,
        matchups: [...series.values()]
          .filter((m) => m.phase === phase)
          .map((m) => {
            const single = m.games.length === 1 && m.games[0].state === 'final';
            const best = Math.max(m.a.wins, m.b.wins);
            const needed = single ? 1 : m.games.length >= 3 || best >= 3 ? 3 : 2;
            const winner = best >= needed ? (m.a.wins > m.b.wins ? 'a' : 'b') : null;
            const live = m.games.some((g) => g.state === 'live' || g.state === 'break');
            const next = m.games.find((g) => g.state === 'pre');
            return { id: m.id, conf: null, a: m.a, b: m.b, summary: winner ? t('brackets.through', { team: (winner === 'a' ? m.a : m.b).name }) : null, winner, live, next: next ? { start: next.start } : null, last: Date.parse(m.games.at(-1).start) };
          }),
      }));
    return { key, name: leagueName(key), sport: 'basketball', rounds };
  }

  /** MLB: the postseason series list, in one request. */
  async mlb() {
    const year = new Date().getUTCFullYear();
    const d = await fetchJson(`${MLB}/schedule/postseason/series?season=${year}&sportId=1&hydrate=team,seriesStatus`);
    const list = d.series || [];
    if (!list.length) return null;
    const ORDER = ['F', 'D', 'L', 'W'];
    const NAMES = { F: 'mlb.series.F', D: 'mlb.series.D', L: 'mlb.series.L', W: 'mlb.series.W' };
    const rounds = ORDER.filter((code) => list.some((x) => x.series?.id?.startsWith(`${code}_`))).map((code) => ({
      name: t(NAMES[code]),
      matchups: list
        .filter((x) => x.series.id.startsWith(`${code}_`))
        .sort((p, q) => p.series.id.localeCompare(q.series.id))
        .map((x) => mlbMatchup(x)),
    }));
    return { key: 'mlb', name: 'MLB', sport: 'baseball', rounds };
  }
}

function espnMatchup(s, singleGame) {
  const last = s.games.at(-1);
  const c = last.competitions[0];
  const live = s.games.some((e) => e.status?.type?.state === 'in');
  const next = s.games.find((e) => e.status?.type?.state === 'pre');
  const side = (x) => {
    const comp = c.competitors.find((k) => String(k.team?.id) === x.id) || {};
    const inSeries = c.series?.competitors?.find((k) => String(k.id) === x.id);
    return { ...x, wins: singleGame ? undefined : inSeries?.wins ?? 0, score: singleGame && last.status?.type?.state !== 'pre' ? Number(comp.score ?? 0) : undefined, won: comp.winner || inSeries?.winner };
  };
  const a = side(s.a);
  const b = side(s.b);
  const done = singleGame ? last.status?.type?.state === 'post' : !!c.series?.completed;
  const winner = done ? (a.won ? 'a' : b.won ? 'b' : (a.wins ?? a.score) > (b.wins ?? b.score) ? 'a' : 'b') : null;
  delete a.won;
  delete b.won;
  return { id: s.id, conf: s.conf, a, b, summary: singleGame ? null : c.series?.summary || null, winner, live, next: next ? { start: next.date } : null, last: Date.parse(last.date) };
}

function mlbMatchup(x) {
  const games = x.games || [];
  const g = games.at(-1) || {};
  const pick = (side) => ({
    id: String(g.teams?.[side]?.team?.id ?? side),
    name: g.teams?.[side]?.team?.teamName || g.teams?.[side]?.team?.name || '?',
    abbr: g.teams?.[side]?.team?.abbreviation || '',
    logo: g.teams?.[side]?.team?.id ? `https://www.mlbstatic.com/team-logos/${g.teams[side].team.id}.svg` : null,
    wins: 0,
  });
  const a = pick('away');
  const b = pick('home');
  for (const game of games) {
    if (game.status?.abstractGameState !== 'Final') continue;
    const winnerId = String(game.teams?.away?.isWinner ? game.teams.away.team.id : game.teams?.home?.isWinner ? game.teams.home.team.id : '');
    if (winnerId === a.id) a.wins++;
    else if (winnerId === b.id) b.wins++;
  }
  const st = g.seriesStatus || {};
  const winner = st.isOver || st.winningTeam ? (String(st.winningTeam?.id) === a.id ? 'a' : 'b') : null;
  const live = games.some((x) => x.status?.abstractGameState === 'Live');
  const next = games.find((x) => x.status?.abstractGameState === 'Preview');
  const conf = /^AL\b/.test(g.seriesDescription || '') ? 'AL' : /^NL\b/.test(g.seriesDescription || '') ? 'NL' : null;
  return { id: x.series.id, conf, a, b, summary: st.result || null, winner, live, next: next ? { start: next.gameDate } : null, last: Date.parse(g.gameDate) };
}

/** "round-of-16" → translated name if known, else "Round of 16". */
function stageName(slug) {
  const key = `brackets.stages.${slug}`;
  const name = t(key);
  if (name !== key) return name;
  return slug.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Fit the screen: at most MAX_COLUMNS rounds, starting at a round with at most MAX_FIRST ties. */
export function trim(b) {
  let rounds = b.rounds;
  // Also drop a leading round smaller than the next one (a leftover game from an earlier round).
  while (rounds.length > 1 && (rounds.length > MAX_COLUMNS || rounds[0].matchups.length > MAX_FIRST || rounds[0].matchups.length < rounds[1].matchups.length)) rounds = rounds.slice(1);
  return { ...b, rounds };
}

/** A bracket is shown while one of its games is within ACTIVE_DAYS of today. */
function isActive(b) {
  const now = Date.now();
  const near = (ms) => ms != null && Math.abs(ms - now) < ACTIVE_DAYS * 864e5;
  return b.rounds.some((r) => r.matchups.some((m) => m.live || near(m.last) || near(m.next && Date.parse(m.next.start))));
}
