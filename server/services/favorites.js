import { leagueByKey, leagueName, candidateCompetitions } from '../catalog.js';

/**
 * Builds everything about my favourites (stored in the local DB):
 * one card per team covering every competition it plays (league, cups, continental…),
 * the F1 card and the tennis card. Also tells the live tracker what to watch.
 */
export class FavoritesService {
  constructor({ config, store, db, providers }) {
    this.config = config;
    this.store = store;
    this.db = db;
    this.providers = providers;
    this.resolved = { ...(store.getMeta('resolvedTeams') || {}) };
  }

  /**
   * Enabled favourites, one per real team: the same team added twice (from config by name and from
   * Settings under another competition, say) gets a single card. Football team ids are global on
   * ESPN, so a match there means the same team; other sports only match within one league.
   */
  teams() {
    const seen = new Set();
    return this.db.favorites().teams.filter((t) => {
      if (t.enabled === false) return false;
      const id = t.id || this.resolved[t.key]?.id;
      if (!id) return true;
      const scope = this.sportOf(t) === 'soccer' ? 'soccer' : t.league;
      const key = `${this.providerOf(t)}:${scope}:${id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  drivers() {
    return this.db.favorites().drivers;
  }
  players() {
    return this.db.favorites().players;
  }

  providerOf(fav) {
    return leagueByKey(fav.league)?.provider || 'espn';
  }
  sportOf(fav) {
    return leagueByKey(fav.league)?.sport || 'soccer';
  }

  cacheKey(fav) {
    return `${this.providerOf(fav)}:${fav.league}:${fav.name}:${fav.id || ''}`;
  }

  async resolveAll() {
    for (const fav of this.teams()) {
      const ck = this.cacheKey(fav);
      if (this.resolved[fav.key]?.cacheKey === ck) continue;
      if (fav.id) {
        this.resolved[fav.key] = { id: String(fav.id), name: fav.name, logo: fav.logo || null, color: fav.color || null, cacheKey: ck };
        continue;
      }
      try {
        const r = await this.providers[this.providerOf(fav)].resolveTeam(fav);
        this.resolved[fav.key] = { ...r, cacheKey: ck };
        console.log(`[favorites] ${fav.key} → ${this.providerOf(fav)} id ${r.id} (${r.name})`);
      } catch (err) {
        console.warn(`[favorites] could not resolve ${fav.key}:`, err.message);
      }
    }
    this.store.setMeta('resolvedTeams', this.resolved);
    this.syncTracking();
  }

  /** [{ key, provider, sport, id }] for teams that resolved. */
  myTeamIds() {
    return this.teams()
      .filter((t) => this.resolved[t.key])
      .map((t) => ({ key: t.key, provider: this.providerOf(t), sport: this.sportOf(t), id: this.resolved[t.key].id }));
  }

  /** Which favourite (if any) is involved in this game. */
  mineFor(game) {
    if (game.sport === 'tennis') {
      const p = this.players().find((x) => String(x.id) === game.home.id || String(x.id) === game.away.id);
      return p ? `player:${p.id}` : null;
    }
    if (game.sport === 'f1') return this.drivers().length ? 'f1' : null;
    for (const t of this.myTeamIds()) {
      if (t.provider === game.provider && t.sport === game.sport && (game.home.id === t.id || game.away.id === t.id)) return t.key;
    }
    return null;
  }

  favoriteFor(key) {
    return this.teams().find((t) => t.key === key);
  }

  /** Competitions to poll for live games: each team's active competitions (or all candidates until known). */
  liveLeagues() {
    const cards = this.store.get('teams')?.data?.teams || [];
    const out = [];
    for (const fav of this.teams()) {
      const provider = this.providerOf(fav);
      const known = cards.find((c) => c.key === fav.key)?.competitions?.map((c) => c.key);
      const leagues = provider === 'espn' ? (known?.length ? known : candidateCompetitions(this.resolved[fav.key]?.home || fav.league)) : [fav.league];
      for (const league of leagues) out.push({ provider: leagueByKey(league)?.provider || provider, league });
    }
    for (const tour of new Set(this.players().map((p) => p.tour))) out.push({ provider: 'tennis', league: tour });
    if (this.drivers().length) out.push({ provider: 'f1', league: 'f1' });
    return out;
  }

  syncTracking() {
    const el = new Map();
    for (const t of this.myTeamIds().filter((x) => x.provider === 'euroleague')) {
      const league = this.favoriteFor(t.key).league;
      if (!el.has(league)) el.set(league, []);
      el.get(league).push(t.id);
    }
    for (const [league, codes] of el) this.providers.euroleague.track(league, codes);
    this.providers.tennis.track(this.players());
    this.providers.f1.track(this.drivers());
  }

  /**
   * A card can be reused (no requests) while nothing about the team can have changed: no game in
   * the next 24 h, none live or just finished, and refreshed within the last 2 h. Tables and
   * results only move around games, so quiet days cost almost nothing.
   */
  static quiet(card, now = Date.now()) {
    if (!card?.refreshedAt || now - card.refreshedAt > 2 * 3600e3) return false;
    const games = [card.next, card.last, ...(card.competitions || []).flatMap((c) => [c.next, c.last])].filter(Boolean);
    if (!games.length) return false; // an empty card is never worth keeping
    if (games.some((g) => g.state === 'live' || g.state === 'break')) return false;
    const soonest = Math.min(...games.filter((g) => g.state === 'pre').map((g) => Date.parse(g.start)), Infinity);
    if (soonest - now < 24 * 3600e3) return false;
    // A game that ended after the last refresh (results, table) means a refresh is due.
    const lastEnd = Math.max(...games.filter((g) => g.state === 'final').map((g) => Date.parse(g.start) + 3 * 3600e3), 0);
    return lastEnd < card.refreshedAt;
  }

  async teamCard(fav, prevCards, force = false) {
    const resolved = this.resolved[fav.key];
    const base = {
      key: fav.key,
      name: fav.displayName || resolved?.name || fav.name,
      sport: this.sportOf(fav),
      color: fav.color || resolved?.color || '#555',
      altColor: fav.altColor || resolved?.altColor || null,
      logo: fav.logo || resolved?.logo || null,
      teamId: resolved?.id || null,
    };
    const previous = () => ({ ...(prevCards.find((p) => p.key === fav.key) || {}), ...base });
    if (!resolved) return { card: previous(), ok: false };
    const prevCard = prevCards.find((p) => p.key === fav.key);
    if (!force && FavoritesService.quiet(prevCard)) return { card: { ...prevCard, ...base }, ok: true, reused: true };
    try {
      const o = await this.providers[this.providerOf(fav)].getTeamOverview(fav, resolved);
      // Single-competition providers (MLB, EuroLeague) report one block.
      const competitions = o.competitions || [{ key: fav.league, name: leagueName(fav.league), last: o.last, next: o.next, standing: o.standing }];
      return { card: { ...base, home: o.home || fav.league, last: o.last, next: o.next, competitions, refreshedAt: Date.now() }, ok: true };
    } catch (err) {
      console.warn(`[favorites] ${fav.key} overview failed:`, err.message);
      return { card: previous(), ok: false };
    }
  }

  /** `force`: rebuild every card (language change, restore), not just the ones that may have changed. */
  async refresh({ force = false } = {}) {
    if (this.myTeamIds().length < this.teams().length) await this.resolveAll();
    const prev = this.store.get('teams')?.data || {};
    const results = [];
    for (const fav of this.teams()) results.push(await this.teamCard(fav, prev.teams || [], force));
    this.store.setMeta('resolvedTeams', this.resolved); // includes discovered home leagues
    let anyOk = results.some((r) => r.ok);

    let f1 = null;
    if (this.drivers().length) {
      try {
        f1 = await this.providers.f1.overview(this.drivers());
        anyOk = true;
      } catch (err) {
        console.warn('[favorites] f1 failed:', err.message);
        f1 = prev.f1 || null;
      }
    }
    let tennis = null;
    if (this.players().length) {
      try {
        tennis = await this.providers.tennis.overview(this.players());
        anyOk = true;
      } catch (err) {
        console.warn('[favorites] tennis failed:', err.message);
        tennis = prev.tennis || null;
      }
    }
    if (!anyOk && (results.length || f1 || tennis)) throw new Error('no favourite could be refreshed');
    this.store.set('teams', { teams: results.map((r) => r.card), f1, tennis });
  }
}
