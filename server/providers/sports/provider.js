/**
 * Sports provider interface. Every source (MLB Stats API, ESPN, demo, …) normalizes into
 * the shapes below, so the rest of the app never touches provider-specific JSON.
 *
 * @typedef {Object} TeamRef
 * @property {string} id         provider-scoped team id
 * @property {string} name       display name (Spanish where the provider supports it)
 * @property {string} abbr
 * @property {string|null} logo
 * @property {string|null} color     "#rrggbb"
 * @property {number|null} score
 * @property {boolean} [winner]
 *
 * @typedef {Object} GameEvent
 * @property {'goal'|'own-goal'|'penalty'|'red'|'yellow'|'run'} kind
 * @property {string} minute     "67'" or "▲7"
 * @property {'home'|'away'} side
 * @property {string} player
 * @property {string} [detail]
 *
 * @typedef {Object} Game
 * @property {string} id           globally unique: "<provider>:<league>:<eventId>"
 * @property {string} provider
 * @property {'soccer'|'baseball'} sport
 * @property {{key:string,name:string}} league
 * @property {string} start        ISO date
 * @property {boolean} [timeTBD]
 * @property {'pre'|'live'|'break'|'final'|'postponed'|'canceled'|'delayed'} state
 * @property {string} status       short localized status ("67'", "Half-time", "Final", "▲ 7th")
 * @property {TeamRef} home
 * @property {TeamRef} away
 * @property {GameEvent[]} events
 * @property {Object} [baseball]   inning/count/bases/linescore/matchup (see mlb.js)
 * @property {string|null} [mine]  team key from config when it involves one of my teams
 *
 * @typedef {Object} TeamCard
 * @property {string} key
 * @property {Game|null} last
 * @property {Game|null} next
 * @property {Object|null} standing
 */
export class SportsProvider {
  /** @returns {Promise<{id:string,name:string,logo:string|null,color:string|null}>} */
  async resolveTeam(_teamConfig) {
    throw new Error('not implemented');
  }
  /** @returns {Promise<{last:Game|null,next:Game|null,standing:Object|null}>} */
  async getTeamOverview(_teamConfig, _resolved) {
    throw new Error('not implemented');
  }
  /** All of today's games in a league. @returns {Promise<Game[]>} */
  async getScoreboard(_leagueKey) {
    throw new Error('not implemented');
  }
  /** Optional richer data for a live game I care about. @returns {Promise<Game>} */
  async getLiveDetail(game) {
    return game;
  }
}

export const isActive = (g) => g.state === 'live' || g.state === 'break' || g.state === 'delayed';

/** Choose last/next from a merged list of games. */
export function pickLastNext(games, now = Date.now()) {
  const sorted = [...games].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const last = [...sorted].reverse().find((g) => g.state === 'final') || null;
  const next =
    sorted.find((g) => isActive(g)) ||
    sorted.find((g) => g.state === 'pre' && Date.parse(g.start) > now - 4 * 3600e3) ||
    null;
  return { last, next };
}

/** Return ~`size` standings rows centered on the highlighted team. */
export function windowRows(rows, size = 5) {
  const idx = rows.findIndex((r) => r.me);
  if (idx < 0 || rows.length <= size) return rows.slice(0, size);
  let start = Math.max(0, idx - Math.floor(size / 2));
  start = Math.min(start, rows.length - size);
  return rows.slice(start, start + size);
}

export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
