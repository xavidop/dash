import { isActive } from '../providers/sports/provider.js';

const KEEP_FINAL_MS = 5 * 60e3; // keep my finished game on screen a few minutes
const TICK_MS = 5000;
const MAX_QUIET_MS = 6 * 3600e3; // longest a quiet competition goes unchecked
const CELEBRATE = new Set(['soccer', 'baseball', 'hockey', 'football']); // a celebration per basket would be too much

/**
 * Background worker that polls scoreboards on an adaptive schedule:
 * every `liveActiveSeconds` while a competition has a live game, every `liveIdleSeconds`
 * otherwise, and wakes up right at kickoff for upcoming games.
 *
 * Emits celebrations (my team scored) and publishes the `live` section.
 */
export class LiveTracker {
  /**
   * @param {object} opts
   * @param {Array<{provider:string, league:string, source?:object}>} opts.leagues
   */
  /**
   * @param {() => string[]} [opts.followed] league keys followed as a whole: all their live games
   *   are shown (not just my teams'), like config.liveLeagues.
   */
  constructor({ config, store, providers, favorites, leagues, onCelebration, followed = () => [] }) {
    this.followed = followed;
    this.config = config;
    this.store = store;
    this.providers = providers;
    this.favorites = favorites;
    this.onCelebration = onCelebration;
    this.generalLeagues = new Set(config.liveLeagues.map((l) => `${l.provider}:${l.league}`));
    this.leagues = [];
    this.setLeagues(leagues);
    this.prevScores = new Map(); // gameId → { home, away }
    this.recentFinals = new Map(); // gameId → { game, at }
    this.timer = null;
  }

  /** Replace the polled competitions (favourites changed), keeping state of the ones that stay. */
  setLeagues(leagues) {
    const seen = new Map();
    for (const l of leagues) seen.set(`${l.provider}:${l.league}`, l);
    const old = new Map(this.leagues.map((l) => [l.id, l]));
    this.leagues = [...seen].map(([id, l]) => old.get(id) || { ...l, id, nextPoll: 0, games: [], busy: false });
    // Re-tag "mine" soon, but spread the first polls (~1 s apart) instead of one burst of requests.
    const now = Date.now();
    this.leagues.forEach((l, i) => (l.nextPoll = now + i * 1000));
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** What each competition is doing (for /api/health): games, live ones, next poll, last error. */
  status() {
    return this.leagues.map((l) => ({
      id: l.id,
      games: l.games.length,
      live: l.games.filter(isActive).length,
      nextPollIn: Math.max(0, Math.round((l.nextPoll - Date.now()) / 1000)),
      error: l.error || null,
    }));
  }

  /** Force an immediate poll of everything. */
  pollNow() {
    for (const l of this.leagues) l.nextPoll = 0;
    return this.tick();
  }

  async tick() {
    const now = Date.now();
    const due = this.leagues.filter((l) => !l.busy && l.nextPoll <= now);
    if (!due.length) return;
    await Promise.all(due.map((l) => this.pollLeague(l)));
    this.publish();
  }

  async pollLeague(l) {
    l.busy = true;
    const { liveActiveSeconds, liveIdleSeconds } = this.config.refresh;
    try {
      const provider = l.source || this.providers[l.provider];
      const games = await provider.getScoreboard(l.league);
      for (const g of games) {
        g.mine = this.favorites.mineFor(g);
        if (g.mine) this.paint(g);
      }

      // Enrich my live games (e.g. MLB live feed: scoring plays, matchup).
      await Promise.all(
        games.map(async (g, i) => {
          if (g.mine && provider.getLiveDetail && (isActive(g) || this.justEnded(g))) {
            try {
              games[i] = { ...(await provider.getLiveDetail(g)), mine: g.mine };
              this.paint(games[i]);
            } catch (err) {
              console.warn('[live] detail failed:', err.message);
            }
          }
        }),
      );
      l.games = games;
      if (l.error) console.log(`[live] ${l.id} recovered`);
      l.error = null;

      const active = games.some(isActive);
      let next = (active ? liveActiveSeconds : liveIdleSeconds) * 1000;
      // Wake up for upcoming kickoffs instead of waiting a full idle interval.
      for (const g of games) {
        if (g.state !== 'pre') continue;
        const until = Date.parse(g.start) - Date.now();
        if (until > -30 * 60e3 && until < next) next = Math.max(liveActiveSeconds * 1000, until + 30e3);
        if (until <= 0 && until > -30 * 60e3) next = liveActiveSeconds * 1000 * 3; // late kickoff
      }
      if (!active) next = Math.max(next, this.quietFor(provider, l.league, games, next));
      l.nextPoll = Date.now() + next;
    } catch (err) {
      // Log once when a league starts failing (and when it recovers), not on every retry; a paused
      // source is already reported once by the HTTP layer.
      if (!l.error && !err.paused) console.warn(`[live] ${l.id} failed:`, err.message);
      l.error = err.message;
      const wasActive = l.games.some(isActive);
      l.nextPoll = Date.now() + (wasActive ? liveActiveSeconds * 1000 * 2 : 120e3);
    } finally {
      l.busy = false;
    }
  }

  /**
   * Nothing live: how long this competition can be left alone. Until 10 min before its next known
   * kickoff, or until its next match day per the league calendar (ESPN), at most 6 h; a competition
   * with nothing scheduled is checked every 6 h. Without that information, the normal idle interval.
   */
  quietFor(provider, league, games, idle, now = Date.now()) {
    const kickoffs = games.filter((g) => g.state === 'pre' && !g.timeTBD).map((g) => Date.parse(g.start));
    // Kickoff time has passed but the game isn't live yet: sources flip to "live" a few minutes late
    // (and games get delayed). Keep checking at the normal pace instead of sleeping until the next
    // match day, or the whole game would be missed.
    if (kickoffs.some((t) => t <= now && now - t < 3 * 3600e3)) return idle;
    const starts = kickoffs.filter((t) => t > now);
    let wake = starts.length ? Math.min(...starts) - 10 * 60e3 : null;
    const day = provider.nextMatchDay?.(league, now);
    if (day !== undefined) wake = wake == null ? (day ?? now + MAX_QUIET_MS) : day == null ? wake : Math.min(wake, day);
    if (wake == null) return idle;
    return Math.min(MAX_QUIET_MS, Math.max(idle, wake - now));
  }

  /** Use my configured team colors (providers sometimes report white/neutral primaries). */
  paint(g) {
    const fav = this.favorites.favoriteFor(g.mine);
    const id = this.favorites.myTeamIds().find((t) => t.key === g.mine)?.id;
    if (!fav || !id) return;
    for (const side of ['home', 'away']) {
      if (g[side].id === id) {
        if (fav.color) g[side].color = fav.color;
        if (fav.altColor) g[side].altColor = fav.altColor;
      }
    }
  }

  justEnded(g) {
    return g.state === 'final' && this.prevScores.has(g.id);
  }

  detectScoring(g) {
    const prev = this.prevScores.get(g.id);
    const cur = { home: g.home.score ?? 0, away: g.away.score ?? 0 };
    if (isActive(g)) this.prevScores.set(g.id, cur);
    if (!prev || !CELEBRATE.has(g.sport)) return;
    const myTeamId = this.favorites.myTeamIds().find((t) => t.key === g.mine)?.id;
    for (const side of ['home', 'away']) {
      const diff = cur[side] - prev[side];
      if (diff <= 0) continue;
      if (g.sport === 'football' && diff < 3) continue; // extra points / safeties: no fireworks
      const scorer = [...g.events].reverse().find((e) => e.side === side && ['goal', 'penalty', 'own-goal', 'run'].includes(e.kind));
      this.onCelebration?.({
        gameId: g.id,
        sport: g.sport,
        mine: g.mine,
        side,
        forMe: g[side].id === myTeamId,
        team: { name: g[side].name, logo: g[side].logo, color: g[side].color, altColor: g[side].altColor },
        player: scorer?.player || '',
        detail: scorer?.detail || (scorer?.kind === 'penalty' || scorer?.kind === 'own-goal' ? scorer.kind : ''),
        runs: diff,
        score: { home: cur.home, away: cur.away },
        at: Date.now(),
      });
    }
  }

  publish() {
    const now = Date.now();
    const byId = new Map();
    const followed = new Set(this.followed());
    for (const l of this.leagues) {
      for (const g of l.games) {
        const relevant = g.mine || this.generalLeagues.has(l.id) || followed.has(l.league) || l.source;
        if (!relevant) continue;
        if (g.mine) {
          this.detectScoring(g);
          if (g.state === 'final' && this.prevScores.has(g.id)) {
            this.recentFinals.set(g.id, { game: g, at: now });
            this.prevScores.delete(g.id);
          }
        }
        if (isActive(g)) byId.set(g.id, g);
      }
    }
    for (const [id, { game, at }] of this.recentFinals) {
      if (now - at > KEEP_FINAL_MS) this.recentFinals.delete(id);
      else if (!byId.has(id)) byId.set(id, game);
    }
    const games = [...byId.values()].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || Date.parse(a.start) - Date.parse(b.start));
    const failing = this.leagues.filter((l) => l.error).map((l) => l.id);
    this.store.set('live', { games, failing, polledAt: now });
  }
}
