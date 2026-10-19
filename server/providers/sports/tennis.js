import { fetchJson } from '../../lib/http.js';
import { t, ord } from '../../lib/i18n.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const RANK_TTL = 12 * 3600e3;

const ROUNDS = [
  [/^final$/i, 'final'],
  [/semi/i, 'semi'],
  [/quarter/i, 'quarter'],
  [/round of 16|4th round/i, 'r16'],
  [/qualif/i, 'qual'],
];
function roundName(r) {
  for (const [re, key] of ROUNDS) if (re.test(r || '')) return t(`tennis.rounds.${key}`);
  const of = String(r || '').match(/round of (\d+)/i);
  if (of) return t('tennis.rounds.round', { n: ord({ 32: 3, 64: 2, 128: 1 }[of[1]] || 1, t('grammar.round') === 'f' ? 'f' : 'm') });
  const n = String(r || '').match(/(\d)(?:st|nd|rd|th) round|round (\d)/i);
  return n ? t('tennis.rounds.round', { n: ord(Number(n[1] || n[2]), t('grammar.round') === 'f' ? 'f' : 'm') }) : r || '';
}

function mapStatus(st) {
  const type = st?.type || {};
  switch (type.name) {
    case 'STATUS_RETIRED':
      return { state: 'final', status: t('status.retired') };
    case 'STATUS_WALKOVER':
      return { state: 'final', status: t('status.walkover') };
    case 'STATUS_POSTPONED':
    case 'STATUS_SUSPENDED':
      return { state: 'postponed', status: t('status.suspended') };
    case 'STATUS_DELAYED':
    case 'STATUS_RAIN_DELAY':
      return { state: 'delayed', status: t('status.delayed') };
  }
  if (type.state === 'in') return { state: 'live', status: st.period ? t('status.set', { n: ord(st.period) }) : t('status.inPlay') };
  if (type.state === 'post') return { state: 'final', status: t('status.final') };
  return { state: 'pre', status: '' };
}

function player(c) {
  const a = c.athlete || {};
  return {
    id: String(c.id),
    name: a.displayName || a.fullName || '',
    abbr: a.shortName || '',
    logo: a.flag?.href || null, // country flag
    color: null,
    score: 0,
    winner: c.winner === true,
    sets: (c.linescores || []).map((s) => ({ games: Number(s.value ?? 0), won: s.winner === true, tiebreak: s.tiebreak ?? null })),
  };
}

function normalize(c, tour, tournament, grouping) {
  const comps = [...(c.competitors || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (comps.length < 2 || comps.some((x) => x.type && x.type !== 'athlete')) return null;
  const [p1, p2] = comps.map(player);
  const { state, status } = mapStatus(c.status);
  p1.score = p1.sets.filter((s) => s.won).length;
  p2.score = p2.sets.filter((s) => s.won).length;
  const round = roundName(c.round?.displayName);
  return {
    id: `tennis:${tour}:${c.id}`,
    provider: 'tennis',
    sport: 'tennis',
    league: { key: tour, name: tournament },
    start: c.date || c.startDate,
    state,
    status: state === 'live' ? `${round} · ${status}` : status,
    home: p1,
    away: p2,
    events: [],
    tennis: { round, tournament, draw: grouping, sets: p1.sets.map((s, i) => ({ home: s.games, away: p2.sets[i]?.games ?? 0 })) },
  };
}

/** ESPN tennis: tournaments in progress, matches of my favourite players, and rankings. */
export class TennisProvider {
  constructor() {
    this.rankings = new Map(); // tour → { at, list }
    this.tracked = new Map(); // tour → Set(player ids)
  }

  async listPlayers(tour) {
    const cached = this.rankings.get(tour);
    if (cached && Date.now() - cached.at < RANK_TTL) return cached.list;
    const d = await fetchJson(`${SITE}/${tour}/rankings`);
    const ranks = d.rankings?.[0]?.ranks || [];
    const list = ranks.map((r) => ({
      id: String(r.athlete?.id),
      name: r.athlete?.displayName,
      rank: r.current,
      points: r.points,
      flag: r.athlete?.flag?.href || null,
      tour,
    }));
    this.rankings.set(tour, { at: Date.now(), list });
    return list;
  }

  async matches(tour) {
    // Note: the lang=es variant of this feed lags behind (stale scores), so use the default one.
    const d = await fetchJson(`${SITE}/${tour}/scoreboard`);
    const out = [];
    for (const e of d.events || []) {
      for (const g of e.groupings || []) {
        const slug = g.grouping?.slug || g.grouping?.displayName || '';
        if (!/singles/i.test(slug)) continue;
        for (const c of g.competitions || []) {
          const m = normalize(c, tour, e.shortName || e.name, slug);
          if (m) out.push(m);
        }
      }
    }
    return out;
  }

  track(players) {
    this.tracked = new Map();
    for (const p of players) {
      if (!this.tracked.has(p.tour)) this.tracked.set(p.tour, new Set());
      this.tracked.get(p.tour).add(String(p.id));
    }
  }

  /** Live board feed: only matches with my players. */
  async getScoreboard(tour) {
    const ids = this.tracked.get(tour);
    if (!ids?.size) return [];
    return (await this.matches(tour)).filter((m) => ids.has(m.home.id) || ids.has(m.away.id));
  }

  async getLiveDetail(game) {
    return game;
  }

  /** One card summarizing all my players. */
  async overview(players) {
    const tours = [...new Set(players.map((p) => p.tour))];
    const byTour = {};
    await Promise.all(
      tours.map(async (t) => {
        byTour[t] = { matches: await this.matches(t).catch(() => []), ranks: await this.listPlayers(t).catch(() => []) };
      }),
    );
    const rows = players.map((p) => {
      const { matches = [], ranks = [] } = byTour[p.tour] || {};
      const mine = matches.filter((m) => m.home.id === String(p.id) || m.away.id === String(p.id)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      const live = mine.find((m) => m.state === 'live' || m.state === 'break');
      const last = [...mine].reverse().find((m) => m.state === 'final') || null;
      const next = mine.find((m) => m.state === 'pre') || null;
      const r = ranks.find((x) => x.id === String(p.id));
      const any = live || last || next;
      const flag = r?.flag || p.flag || (any ? (any.home.id === String(p.id) ? any.home.logo : any.away.logo) : null);
      return { id: String(p.id), name: r?.name || p.name, tour: p.tour, rank: r?.rank ?? null, flag, live: live || null, last, next };
    });
    return { rows };
  }
}
