import { SportsProvider } from './provider.js';
import { leagueByKey, leagueName } from '../../catalog.js';
import { t, tn, ord } from '../../lib/i18n.js';

/**
 * Demo source (npm run demo). Simulates live games for YOUR favourites, read from the config:
 * the first football, baseball and basketball team, each against a real opponent from the same
 * competition, plus another live game for the "Live" panel and ticker. Games carry the real
 * provider ids so they flow through exactly the same pipeline as production data.
 */

const SOCCER_SECONDS_PER_MINUTE = 5;
const PITCH_SECONDS = 2.5;
const NAMES = ['A. García', 'L. Martin', 'J. Silva', 'M. Rossi', 'K. Müller', 'T. Smith', 'D. Costa', 'R. Novak', 'S. Kim', 'P. Dubois', 'H. Jensen', 'C. López'];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const ref = (team, score = 0) => ({
  id: String(team.id),
  name: team.shortName || team.name,
  fullName: team.name,
  abbr: team.abbr || (team.shortName || team.name).slice(0, 3).toUpperCase(),
  logo: team.logo || null,
  color: team.color || '#3b4a63',
  altColor: team.altColor || null,
  score,
});

// ───────────────────────── Football ─────────────────────────

class SoccerSim {
  constructor({ id, league, provider, home, away, startMinute, script, rate = SOCCER_SECONDS_PER_MINUTE }) {
    Object.assign(this, { id, league, provider, home, away, startMinute, script, rate });
    this.reset();
  }

  reset() {
    this.cycle = (this.cycle || 0) + 1;
    this.t0 = Date.now();
    this.forced = [];
    this.finishedAt = null;
  }

  /** Minute timeline: 1..45, half-time (3 ticks), 46..90(+3), final. */
  phase() {
    const ticks = Math.floor((Date.now() - this.t0) / 1000 / this.rate) + this.startMinute;
    if (ticks <= 45) return { minute: ticks, state: 'live' };
    if (ticks <= 48) return { minute: 45, state: 'break' };
    const m = ticks - 3;
    if (m <= 93) return { minute: m, state: 'live' };
    if (!this.finishedAt) this.finishedAt = Date.now();
    if (Date.now() - this.finishedAt > 90e3) {
      this.reset();
      return this.phase();
    }
    return { minute: 93, state: 'final' };
  }

  force(side) {
    const { minute } = this.phase();
    this.forced.push({ kind: 'goal', minute: minute + 0.5, side, player: NAMES[Math.floor(Math.random() * NAMES.length)] });
  }

  game() {
    const { minute, state } = this.phase();
    const fmt = (m) => (m > 90 ? `90'+${m - 90}` : `${m}'`);
    const events = [...this.script, ...this.forced]
      .filter((e) => e.minute <= minute)
      .sort((a, b) => a.minute - b.minute)
      .map((e) => ({ ...e, minute: fmt(Math.floor(e.minute)) }));
    const goals = (side) => events.filter((e) => e.side === side && ['goal', 'penalty', 'own-goal'].includes(e.kind)).length;
    const home = ref(this.home, goals('home'));
    const away = ref(this.away, goals('away'));
    if (state === 'final') {
      home.winner = home.score > away.score;
      away.winner = away.score > home.score;
    }
    return {
      id: `${this.provider}:${this.league}:demo-${this.id}-${this.cycle}`,
      provider: this.provider,
      sport: 'soccer',
      league: { key: this.league, name: leagueName(this.league) },
      start: new Date(this.t0 - this.startMinute * 60e3).toISOString(),
      state,
      status: state === 'break' ? t('status.halftime') : state === 'final' ? t('status.final') : fmt(minute),
      home,
      away,
      events,
      venue: null,
    };
  }
}

// ───────────────────────── Baseball ─────────────────────────

class BaseballSim {
  constructor({ home, away }) {
    Object.assign(this, { homeTeam: home, awayTeam: away });
    this.reset();
  }

  reset() {
    this.cycle = (this.cycle || 0) + 1;
    this.rand = rng(1016 + this.cycle);
    this.inning = 3;
    this.half = 'bottom';
    this.balls = 0;
    this.strikes = 0;
    this.outs = 1;
    this.bases = [null, NAMES[3], null];
    this.score = { away: 3, home: 2 };
    this.lines = { away: [1, 0, 2], home: [0, 2, 0] };
    this.hits = { away: 6, home: 4 };
    this.order = { away: 4, home: 4 };
    this.events = [
      { kind: 'run', minute: '▲1', side: 'away', player: NAMES[5], detail: `${t('mlb.plays.double')} · ${tn('mlb.runs', 1)}` },
      { kind: 'run', minute: '▼2', side: 'home', player: NAMES[0], detail: `${t('mlb.plays.home_run')} · ${tn('mlb.runs', 2)}` },
      { kind: 'run', minute: '▲3', side: 'away', player: NAMES[8], detail: `${t('mlb.plays.home_run')} · ${tn('mlb.runs', 2)}` },
    ];
    this.lastPlay = `${t('mlb.plays.home_run')} · ${tn('mlb.runs', 2)}`;
    this.forceNext = null;
    this.lastStep = Date.now();
    this.final = null;
  }

  batter() {
    const side = this.half === 'top' ? 'away' : 'home';
    return NAMES[(this.order[side] + (side === 'away' ? 6 : 0)) % NAMES.length];
  }
  pitcher() {
    return this.half === 'top' ? NAMES[10] : NAMES[11];
  }

  advance() {
    while (Date.now() - this.lastStep >= PITCH_SECONDS * 1000) {
      this.lastStep += PITCH_SECONDS * 1000;
      if (this.final) {
        if (Date.now() - this.final > 90e3) this.reset();
        return;
      }
      this.pitch();
    }
  }

  pitch() {
    const side = this.half === 'top' ? 'away' : 'home';
    if (this.forceNext === side) {
      this.forceNext = null;
      return this.inPlay('home_run');
    }
    const r = this.rand();
    if (r < 0.34) {
      if (++this.balls === 4) return this.inPlay('walk');
    } else if (r < 0.62) {
      if (++this.strikes === 3) return this.out('strikeout');
    } else if (r < 0.74) {
      if (this.strikes < 2) this.strikes++; // foul
    } else {
      const h = this.rand();
      if (h < 0.6) return this.out('field_out');
      if (h < 0.82) return this.inPlay('single');
      if (h < 0.93) return this.inPlay('double');
      return this.inPlay('home_run');
    }
  }

  nextBatter(side) {
    this.order[side]++;
    this.balls = 0;
    this.strikes = 0;
  }

  out(kind) {
    const side = this.half === 'top' ? 'away' : 'home';
    this.lastPlay = t(`mlb.plays.${kind}`);
    this.outs++;
    this.nextBatter(side);
    if (this.outs >= 3) this.endHalf();
  }

  inPlay(kind) {
    const side = this.half === 'top' ? 'away' : 'home';
    const batter = this.batter();
    const b = this.bases;
    let runs = 0;
    if (kind === 'walk') {
      if (b[0] && b[1] && b[2]) runs++;
      if (b[0] && b[1]) this.bases = [batter, b[0], b[1]];
      else if (b[0]) this.bases = [batter, b[0], b[2]];
      else this.bases = [batter, b[1], b[2]];
    } else if (kind === 'single') {
      runs += (b[2] ? 1 : 0) + (b[1] ? 1 : 0);
      this.bases = [batter, b[0], null];
      this.hits[side]++;
    } else if (kind === 'double') {
      runs += (b[2] ? 1 : 0) + (b[1] ? 1 : 0) + (b[0] ? 1 : 0);
      this.bases = [null, batter, null];
      this.hits[side]++;
    } else if (kind === 'home_run') {
      runs += 1 + b.filter(Boolean).length;
      this.bases = [null, null, null];
      this.hits[side]++;
    }
    const label = t(`mlb.plays.${kind}`);
    this.lastPlay = runs ? `${label} · ${tn('mlb.runs', runs)}` : label;
    if (runs) {
      this.score[side] += runs;
      this.lines[side][this.inning - 1] = (this.lines[side][this.inning - 1] || 0) + runs;
      this.events.push({ kind: 'run', minute: `${this.half === 'top' ? '▲' : '▼'}${this.inning}`, side, player: batter, detail: this.lastPlay });
    }
    this.nextBatter(side);
  }

  endHalf() {
    const side = this.half === 'top' ? 'away' : 'home';
    this.lines[side][this.inning - 1] = this.lines[side][this.inning - 1] || 0;
    this.outs = 0;
    this.balls = 0;
    this.strikes = 0;
    this.bases = [null, null, null];
    if (this.half === 'top') {
      this.half = 'bottom';
      if (this.inning >= 9 && this.score.home > this.score.away) this.final = Date.now();
    } else if (this.inning >= 9 && this.score.home !== this.score.away) this.final = Date.now();
    else {
      this.inning++;
      this.half = 'top';
    }
  }

  game() {
    this.advance();
    const home = ref(this.homeTeam, this.score.home);
    const away = ref(this.awayTeam, this.score.away);
    const innings = [];
    for (let i = 1; i <= Math.max(9, this.inning); i++) {
      innings.push({
        n: i,
        away: i <= this.inning ? this.lines.away[i - 1] ?? 0 : null,
        home: i < this.inning || (i === this.inning && this.half === 'bottom') ? this.lines.home[i - 1] ?? 0 : null,
      });
    }
    const final = !!this.final;
    if (final) {
      home.winner = home.score > away.score;
      away.winner = !home.winner;
    }
    return {
      id: `mlb:mlb:demo-${this.homeTeam.id}-${this.cycle}`,
      gamePk: 0,
      provider: 'mlb',
      sport: 'baseball',
      league: { key: 'mlb', name: 'MLB' },
      start: new Date(Date.now() - 80 * 60e3).toISOString(),
      state: final ? 'final' : 'live',
      status: final ? t('status.final') : `${this.half === 'top' ? '▲' : '▼'} ${ord(this.inning, t('grammar.inning') === 'f' ? 'f' : 'm')}`,
      home,
      away,
      events: [...this.events],
      venue: null,
      baseball: {
        inning: this.inning,
        half: this.half,
        inningState: this.half === 'top' ? 'Top' : 'Bottom',
        balls: this.balls,
        strikes: this.strikes,
        outs: this.outs,
        bases: { first: !!this.bases[0], second: !!this.bases[1], third: !!this.bases[2] },
        batter: { id: 0, name: this.batter(), headshot: null },
        pitcher: { id: 0, name: this.pitcher(), headshot: null },
        scheduledInnings: 9,
        lastPlay: this.lastPlay,
        linescore: { innings, away: { r: this.score.away, h: this.hits.away, e: 0 }, home: { r: this.score.home, h: this.hits.home, e: 1 } },
      },
    };
  }
}

// ───────────────────────── Basketball ─────────────────────────

/** One game minute every 4 s, points in small deterministic bursts. */
class BasketSim {
  constructor({ league, provider, home, away }) {
    Object.assign(this, { league, provider, homeTeam: home, awayTeam: away });
    this.reset();
  }

  reset() {
    this.t0 = Date.now();
    this.rand = rng(42);
    this.pts = { home: [], away: [] };
    this.minute = 0;
  }

  game() {
    const target = 18 + Math.floor((Date.now() - this.t0) / 4000); // start in the 2nd quarter
    while (this.minute < target && this.minute < 48) {
      const q = Math.floor(this.minute / 12);
      for (const side of ['home', 'away']) this.pts[side][q] = (this.pts[side][q] || 0) + Math.floor(this.rand() * 4.4) + (side === 'home' ? 1 : 0);
      this.minute++;
    }
    if (this.minute >= 48 && Date.now() - this.t0 > 30 * 4000 + 90e3) this.reset();
    const q = Math.min(4, Math.floor(this.minute / 12) + 1);
    const left = 12 - (this.minute % 12);
    const final = this.minute >= 48;
    const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
    return {
      id: `${this.provider}:${this.league}:demo-${this.homeTeam.id}`,
      provider: this.provider,
      sport: 'basketball',
      league: { key: this.league, name: leagueName(this.league) },
      start: new Date(this.t0 - 40 * 60e3).toISOString(),
      state: final ? 'final' : 'live',
      status: final ? t('status.final') : `${t('status.quarter', { n: ord(q) })} · ${left}:00`,
      home: ref(this.homeTeam, sum(this.pts.home)),
      away: ref(this.awayTeam, sum(this.pts.away)),
      events: [],
      venue: null,
      periods: { period: q, clock: `${left}:00`, quarters: { home: [...this.pts.home], away: [...this.pts.away] } },
    };
  }
}

// ───────────────────────── Provider ─────────────────────────

export class DemoProvider extends SportsProvider {
  constructor({ favorites, providers }) {
    super();
    this.favorites = favorites;
    this.providers = providers;
    this.sims = new Map(); // league → sims[]
    this.mine = []; // { key, name, sport, sim }
  }

  /** Build the simulations from the configured favourites (team lists provide real opponents). */
  async prepare() {
    const used = new Set();
    for (const fav of this.favorites.teams()) {
      const sport = leagueByKey(fav.league)?.sport;
      if (!['soccer', 'baseball', 'basketball'].includes(sport) || used.has(sport)) continue;
      const r = this.favorites.resolved[fav.key];
      if (!r) continue;
      const provider = leagueByKey(fav.league).provider;
      const league = sport === 'soccer' ? r.home || fav.league : fav.league;
      let pool = [];
      try {
        pool = (await this.providers[provider].listTeams(league)).filter((x) => x.id !== String(r.id));
      } catch {}
      const me = { id: r.id, name: fav.displayName || r.name, shortName: fav.displayName || r.name, logo: fav.logo || r.logo, color: fav.color || r.color, altColor: fav.altColor || r.altColor };
      const opp = pool[0] || { id: 'demo-rival', name: 'Rivals', logo: null, color: '#455a64' };
      let sim;
      if (sport === 'soccer') {
        sim = new SoccerSim({
          id: me.id,
          league,
          provider,
          home: me,
          away: opp,
          startMinute: 18,
          script: [
            { kind: 'goal', minute: 21, side: 'home', player: NAMES[0] },
            { kind: 'yellow', minute: 33, side: 'away', player: NAMES[4] },
            { kind: 'goal', minute: 41, side: 'away', player: NAMES[7] },
            { kind: 'red', minute: 58, side: 'away', player: NAMES[9] },
            { kind: 'goal', minute: 72, side: 'home', player: NAMES[1] },
            { kind: 'penalty', minute: 88, side: 'home', player: NAMES[2] },
          ],
        });
        // Another live game in the same competition for the "Live" panel.
        if (pool.length >= 3) {
          this.add(
            league,
            new SoccerSim({
              id: 'other',
              league,
              provider,
              home: pool[1],
              away: pool[2],
              startMinute: 52,
              rate: 30,
              script: [
                { kind: 'goal', minute: 12, side: 'home', player: NAMES[5] },
                { kind: 'goal', minute: 49, side: 'away', player: NAMES[6] },
              ],
            }),
          );
        }
      } else if (sport === 'baseball') {
        sim = new BaseballSim({ home: me, away: opp });
      } else {
        sim = new BasketSim({ league, provider, home: me, away: opp });
      }
      this.add(league, sim);
      this.mine.push({ key: fav.key, name: me.name, sport, sim });
      used.add(sport);
    }
    console.log(`[demo] simulating: ${this.mine.map((m) => `${m.name} (${m.sport})`).join(', ') || 'nothing (add favourites to config.json)'}`);
  }

  add(league, sim) {
    if (!this.sims.has(league)) this.sims.set(league, []);
    this.sims.get(league).push(sim);
  }

  /** Simulated competitions, for the live tracker. */
  leagues() {
    return [...this.sims.keys()].map((league) => ({ provider: leagueByKey(league)?.provider || 'espn', league, source: this }));
  }

  /** Demo buttons shown on screen. */
  controls() {
    return this.mine.filter((m) => m.sport !== 'basketball').map((m) => ({ key: m.key, label: t(m.sport === 'baseball' ? 'demo.run' : 'demo.goal', { team: m.name }) }));
  }

  /** Make my team score on the next update (POST /api/demo/score). */
  force(key) {
    const m = this.mine.find((x) => x.key === key) || this.mine.find((x) => x.sport !== 'basketball');
    if (!m) return false;
    if (m.sim instanceof BaseballSim) {
      const j = m.sim;
      if (j.final) return false;
      if (j.half === 'top') j.endHalf(); // skip to my team at bat
      j.forceNext = 'home';
      j.lastStep = Date.now() - PITCH_SECONDS * 1000;
      return true;
    }
    if (m.sim instanceof SoccerSim) {
      m.sim.force('home');
      return true;
    }
    return false;
  }

  async resolveTeam() {
    throw new Error('demo provider does not resolve teams');
  }

  async getScoreboard(league) {
    return (this.sims.get(league) || []).map((s) => s.game());
  }
}
