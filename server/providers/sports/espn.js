import { fetchJson, settleAll } from '../../lib/http.js';
import { SportsProvider, pickLastNext, windowRows, norm } from './provider.js';
import { leagueByKey, leagueName, candidateCompetitions, homeLeagueFromEspn } from '../../catalog.js';
import { t, ord, language } from '../../lib/i18n.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports';
const TEAMS_TTL = 24 * 3600e3;
const ACTIVE_WINDOW = 120 * 864e5; // a competition counts if the team played in it in the last ~4 months

// Languages ESPN actually localizes (team names, news); anything else uses the English feed.
const ESPN_LANGS = { en: 'us', es: 'es', pt: 'br' };
const espnQuery = (lang) => (ESPN_LANGS[lang] ? `lang=${lang}&region=${ESPN_LANGS[lang]}` : 'lang=en&region=us');
const langQuery = () => espnQuery(language);
const sportOf = (slug) => leagueByKey(slug)?.sport || 'soccer';
// ESPN path segment per sport (our sport keys match ESPN's).
const pathOf = (slug) => sportOf(slug);
const PERIOD_SPORTS = new Set(['basketball', 'football', 'hockey']);
const PLAYOFF_LEAGUES = new Set(['nba', 'wnba', 'nfl', 'nhl']);

/** ESPN status → normalized state + localized status text. */
function mapStatus(st, sport) {
  const type = st?.type || {};
  const period = st?.period || 0;
  const rawClock = st?.displayClock && st.displayClock !== "0'" && st.displayClock !== '0.0' ? st.displayClock : '';
  switch (type.name) {
    case 'STATUS_HALFTIME':
      return { state: 'break', status: t('status.halftime') };
    case 'STATUS_END_PERIOD':
      if (sport === 'hockey') return { state: 'break', status: period > 3 ? t('status.endOvertime') : t('status.endPeriod', { n: ord(period) }) };
      return { state: 'break', status: period > 4 ? t('status.endOvertime') : t('status.endQuarter', { n: ord(period) }) };
    case 'STATUS_END_OF_REGULATION':
    case 'STATUS_END_OF_EXTRATIME':
      return { state: 'break', status: t('status.endRegulation') };
    case 'STATUS_SHOOTOUT':
      return { state: 'live', status: t('status.shootout') };
    case 'STATUS_POSTPONED':
      return { state: 'postponed', status: t('status.postponed') };
    case 'STATUS_CANCELED':
      return { state: 'canceled', status: t('status.canceled') };
    case 'STATUS_ABANDONED':
    case 'STATUS_SUSPENDED':
      return { state: 'postponed', status: t('status.suspended') };
    case 'STATUS_DELAYED':
      return { state: 'delayed', status: t('status.delayed') };
    case 'STATUS_FINAL_AET':
      return { state: 'final', status: t('status.finalAET') };
    case 'STATUS_FINAL_PEN':
      return { state: 'final', status: t('status.finalPen') };
  }
  if (type.state === 'in') {
    if (sport === 'hockey') {
      const p = period > 4 ? t('status.shootout') : period === 4 ? t('status.overtime') : t('status.period', { n: ord(period) });
      return { state: 'live', status: rawClock && period <= 4 ? `${p} · ${rawClock}` : p };
    }
    if (sport === 'basketball' || sport === 'football') {
      const q = period > 4 ? t('status.overtime') : t('status.quarter', { n: ord(period) });
      return { state: 'live', status: rawClock ? `${q} · ${rawClock}` : q };
    }
    return { state: 'live', status: rawClock || t('status.inPlay') };
  }
  if (type.state === 'post') {
    const ot = sport === 'hockey' ? period > 3 : PERIOD_SPORTS.has(sport) && period > 4;
    if (sport === 'hockey' && period > 4) return { state: 'final', status: t('status.finalSO') };
    return { state: 'final', status: ot ? t('status.finalOT') : t('status.final') };
  }
  return { state: 'pre', status: '' };
}

function scoreOf(c) {
  const s = c.score;
  if (s == null) return null;
  const v = typeof s === 'object' ? (s.displayValue ?? s.value) : s;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function teamRef(c) {
  const tm = c.team || {};
  return {
    id: String(tm.id),
    name: tm.shortDisplayName || tm.displayName || tm.name || '',
    fullName: tm.displayName || tm.name || '',
    abbr: tm.abbreviation || '',
    logo: tm.logo || tm.logos?.[0]?.href || null,
    color: tm.color ? `#${tm.color}` : null,
    altColor: tm.alternateColor ? `#${tm.alternateColor}` : null,
    score: scoreOf(c),
    winner: c.winner === true,
  };
}

function mapDetails(details, homeId) {
  const events = [];
  for (const d of details || []) {
    if (d.shootout) continue;
    const player = d.athletesInvolved?.[0]?.displayName || d.athletesInvolved?.[0]?.shortName || '';
    const side = String(d.team?.id) === homeId ? 'home' : 'away';
    const minute = d.clock?.displayValue || '';
    if (d.scoringPlay) events.push({ kind: d.ownGoal ? 'own-goal' : d.penaltyKick ? 'penalty' : 'goal', minute, side, player });
    else if (d.redCard) events.push({ kind: 'red', minute, side, player });
    else if (d.yellowCard) events.push({ kind: 'yellow', minute, side, player });
  }
  return events;
}

export function normalizeEvent(e, slug) {
  const c = e.competitions?.[0] || {};
  const comps = c.competitors || [];
  const home = comps.find((x) => x.homeAway === 'home') || comps[0];
  const away = comps.find((x) => x.homeAway === 'away') || comps[1];
  if (!home || !away) return null;
  const leagueSlug = leagueByKey(e.league?.slug) ? e.league.slug : slug;
  const sport = sportOf(slug);
  const st = e.status || c.status;
  const { state, status } = mapStatus(st, sport);
  const h = teamRef(home);
  const a = teamRef(away);
  const game = {
    id: `espn:${leagueSlug}:${e.id}`,
    provider: 'espn',
    sport,
    league: { key: leagueSlug, name: leagueName(leagueSlug, e.league?.shortName || e.league?.name) },
    start: e.date,
    timeTBD: c.timeValid === false,
    state,
    status,
    home: h,
    away: a,
    events: sport === 'soccer' ? mapDetails(c.details, h.id) : [],
    venue: c.venue?.fullName || null,
    // ESPN only lists US channels.
    broadcasts: (c.broadcasts || []).flatMap((b) => (b.names || []).map((name) => ({ name, country: 'US' }))),
    // Playoffs: season type 3, the stage ("West Finals - Game 2") and the series ("Series tied 1-1").
    postseason: e.season?.type === 3,
    stage: e.season?.type === 3 ? c.notes?.[0]?.headline || null : null,
    series: c.series?.type === 'playoff' || e.season?.type === 3 ? c.series?.summary || null : null,
  };
  if (PERIOD_SPORTS.has(sport)) {
    const ls = (x) => (x.linescores || []).map((p) => Number(p.displayValue ?? p.value ?? 0));
    game.periods = { period: st?.period || 0, clock: st?.displayClock || '', quarters: { home: ls(home), away: ls(away) } };
  }
  return game;
}

export class EspnProvider extends SportsProvider {
  constructor() {
    super();
    this.teamLists = new Map(); // slug → { at, teams }
    this.calendars = new Map(); // slug → { at, days: Set<YYYYMMDD> } (match days, from any scoreboard)
    this.boards = new Map(); // slug → { at, games } last plain scoreboard (shared with round panels)
    this.finishedDays = new Map(); // `${slug}|${ymd}` → games, for past days where every game is over
  }

  /** ESPN scoreboards carry the league's calendar: the days with games (or week ranges). */
  rememberCalendar(slug, d) {
    const cal = d.leagues?.[0]?.calendar;
    if (!Array.isArray(cal)) return;
    const days = new Set();
    const ymd = (iso) => String(iso).slice(0, 10).replaceAll('-', '');
    for (const c of cal) {
      if (typeof c === 'string') days.add(ymd(c));
      else
        for (const e of c?.entries || [c]) {
          // Week-style calendars (NFL): every day from start to end.
          const start = Date.parse(e?.startDate);
          const end = Date.parse(e?.endDate || e?.startDate);
          for (let t = start; Number.isFinite(t) && t <= end && days.size < 800; t += 864e5) days.add(new Date(t).toISOString().slice(0, 10).replaceAll('-', ''));
        }
    }
    this.calendars.set(slug, { at: Date.now(), days });
  }

  /** Days with games in a competition, if ESPN told us (null = unknown). */
  matchDays(slug) {
    const c = this.calendars.get(slug);
    return c && Date.now() - c.at < 24 * 3600e3 ? c.days : null;
  }

  /**
   * When to look at a competition again if nothing is on: the start of its next match day (ESPN
   * days start 07:00 UTC). undefined = no calendar known; null = calendar known, nothing scheduled.
   */
  nextMatchDay(slug, now = Date.now()) {
    const days = this.matchDays(slug);
    if (!days) return undefined;
    let best = null;
    for (const d of days) {
      const t = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), 7);
      if (t > now && (best == null || t < best)) best = t;
    }
    return best;
  }

  /** The plain scoreboard fetched in the last `maxAgeMs` (the live poller's), if any. */
  recentBoard(slug, maxAgeMs = 90e3) {
    const b = this.boards.get(slug);
    return b && Date.now() - b.at < maxAgeMs ? b.games : null;
  }

  /** Teams of a league, for the settings picker and name resolution (localized names). */
  async listTeams(slug) {
    const cached = this.teamLists.get(slug);
    if (cached && Date.now() - cached.at < TEAMS_TTL) return cached.teams;
    const d = await fetchJson(`${SITE}/${pathOf(slug)}/${slug}/teams?${langQuery()}`).catch(() => fetchJson(`${SITE}/${pathOf(slug)}/${slug}/teams`));
    const teams = (d?.sports?.[0]?.leagues?.[0]?.teams || [])
      .map(({ team: tm }) => ({
        id: String(tm.id),
        name: tm.displayName,
        shortName: tm.shortDisplayName || tm.displayName,
        abbr: tm.abbreviation || '',
        aliases: [tm.displayName, tm.shortDisplayName, tm.name, tm.nickname, tm.location].filter(Boolean),
        logo: tm.logos?.[0]?.href || null,
        color: tm.color ? `#${tm.color}` : null,
        altColor: tm.alternateColor ? `#${tm.alternateColor}` : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, language));
    const unique = [...new Map(teams.map((x) => [x.id, x])).values()]; // FIBA lists some teams twice
    this.teamLists.set(slug, { at: Date.now(), teams: unique });
    return unique;
  }

  async resolveTeam(fav) {
    const wanted = [fav.name, fav.displayName, ...(fav.aliases || [])].filter(Boolean).map(norm);
    const find = (list) =>
      list.find((x) => x.aliases.some((a) => wanted.includes(norm(a)))) ||
      list.find((x) => wanted.some((w) => norm(x.name).includes(w) || w.includes(norm(x.name))));
    let list = [];
    try {
      list = await this.listTeams(fav.league);
    } catch (err) {
      throw new Error(`team list ${fav.league}: ${err.message}`);
    }
    let hit = find(list);
    // Names in config.json may be in another language than the display ("España" vs "Spain"):
    // try ESPN's lists in the other languages Dash ships, then use the localized entry by id.
    for (const lang of Object.keys(ESPN_LANGS).filter((l) => espnQuery(l) !== langQuery())) {
      if (hit) break;
      const d = await fetchJson(`${SITE}/${pathOf(fav.league)}/${fav.league}/teams?${espnQuery(lang)}`).catch(() => null);
      const raw = (d?.sports?.[0]?.leagues?.[0]?.teams || []).map(({ team: tm }) => ({
        id: String(tm.id),
        name: tm.displayName,
        aliases: [tm.displayName, tm.shortDisplayName, tm.name, tm.nickname, tm.location].filter(Boolean),
      }));
      const other = find(raw);
      if (other) hit = list.find((x) => x.id === other.id) || { ...other, logo: null, color: null, altColor: null };
    }
    if (!hit) throw new Error(`ESPN team not found: ${fav.name} (${fav.league})`);
    return { id: hit.id, name: hit.name, logo: hit.logo, color: hit.color, altColor: hit.altColor };
  }

  /** The team's home competition (its domestic league, or the national-team competition). */
  async homeLeague(slug, teamId) {
    if (sportOf(slug) !== 'soccer') return slug;
    try {
      const d = await fetchJson(`${SITE}/soccer/${slug}/teams/${teamId}`);
      return homeLeagueFromEspn(d.team?.defaultLeague) || slug;
    } catch {
      return slug;
    }
  }

  /**
   * Live data comes from the default feed: the localized variant can lag behind (stale scores).
   * Localized team names are applied from the cached team list instead.
   */
  async localize(slug, games) {
    let list = [];
    try {
      list = await this.listTeams(slug);
    } catch {}
    const byId = new Map(list.map((x) => [x.id, x]));
    for (const g of games) {
      for (const side of [g.home, g.away]) {
        const tm = byId.get(side.id);
        if (tm) {
          side.name = tm.shortName || tm.name;
          side.fullName = tm.name;
        }
      }
    }
    return games;
  }

  async teamSchedule(slug, teamId) {
    const base = `${SITE}/${pathOf(slug)}/${slug}/teams/${teamId}/schedule`;
    // US leagues list playoff games separately (season type 3): ask for them too.
    const extra = PLAYOFF_LEAGUES.has(slug) ? [() => fetchJson(`${base}?seasontype=3`)] : [];
    const results = await settleAll([() => fetchJson(base), () => fetchJson(`${base}?fixture=true`), ...extra], 2);
    const byId = new Map();
    for (const g of results.flatMap((d) => (d?.events || []).map((e) => normalizeEvent(e, slug)).filter(Boolean))) byId.set(g.id, g);
    return this.localize(slug, [...byId.values()]);
  }

  /** The full table of a league (each group/conference), for leagues you follow. */
  async leagueTable(slug) {
    const d = await fetchJson(`${STANDINGS}/${pathOf(slug)}/${slug}/standings?${langQuery()}`).catch(() => fetchJson(`${STANDINGS}/${pathOf(slug)}/${slug}/standings`));
    const groups = d.children?.length ? d.children : [{ name: d.name, standings: d.standings }];
    const sport = sportOf(slug);
    const seeded = sport === 'basketball' || sport === 'football' || sport === 'hockey';
    const byRecord = sport === 'basketball' || sport === 'football';
    const stat = (e, n) => e.stats?.find((s) => s.name === n);
    const out = groups
      .map((g) => {
        const rows = (g.standings?.entries || [])
          .map((e) => ({
            rank: Number(stat(e, seeded ? 'playoffSeed' : 'rank')?.value ?? stat(e, 'rank')?.value ?? 0),
            id: String(e.team.id),
            name: e.team.shortDisplayName || e.team.displayName,
            logo: e.team.logos?.[0]?.href || null,
            played: Number(stat(e, 'gamesPlayed')?.value ?? 0),
            points: byRecord ? undefined : Number(stat(e, 'points')?.value ?? 0),
            record: byRecord ? `${stat(e, 'wins')?.displayValue ?? 0}-${stat(e, 'losses')?.displayValue ?? 0}` : undefined,
            noteColor: e.note?.color || null,
          }))
          .sort((a, b) => a.rank - b.rank);
        if (rows.length && rows.every((r) => !r.rank)) rows.forEach((r, i) => (r.rank = i + 1));
        return { group: groups.length > 1 ? groupName(g.name) : null, rows };
      })
      .filter((g) => g.rows.length);
    return out.length ? { format: byRecord ? 'record' : 'points', groups: out } : null;
  }

  async standings(slug, teamId) {
    const d = await fetchJson(`${STANDINGS}/${pathOf(slug)}/${slug}/standings?${langQuery()}`).catch(() => fetchJson(`${STANDINGS}/${pathOf(slug)}/${slug}/standings`));
    const groups = d.children?.length ? d.children : [{ name: d.name, standings: d.standings }];
    const sport = sportOf(slug);
    const seeded = sport === 'basketball' || sport === 'football' || sport === 'hockey'; // ranked by playoff seed
    const byRecord = sport === 'basketball' || sport === 'football'; // W-L tables; hockey and soccer use points
    for (const g of groups) {
      const entries = g.standings?.entries || [];
      if (!entries.some((e) => String(e.team.id) === teamId)) continue;
      const stat = (e, n) => e.stats.find((s) => s.name === n);
      const rows = entries
        .map((e) => ({
          rank: Number(stat(e, seeded ? 'playoffSeed' : 'rank')?.value ?? stat(e, 'rank')?.value ?? 0),
          name: e.team.shortDisplayName || e.team.displayName,
          logo: e.team.logos?.[0]?.href || null,
          played: Number(stat(e, 'gamesPlayed')?.value ?? 0),
          points: byRecord ? undefined : Number(stat(e, 'points')?.value ?? 0),
          record: byRecord
            ? `${stat(e, 'wins')?.displayValue ?? 0}-${stat(e, 'losses')?.displayValue ?? 0}${Number(stat(e, 'ties')?.value) ? `-${stat(e, 'ties').displayValue}` : ''}`
            : String(stat(e, 'overall')?.displayValue ?? '').split(',')[0],
          gb: byRecord ? stat(e, 'gamesBehind')?.displayValue ?? '' : undefined,
          me: String(e.team.id) === teamId,
          noteColor: e.note?.color || null,
        }))
        .sort((a, b) => a.rank - b.rank);
      if (rows.every((r) => !r.rank)) rows.forEach((r, i) => (r.rank = i + 1)); // FIBA groups: API order is the ranking
      const me = rows.find((r) => r.me);
      const myEntry = entries.find((e) => String(e.team.id) === teamId);
      return {
        title: leagueName(slug, d.name),
        group: groups.length > 1 ? groupName(g.name) : null,
        rank: me.rank,
        points: me.points,
        played: me.played,
        record: me.record,
        gamesBack: me.gb,
        note: translateNote(myEntry?.note?.description),
        rows: windowRows(rows, 5),
        total: rows.length,
        format: byRecord ? 'record' : 'points',
      };
    }
    return null;
  }

  /**
   * One team, every competition it plays: candidate competitions come from its home league,
   * and the ones with recent or upcoming games are kept.
   */
  async getTeamOverview(fav, resolved) {
    if (!resolved.home) resolved.home = await this.homeLeague(fav.league, resolved.id);
    const candidates = [...new Set([...candidateCompetitions(resolved.home), fav.league])];
    const now = Date.now();
    const perComp = await settleAll(
      candidates.map((slug) => async () => {
        const games = (await this.teamSchedule(slug, resolved.id)).filter((g) => g.league.key === slug);
        const active = games.some((g) => g.state === 'pre' || g.state === 'live' || g.state === 'break' || now - Date.parse(g.start) < ACTIVE_WINDOW);
        return { slug, games, active };
      }),
      3,
    );
    // Every schedule request failed (ESPN down or refusing us): say so, so the previous card is
    // kept, instead of building an empty "no matches" card that looks like real data.
    if (perComp.every((c) => !c)) throw new Error(`no schedule could be loaded for ${resolved.name || fav.name}`);
    const comps = perComp.filter((c) => c?.active);
    const all = new Map();
    for (const c of comps) for (const g of c.games) all.set(g.id, g);
    const { last, next } = pickLastNext([...all.values()]);

    const competitions = await Promise.all(
      comps.map(async (c) => {
        const ln = pickLastNext(c.games);
        let standing = null;
        if (leagueByKey(c.slug)?.kind !== 'cup' && c.slug !== 'fifa.friendly') standing = await this.standings(c.slug, resolved.id).catch(() => null);
        return { key: c.slug, name: leagueName(c.slug), last: ln.last, next: ln.next, standing };
      }),
    );
    // Home league first, then whatever is coming up soonest.
    const soon = (c) => (c.next ? Date.parse(c.next.start) : Infinity);
    competitions.sort((a, b) => (b.key === resolved.home) - (a.key === resolved.home) || soon(a) - soon(b));
    return { home: resolved.home, last, next, competitions };
  }

  /** One day's games in a competition (YYYYMMDD). */
  async scoreboardForDay(slug, ymd) {
    // A finished past day never changes; a day the calendar says has no games needs no request.
    const key = `${slug}|${ymd}`;
    if (this.finishedDays.has(key)) return this.finishedDays.get(key);
    const days = this.matchDays(slug);
    if (days && !days.has(ymd)) return [];
    const d = await fetchJson(`${SITE}/${pathOf(slug)}/${slug}/scoreboard?dates=${ymd}`);
    this.rememberCalendar(slug, d);
    const games = await this.localize(slug, (d.events || []).map((e) => normalizeEvent(e, slug)).filter(Boolean));
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const over = (g) => g.state === 'final' || g.state === 'postponed' || g.state === 'canceled';
    if (ymd < today && games.length && games.every(over)) {
      if (this.finishedDays.size > 600) this.finishedDays.delete(this.finishedDays.keys().next().value);
      this.finishedDays.set(key, games);
    }
    return games;
  }

  /** Line-ups for a football match (ESPN publishes them ~1 h before kickoff). */
  async lineups(slug, eventId) {
    // Default feed: the localized variant lags behind and often has no line-ups yet.
    const d = await fetchJson(`${SITE}/soccer/${slug}/summary?event=${eventId}`);
    const side = (r) => ({
      teamId: String(r.team?.id),
      formation: r.formation || '',
      starters: (r.roster || [])
        .filter((p) => p.starter)
        .sort((a, b) => Number(a.formationPlace || 99) - Number(b.formationPlace || 99))
        // ESPN sometimes labels confirmed starters as "SUB": drop that.
        .map((p) => ({ name: p.athlete?.shortName || p.athlete?.displayName || '', number: p.jersey || '', pos: p.position?.abbreviation === 'SUB' ? '' : p.position?.abbreviation || '' })),
    });
    const rosters = (d.rosters || []).map(side).filter((r) => r.starters.length);
    return rosters.length === 2 ? rosters : null;
  }

  async getScoreboard(slug) {
    const d = await fetchJson(`${SITE}/${pathOf(slug)}/${slug}/scoreboard`);
    this.rememberCalendar(slug, d);
    const games = await this.localize(slug, (d.events || []).map((e) => normalizeEvent(e, slug)).filter(Boolean));
    this.boards.set(slug, { at: Date.now(), games });
    return games;
  }
}

const groupName = (name) => {
  const m = String(name).match(/^Group\s+(.+)$/i);
  return m ? t('notesStandings.group', { name: m[1] }) : name;
};

function translateNote(desc) {
  if (!desc) return null;
  const map = [
    [/champions/i, 'champions'],
    [/europa league/i, 'europa'],
    [/conference/i, 'conference'],
    [/relegation|descenso/i, 'relegation'],
    [/play-?in/i, 'playin'],
    [/playoff/i, 'playoff'],
    [/promot|ascenso/i, 'promotion'],
  ];
  for (const [re, key] of map) if (re.test(desc)) return t(`notesStandings.${key}`);
  return desc;
}
