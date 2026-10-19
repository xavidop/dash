import { fetchJson } from '../../lib/http.js';
import { norm } from './provider.js';
import { t } from '../../lib/i18n.js';

// Jolpica (Ergast successor) for calendar, standings and results; ESPN for live session order.
const JOLPICA = 'https://api.jolpi.ca/ergast/f1/current';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard';

const TEAM_COLORS = {
  mercedes: '#27F4D2', red_bull: '#3671C6', ferrari: '#E8002D', mclaren: '#FF8000', aston_martin: '#229971',
  alpine: '#0093CC', williams: '#64C4FF', rb: '#6692FF', racing_bulls: '#6692FF', sauber: '#52E252', audi: '#BB0A30',
  haas: '#B6BABD', cadillac: '#C9A86A',
};

export function gpName(raceName = '') {
  const m = raceName.match(/^(.*?)\s*Grand Prix$/i);
  if (!m) return raceName;
  const countries = t('f1.countries') || {};
  const key = Object.keys(countries).find((k) => m[1].endsWith(k));
  // Drop sponsor prefixes ("MSC Cruises United States" → "United States") using Jolpica-style names when known.
  const plain = key ? countries[key] : m[1].split(/\s+/).slice(-2).join(' ');
  return t('f1.gp', { country: plain });
}

const SESSIONS = [
  ['FirstPractice', 'fp1'],
  ['SecondPractice', 'fp2'],
  ['ThirdPractice', 'fp3'],
  ['SprintQualifying', 'sq'],
  ['Sprint', 'sprint'],
  ['Qualifying', 'quali'],
];
const ESPN_SESSION = { FP1: 'fp1', FP2: 'fp2', FP3: 'fp3', SS: 'sq', SR: 'sprint', Qual: 'quali', Race: 'race' };
const sessionName = (k) => t(`f1.sessions.${k}`);
const iso = (s) => (s?.date ? `${s.date}T${s.time || '00:00:00Z'}` : null);

export class F1Provider {
  constructor() {
    this.watching = false;
  }

  async listDrivers() {
    const d = await fetchJson(`${JOLPICA}/driverStandings.json?limit=40`).catch(() => null);
    const standings = d?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings;
    if (standings?.length) {
      return standings.map((s) => ({
        id: s.Driver.driverId,
        name: `${s.Driver.givenName} ${s.Driver.familyName}`,
        code: s.Driver.code,
        number: s.Driver.permanentNumber,
        team: s.Constructors?.[0]?.name || '',
        color: TEAM_COLORS[s.Constructors?.[0]?.constructorId] || '#888',
      }));
    }
    const dr = await fetchJson(`${JOLPICA}/drivers.json?limit=40`);
    return dr.MRData.DriverTable.Drivers.map((x) => ({ id: x.driverId, name: `${x.givenName} ${x.familyName}`, code: x.code, number: x.permanentNumber, team: '', color: '#888' }));
  }

  async overview(drivers) {
    const ids = new Set(drivers.map((d) => d.id));
    const [st, last, next] = await Promise.all([
      fetchJson(`${JOLPICA}/driverStandings.json?limit=40`).catch(() => null),
      fetchJson(`${JOLPICA}/last/results.json?limit=40`).catch(() => null),
      fetchJson(`${JOLPICA}/next.json`).catch(() => null),
    ]);
    const standings = (st?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || []).map((s) => ({
      pos: Number(s.position),
      id: s.Driver.driverId,
      name: s.Driver.familyName,
      code: s.Driver.code,
      team: s.Constructors?.[0]?.name || '',
      color: TEAM_COLORS[s.Constructors?.[0]?.constructorId] || '#888',
      points: Number(s.points),
      me: ids.has(s.Driver.driverId),
    }));
    const lastRace = last?.MRData?.RaceTable?.Races?.[0];
    const results = (lastRace?.Results || []).map((r) => ({
      pos: Number(r.position),
      id: r.Driver.driverId,
      name: r.Driver.familyName,
      code: r.Driver.code,
      status: r.status,
      color: TEAM_COLORS[r.Constructor?.constructorId] || '#888',
      me: ids.has(r.Driver.driverId),
    }));
    const nr = next?.MRData?.RaceTable?.Races?.[0];
    return {
      standings: standings.filter((s) => s.pos <= 3 || s.me),
      last: lastRace ? { name: gpName(lastRace.raceName), date: iso(lastRace), results: results.filter((r) => r.pos <= 3 || r.me) } : null,
      next: nr
        ? {
            name: gpName(nr.raceName),
            round: Number(nr.round),
            place: `${nr.Circuit?.Location?.locality || ''}`,
            race: iso(nr),
            sessions: [...SESSIONS.filter(([k]) => nr[k]).map(([k, id]) => ({ id, name: sessionName(id), start: iso(nr[k]) })), { id: 'race', name: sessionName('race'), start: iso(nr) }],
          }
        : null,
      favorites: drivers.map((d) => {
        const s = standings.find((x) => x.id === d.id);
        const r = results.find((x) => x.id === d.id);
        return { id: d.id, name: d.name, code: s?.code || d.code, pos: s?.pos ?? null, points: s?.points ?? 0, lastPos: r?.pos ?? null, color: s?.color || '#888' };
      }),
    };
  }

  track(drivers) {
    this.drivers = drivers;
    this.watching = drivers.length > 0;
  }

  /** A live race/qualifying/sprint session becomes a "game" for the live board. */
  async getScoreboard() {
    if (!this.watching) return [];
    const d = await fetchJson(ESPN);
    const out = [];
    for (const e of d.events || []) {
      for (const c of e.competitions || []) {
        const kind = c.type?.abbreviation;
        if (!['Race', 'Qual', 'SR', 'SS'].includes(kind)) continue;
        const state = c.status?.type?.state;
        if (state !== 'in') continue;
        const favNames = (this.drivers || []).map((x) => norm(x.name));
        const order = [...(c.competitors || [])]
          .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
          .map((x) => ({ pos: x.order, id: String(x.id), name: x.athlete?.displayName || '', short: x.athlete?.shortName || '', flag: x.athlete?.flag?.href || null, me: favNames.includes(norm(x.athlete?.displayName)) }));
        out.push({
          id: `f1:f1:${c.id}`,
          provider: 'f1',
          sport: 'f1',
          league: { key: 'f1', name: t('f1.title') },
          start: c.date,
          state: 'live',
          status: ESPN_SESSION[kind] ? sessionName(ESPN_SESSION[kind]) : kind,
          home: { id: '', name: '', abbr: '', logo: null, color: '#E10600', score: null },
          away: { id: '', name: '', abbr: '', logo: null, color: '#15151E', score: null },
          events: [],
          f1: { gp: gpName(e.name), session: ESPN_SESSION[kind] ? sessionName(ESPN_SESSION[kind]) : kind, lap: c.status?.period || null, order },
        });
      }
    }
    return out;
  }

  async getLiveDetail(g) {
    return g;
  }
}
