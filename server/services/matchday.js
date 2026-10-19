import { leagueByKey, leagueName } from '../catalog.js';
import { settleAll } from '../lib/http.js';

const PREVIEW_WINDOW_MS = 90 * 60e3; // the pre-match card appears 90 min before kickoff
const ROUND_DAYS = { soccer: [-6, 4], basketball: [-1, 1], hockey: [-1, 1], football: [-4, 3] };
const ROUND_PROVIDERS = new Set(['espn', 'mlb', 'euroleague']);
export const ROUNDS_VERSION = 2; // bump when what goes into a round panel changes

/** YYYYMMDD in the display's time zone, `offsetDays` from `at` (now, or a game's ISO start). */
const ymdIn = (tz, offsetDays = 0, at = Date.now()) => {
  const t = (typeof at === 'string' ? Date.parse(at) : at) + offsetDays * 864e5;
  return new Date(t).toLocaleDateString('en-CA', { timeZone: tz }).replaceAll('-', '');
};

/**
 * Match-day extras:
 *  - preview: for each favourite playing within 90 min — line-ups (football, once published) or
 *    probable pitchers (MLB), shown on a "Previa" card; the kickoff toast is driven by the frontend.
 *  - rounds: the current round ("jornada") of each favourite's home competition, results + upcoming.
 */
export class MatchdayService {
  constructor({ config, store, providers, followed = () => [] }) {
    this.followed = followed; // league keys the household follows
    this.config = config;
    this.store = store;
    this.providers = providers;
  }

  cards() {
    return this.store.get('teams')?.data?.teams || [];
  }

  /** Favourites' games kicking off within the window (or just started). */
  upcomingMine() {
    const now = Date.now();
    return this.cards()
      .map((c) => ({ card: c, game: c.next }))
      .filter(({ game }) => game && game.state === 'pre' && !game.timeTBD && Date.parse(game.start) - now <= PREVIEW_WINDOW_MS && Date.parse(game.start) - now > -10 * 60e3);
  }

  async previews() {
    const out = [];
    for (const { card, game } of this.upcomingMine()) {
      const entry = { key: card.key, game, lineups: null, pitchers: null, standing: card.competitions?.find((c) => c.key === game.league.key)?.standing || null };
      try {
        if (game.provider === 'espn' && game.sport === 'soccer') {
          entry.lineups = await this.providers.espn.lineups(game.league.key, game.id.split(':').pop());
        } else if (game.provider === 'mlb' && game.gamePk) {
          const p = await this.providers.mlb.probables(game.gamePk);
          entry.pitchers = p?.pitchers || null;
          entry.lineups = p?.lineups?.home?.length ? [{ teamId: game.home.id, formation: '', starters: p.lineups.home }, { teamId: game.away.id, formation: '', starters: p.lineups.away }] : null;
        }
      } catch (err) {
        console.warn('[matchday] preview', card.key, err.message);
      }
      out.push(entry);
    }
    return { previews: out };
  }

  /** Competitions to show a round for: each favourite's home league on ESPN. */
  /** Competitions to show a round for: each favourite's home league, plus leagues followed. */
  roundLeagues() {
    const ok = (l) => l && ROUND_PROVIDERS.has(l.provider) && l.kind !== 'national';
    const keys = new Set();
    for (const c of this.cards()) {
      const home = c.home || c.competitions?.[0]?.key;
      if (ok(leagueByKey(home))) keys.add(home);
    }
    for (const k of this.followed()) if (ok(leagueByKey(k))) keys.add(k);
    return [...keys];
  }

  /** The games around today for one competition, from whichever source covers it. */
  async roundGames(key, tz) {
    const l = leagueByKey(key);
    const today = ymdIn(tz, 0);
    if (l.provider === 'mlb') return this.providers.mlb.scheduleRange(ymdIn(tz, -1), ymdIn(tz, 1));
    if (l.provider === 'euroleague') return (await this.providers.euroleague.roundGames(key))?.games || [];
    const espn = this.providers.espn;
    // No game today per the league calendar: nothing to show, no requests needed.
    const days = espn.matchDays?.(key);
    if (days && !days.has(today) && !days.has(ymdIn(tz, -1)) && !days.has(ymdIn(tz, 1))) return [];
    const [from, to] = ROUND_DAYS[l.sport] || [-2, 2];
    const list = [];
    for (let d = from; d <= to; d++) list.push(ymdIn(tz, d));
    // Today's games: reuse the scoreboard the live poller fetched moments ago when it covers today.
    const board = espn.recentBoard?.(key);
    const boardIsToday = board?.length && board.every((g) => ymdIn(tz, 0, g.start) === today);
    const lists = await settleAll(list.map((ymd) => () => (ymd === today && boardIsToday ? board : espn.scoreboardForDay(key, ymd))), 3);
    return lists.flat().filter(Boolean);
  }

  async leagueTable(key) {
    const l = leagueByKey(key);
    if (l.provider === 'espn') return this.providers.espn.leagueTable(key);
    if (l.provider === 'euroleague') return this.providers.euroleague.leagueTable(key);
    return null; // MLB: division tables live on the team cards
  }

  async rounds() {
    const tz = this.config.timezone;
    const now = Date.now();
    const today = ymdIn(tz, 0);
    const results = await settleAll(
      this.roundLeagues().map((key) => async () => {
        const byId = new Map();
        for (const g of await this.roundGames(key, tz)) byId.set(g.id, g);
        const games = [...byId.values()];
        // A round panel only on a day the competition plays.
        if (!games.some((g) => ymdIn(tz, 0, g.start) === today)) return null;
        const followed = this.followed().includes(key);
        // Playoffs: the regular-season table no longer says much; the series on each game does.
        const playoffs = games.filter((g) => ymdIn(tz, 0, g.start) === today).every((g) => g.postseason);
        const table = followed && !playoffs ? await this.leagueTable(key).catch(() => null) : null;
        const byTime = (a, b) => Date.parse(a.start) - Date.parse(b.start);
        return {
          key,
          name: leagueName(key),
          sport: leagueByKey(key).sport,
          live: games.filter((g) => g.state === 'live' || g.state === 'break').sort(byTime),
          results: games.filter((g) => g.state === 'final' && now - Date.parse(g.start) < 5 * 864e5).sort(byTime).reverse(),
          upcoming: games.filter((g) => g.state === 'pre').sort(byTime),
          followed,
          playoffs,
          table,
        };
      }),
      2,
    );
    // Stamped with the day and the logic version, so a restart only reuses today's panels.
    return { rounds: results.filter(Boolean), day: today, version: ROUNDS_VERSION };
  }
}
