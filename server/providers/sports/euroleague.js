import { fetchJson } from '../../lib/http.js';
import { SportsProvider, pickLastNext, windowRows, norm } from './provider.js';
import { leagueByKey, leagueName } from '../../catalog.js';
import { t, ord } from '../../lib/i18n.js';

// Official EuroLeague / EuroCup feeds (free, no key).
const FEED = 'https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions';
const LIVE = 'https://api-live.euroleague.net/v2/competitions';
const TTL = 24 * 3600e3;

const compCode = (key) => leagueByKey(key)?.code || 'E';
function seasonCode(key) {
  const now = new Date();
  const year = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${compCode(key)}${year}`;
}

function mapStatus(g) {
  const s = String(g.status || '').toLowerCase();
  if (s === 'result' || s === 'finished') return { state: 'final', status: g.home?.quarters?.ot1 != null ? t('status.finalOT') : t('status.final') };
  if (/postpon/.test(s)) return { state: 'postponed', status: t('status.postponed') };
  if (/cancel/.test(s)) return { state: 'canceled', status: t('status.canceled') };
  const live = g.quarter != null || (g.minute && g.minute !== '00:00' && s !== 'confirmed' && s !== 'scheduled');
  if (live || s === 'live' || s === 'playing' || s === 'inprogress') {
    const q = Number(g.quarter) || 0;
    if (g.remainingTime === '00:00' && q === 2) return { state: 'break', status: t('status.halftime') };
    if (g.remainingTime === '00:00' && q) return { state: 'break', status: t('status.endQuarter', { n: ord(q) }) };
    const label = q > 4 ? t('status.overtime') : q ? t('status.quarter', { n: ord(q) }) : t('status.inPlay');
    return { state: 'live', status: g.remainingTime ? `${label} · ${g.remainingTime}` : label };
  }
  return { state: 'pre', status: '' };
}

function side(t, color) {
  const q = t?.quarters || {};
  return {
    id: t?.code || '',
    name: t?.editorialName || t?.abbreviatedName || t?.name || '',
    fullName: t?.name || '',
    abbr: t?.tla || t?.code || '',
    logo: t?.imageUrls?.crest || null,
    color: color || null,
    altColor: null,
    score: t?.score ?? null,
    quarters: ['q1', 'q2', 'q3', 'q4', 'ot1', 'ot2', 'ot3'].map((k) => q[k]).filter((v) => v != null),
  };
}

function normalize(g, key) {
  const { state, status } = mapStatus(g);
  const home = side(g.home);
  const away = side(g.away);
  if (state === 'pre') home.score = away.score = null; // the feed reports 0-0 for unplayed games
  if (state === 'final' && home.score != null && away.score != null) {
    home.winner = home.score > away.score;
    away.winner = away.score > home.score;
  }
  return {
    id: `euroleague:${key}:${g.identifier || g.code}`,
    provider: 'euroleague',
    sport: 'basketball',
    league: { key, name: leagueName(key) },
    start: g.date,
    timeTBD: g.confirmedTime === false,
    state,
    status: state === 'pre' ? '' : status,
    home: { ...home, quarters: undefined },
    away: { ...away, quarters: undefined },
    events: [],
    venue: g.venue?.name ? titleCase(g.venue.name) : null,
    periods: { period: Number(g.quarter) || 0, clock: g.remainingTime || '', quarters: { home: home.quarters, away: away.quarters } },
    round: g.round?.round ?? null,
    broadcasts: (g.broadcasters || []).map((b) => ({ name: b.name, country: b.countryCode || '' })).filter((b) => b.name),
  };
}

const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

export class EuroleagueProvider extends SportsProvider {
  constructor() {
    super();
    this.clubs = new Map(); // key → { at, teams }
    this.tracked = new Map(); // key → Set(team codes) for live polling
  }

  async teamGames(key, code) {
    const d = await fetchJson(`${FEED}/${compCode(key)}/seasons/${seasonCode(key)}/games?teamCode=${encodeURIComponent(code)}`);
    return (d.data || []).map((g) => normalize(g, key));
  }

  async listTeams(key) {
    const cached = this.clubs.get(key);
    if (cached && Date.now() - cached.at < TTL) return cached.teams;
    const rows = await this.standingsRows(key, 1);
    const teams = rows
      .map((r) => ({ id: r.club.code, name: r.club.name, shortName: r.club.editorialName || r.club.abbreviatedName, aliases: [r.club.name, r.club.editorialName, r.club.abbreviatedName, r.club.clubPermanentName], logo: r.club.images?.crest || null, color: null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.clubs.set(key, { at: Date.now(), teams });
    return teams;
  }

  async standingsRows(key, round) {
    const d = await fetchJson(`${LIVE}/${compCode(key)}/seasons/${seasonCode(key)}/rounds/${round}/standings`);
    return (Array.isArray(d) ? d : [d]).flatMap((g) => g.standings || []);
  }

  async resolveTeam(fav) {
    const wanted = [fav.name, fav.displayName, ...(fav.aliases || [])].filter(Boolean).map(norm);
    const list = await this.listTeams(fav.league);
    const hit =
      list.find((t) => t.aliases.filter(Boolean).some((a) => wanted.includes(norm(a)))) ||
      list.find((t) => wanted.some((w) => norm(t.name).includes(w)));
    if (!hit) throw new Error(`EuroLeague team not found: ${fav.name}`);
    return { id: hit.id, name: hit.name, logo: hit.logo, color: null };
  }

  async getTeamOverview(fav, resolved) {
    const games = await this.teamGames(fav.league, resolved.id);
    const { last, next } = pickLastNext(games);
    let standing = null;
    const round = Math.max(1, ...games.filter((g) => g.state === 'final').map((g) => g.round || 0));
    try {
      const rows = await this.standingsRows(fav.league, round);
      const all = rows
        .map((r) => ({
          rank: r.data.position,
          name: r.club.editorialName || r.club.abbreviatedName,
          logo: r.club.images?.crest || null,
          record: `${r.data.gamesWon}-${r.data.gamesLost}`,
          me: r.club.code === resolved.id,
        }))
        .sort((a, b) => a.rank - b.rank);
      const me = all.find((r) => r.me);
      if (me) standing = { title: leagueName(fav.league), group: null, rank: me.rank, record: me.record, rows: windowRows(all, 5), total: all.length, format: 'record' };
    } catch (err) {
      if (process.env.DASH_DEBUG) console.warn('[euroleague] standings', err.message);
    }
    return { last, next, standing };
  }

  /**
   * The current round of the whole competition (all 10 games): the round with a game from 12 h
   * ago onwards, found from a tracked team's schedule or, failing that, the season's game list.
   */
  async roundGames(key) {
    const round = await this.currentRound(key);
    if (!round) return null;
    const d = await fetchJson(`${FEED}/${compCode(key)}/seasons/${seasonCode(key)}/games?roundNumber=${round}`);
    return { round, games: (d.data || []).map((g) => normalize(g, key)) };
  }

  async currentRound(key) {
    const cached = this.rounds?.get(key);
    if (cached && Date.now() - cached.at < 6 * 3600e3) return cached.round;
    const pick = (games) => {
      const sorted = [...games].filter((g) => g.round).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      return (sorted.find((g) => Date.parse(g.start) > Date.now() - 12 * 3600e3) || sorted.at(-1))?.round || null;
    };
    let round = null;
    const code = [...(this.tracked.get(key) || [])][0];
    if (code) round = pick(await this.teamGames(key, code));
    else {
      // Followed without a team: walk the season's games (sorted by date, 50 per page) to today.
      for (let page = 0; page < 10 && !round; page++) {
        const d = await fetchJson(`${FEED}/${compCode(key)}/seasons/${seasonCode(key)}/games?page=${page}`);
        const games = (d.data || []).map((g) => normalize(g, key));
        if (games.some((g) => Date.parse(g.start) > Date.now() - 12 * 3600e3) || page + 1 >= (d.metadata?.totalPages || 1)) round = pick(games);
      }
    }
    (this.rounds ??= new Map()).set(key, { at: Date.now(), round });
    return round;
  }

  /** The full table (for followed competitions), in the round panel's format. */
  async leagueTable(key) {
    const round = (await this.currentRound(key)) || 1;
    const rows = await this.standingsRows(key, Math.max(1, round - 1)).catch(() => this.standingsRows(key, round));
    const list = rows
      .map((r) => ({ rank: r.data.position, id: r.club.code, name: r.club.editorialName || r.club.abbreviatedName, logo: r.club.images?.crest || null, played: r.data.gamesPlayed ?? 0, record: `${r.data.gamesWon}-${r.data.gamesLost}`, noteColor: null }))
      .sort((a, b) => a.rank - b.rank);
    return list.length ? { format: 'record', groups: [{ group: null, rows: list }] } : null;
  }

  /**
   * The end of the season (play-in, playoffs, Final Four / EuroCup 8F → Final): the last pages of
   * the season's game list, keeping non-regular-season phases. Cached for 30 min.
   */
  async seasonTail(key) {
    const cached = this.tails?.get(key);
    if (cached && Date.now() - cached.at < 30 * 60e3) return cached.games;
    const base = `${FEED}/${compCode(key)}/seasons/${seasonCode(key)}/games`;
    const first = await fetchJson(`${base}?page=0`);
    const pages = first.metadata?.totalPages || 1;
    const lists = [first];
    for (const p of [pages - 3, pages - 2, pages - 1]) if (p > 0) lists.push(await fetchJson(`${base}?page=${p}`));
    const byId = new Map();
    for (const raw of lists.flatMap((d) => d.data || [])) {
      if (!raw.phaseType || raw.phaseType.isGroupPhase || raw.phaseType.code === 'RS') continue;
      const g = normalize(raw, key);
      g.phase = raw.phaseType.name || raw.phaseType.code;
      byId.set(g.id, g);
    }
    const games = [...byId.values()];
    (this.tails ??= new Map()).set(key, { at: Date.now(), games });
    return games;
  }

  /** Live tracking is limited to my teams (the full season list is large). */
  track(key, codes) {
    this.tracked.set(key, new Set(codes));
  }

  async getScoreboard(key) {
    const codes = [...(this.tracked.get(key) || [])];
    const now = Date.now();
    const lists = await Promise.all(codes.map((c) => this.teamGames(key, c)));
    return lists.flat().filter((g) => Math.abs(Date.parse(g.start) - now) < 36 * 3600e3);
  }
}
