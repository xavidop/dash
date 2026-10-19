import { fetchJson } from '../../lib/http.js';
import { SportsProvider, pickLastNext, norm } from './provider.js';
import { t, tn, ord, language } from '../../lib/i18n.js';

const API = 'https://statsapi.mlb.com/api';

// The Stats API has no team colors; primary colors keyed by MLB team id.
const COLORS = {
  108: '#BA0021', 109: '#A71930', 110: '#DF4601', 111: '#BD3039', 112: '#0E3386', 113: '#C6011F',
  114: '#00385D', 115: '#333366', 116: '#0C2340', 117: '#EB6E1F', 118: '#004687', 119: '#005A9C',
  120: '#AB0003', 121: '#FF5910', 133: '#003831', 134: '#FDB827', 135: '#2F241D', 136: '#0C2C56',
  137: '#FD5A1E', 138: '#C41E3A', 139: '#092C5C', 140: '#003278', 141: '#134A8E', 142: '#002B5C',
  143: '#E81828', 144: '#CE1141', 145: '#27251F', 146: '#00A3E0', 147: '#0C2340', 158: '#12284B',
};

const series = (code) => t(`mlb.series.${code}`);

export const logoUrl = (id) => `https://www.mlbstatic.com/team-logos/${id}.svg`;
export const headshotUrl = (id) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/w_160,q_auto:best,d_people:generic:headshot:67:current.png/v1/people/${id}/headshot/67/current`;


function madridDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

function mapStatus(g) {
  const st = g.status || {};
  const detailed = st.detailedState || '';
  const ls = g.linescore || {};
  if (/postponed/i.test(detailed)) return { state: 'postponed', status: t('status.postponed') };
  if (/cancel/i.test(detailed)) return { state: 'canceled', status: t('status.canceled') };
  if (/suspended/i.test(detailed)) return { state: 'postponed', status: t('status.suspended') };
  if (st.abstractGameState === 'Final') {
    const inn = ls.currentInning;
    return { state: 'final', status: inn && inn !== (ls.scheduledInnings || 9) ? t('status.finalInnings', { n: inn }) : t('status.final') };
  }
  if (st.abstractGameState === 'Live') {
    if (/delay/i.test(detailed)) return { state: 'delayed', status: t('status.delayed') };
    if (!ls.currentInning) return { state: 'live', status: t('status.inPlay') };
    const inn = ord(ls.currentInning, t('grammar.inning') === 'f' ? 'f' : 'm');
    switch (ls.inningState) {
      case 'Middle':
        return { state: 'break', status: t('status.inningMid', { n: inn }) };
      case 'End':
        return { state: 'break', status: t('status.inningEnd', { n: inn }) };
      case 'Bottom':
        return { state: 'live', status: `▼ ${inn}` };
      default:
        return { state: 'live', status: `▲ ${inn}` };
    }
  }
  return { state: 'pre', status: '' };
}

function teamRef(side) {
  const t = side.team || {};
  return {
    id: String(t.id),
    name: t.teamName || t.clubName || t.name,
    fullName: t.name,
    abbr: t.abbreviation || '',
    logo: logoUrl(t.id),
    color: COLORS[t.id] || null,
    altColor: null,
    score: side.score ?? null,
    winner: side.isWinner === true,
    record: side.leagueRecord ? `${side.leagueRecord.wins}-${side.leagueRecord.losses}` : null,
  };
}

function person(p) {
  return p?.id ? { id: p.id, name: p.fullName || '', headshot: headshotUrl(p.id) } : null;
}

function baseballState(ls) {
  if (!ls) return null;
  const off = ls.offense || {};
  const def = ls.defense || {};
  return {
    inning: ls.currentInning || 0,
    half: ls.isTopInning === false ? 'bottom' : 'top',
    inningState: ls.inningState || '',
    balls: ls.balls ?? 0,
    strikes: ls.strikes ?? 0,
    outs: ls.outs ?? 0,
    bases: { first: !!off.first, second: !!off.second, third: !!off.third },
    batter: person(off.batter),
    pitcher: person(def.pitcher),
    scheduledInnings: ls.scheduledInnings || 9,
    linescore: {
      innings: (ls.innings || []).map((i) => ({ n: i.num, away: i.away?.runs ?? null, home: i.home?.runs ?? null })),
      away: { r: ls.teams?.away?.runs ?? 0, h: ls.teams?.away?.hits ?? 0, e: ls.teams?.away?.errors ?? 0 },
      home: { r: ls.teams?.home?.runs ?? 0, h: ls.teams?.home?.hits ?? 0, e: ls.teams?.home?.errors ?? 0 },
    },
  };
}

export function normalizeGame(g) {
  const { state, status } = mapStatus(g);
  return {
    id: `mlb:mlb:${g.gamePk}`,
    gamePk: g.gamePk,
    provider: 'mlb',
    sport: 'baseball',
    league: { key: 'mlb', name: g.gameType && g.gameType !== 'R' ? `MLB · ${g.gameType in { F: 1, D: 1, L: 1, W: 1, S: 1, E: 1, A: 1 } ? series(g.gameType) : t('mlb.postseason')}` : 'MLB' },
    gameType: g.gameType,
    // Postseason: the series and game ("AL Championship Series · Game 5") and its status.
    postseason: ['F', 'D', 'L', 'W'].includes(g.gameType),
    // MLB's own series name says which league ("AL Championship Series"); it's English only.
    stage: ['F', 'D', 'L', 'W'].includes(g.gameType) && g.seriesGameNumber ? t('mlb.seriesGame', { series: (language === 'en' && g.seriesDescription) || series(g.gameType), n: g.seriesGameNumber }) : null,
    series: g.seriesStatus?.result || null,
    start: g.gameDate,
    timeTBD: g.status?.startTimeTBD === true,
    state,
    status,
    home: teamRef(g.teams.home),
    away: teamRef(g.teams.away),
    events: [],
    baseball: state === 'pre' ? null : baseballState(g.linescore),
    venue: g.venue?.name || null,
    broadcasts: (g.broadcasts || []).filter((b) => b.type === 'TV' && b.language !== 'es' && !/radio/i.test(b.name)).map((b) => ({ name: b.name, country: 'US' })),
  };
}

export class MlbProvider extends SportsProvider {
  async listTeams() {
    const d = await fetchJson(`${API}/v1/teams?sportId=1`);
    return d.teams
      .map((t) => ({ id: String(t.id), name: t.name, shortName: t.teamName, abbr: t.abbreviation, aliases: [t.name, t.teamName, t.clubName, t.abbreviation], logo: logoUrl(t.id), color: COLORS[t.id] || null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async resolveTeam(team) {
    const d = await fetchJson(`${API}/v1/teams?sportId=1`);
    const wanted = norm(team.name);
    const t = d.teams.find((x) => [x.name, x.teamName, x.clubName, x.abbreviation].some((n) => norm(n) === wanted));
    if (!t) throw new Error(`MLB team not found: ${team.name}`);
    return { id: String(t.id), name: t.name, logo: logoUrl(t.id), color: COLORS[t.id] || null, leagueId: t.league.id, divisionId: t.division.id };
  }

  async getTeamOverview(_team, resolved) {
    if (!resolved.divisionId) {
      // Favourites added from the settings screen only carry the id.
      const t = (await fetchJson(`${API}/v1/teams/${resolved.id}`)).teams[0];
      Object.assign(resolved, { leagueId: t.league.id, divisionId: t.division.id });
    }
    const sched = await fetchJson(
      `${API}/v1/schedule?sportId=1&teamId=${resolved.id}&startDate=${madridDate(-21)}&endDate=${madridDate(35)}` +
        '&gameType=R,F,D,L,W,S,E&hydrate=team,linescore,broadcasts(all),seriesStatus',
    );
    const games = sched.dates.flatMap((d) => d.games).map(normalizeGame);
    const { last, next } = pickLastNext(games);
    const standing = await this.standings(resolved).catch((err) => {
      console.warn('[mlb] standings:', err.message);
      return null;
    });
    if (standing) {
      const post = games.filter((g) => ['F', 'D', 'L', 'W'].includes(g.gameType));
      const lastPost = post.at(-1);
      if (lastPost && Date.now() - Date.parse(lastPost.start) < 10 * 864e5) standing.playoff = t('mlb.playoff.inPlayoffs', { series: series(lastPost.gameType) });
    }
    return { last, next, standing };
  }

  async standings(resolved) {
    const now = new Date();
    let season = now.getUTCFullYear();
    if (now.getUTCMonth() < 2) season -= 1; // before March: show last season
    const d = await fetchJson(`${API}/v1/standings?leagueId=${resolved.leagueId}&season=${season}&standingsTypes=regularSeason&hydrate=team`);
    const div = d.records.find((r) => r.division.id === resolved.divisionId);
    if (!div) return null;
    const rows = div.teamRecords.map((t) => ({
      rank: Number(t.divisionRank),
      name: t.team.teamName || t.team.name,
      logo: logoUrl(t.team.id),
      record: `${t.wins}-${t.losses}`,
      gb: t.gamesBack === '-' ? '—' : t.gamesBack,
      pct: t.winningPercentage,
      me: String(t.team.id) === resolved.id,
      clinch: t.clinchIndicator || null,
    }));
    const me = div.teamRecords.find((t) => String(t.team.id) === resolved.id);
    return {
      title: t(`mlb.divisions.${resolved.divisionId}`),
      group: null,
      rank: Number(me.divisionRank),
      record: `${me.wins}-${me.losses}`,
      gamesBack: me.gamesBack,
      wildCard: me.wildCardRank ? { rank: Number(me.wildCardRank), gamesBack: me.wildCardGamesBack } : null,
      streak: me.streak?.streakCode || null,
      playoff: playoffStatus(me),
      rows: rows.sort((a, b) => a.rank - b.rank),
      total: rows.length,
      season,
    };
  }

  async getScoreboard() {
    const d = await fetchJson(
      `${API}/v1/schedule?sportId=1&startDate=${madridDate(-1)}&endDate=${madridDate(1)}&gameType=R,F,D,L,W&hydrate=team,linescore,seriesStatus`,
    );
    return d.dates.flatMap((x) => x.games).map(normalizeGame);
  }

  /** Every MLB game between two days (YYYYMMDD), in one request. */
  async scheduleRange(fromYmd, toYmd) {
    const iso = (y) => `${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6, 8)}`;
    const d = await fetchJson(`${API}/v1/schedule?sportId=1&startDate=${iso(fromYmd)}&endDate=${iso(toYmd)}&gameType=R,F,D,L,W&hydrate=team,linescore,seriesStatus`);
    return (d.dates || []).flatMap((x) => x.games).map(normalizeGame);
  }

  /** Probable pitchers (and batting orders once posted) for an upcoming game. */
  async probables(gamePk) {
    const d = await fetchJson(`${API}/v1/schedule?sportId=1&gamePk=${gamePk}&hydrate=probablePitcher,lineups`);
    const g = d.dates?.[0]?.games?.[0];
    if (!g) return null;
    const pp = (side) => {
      const p = g.teams[side].probablePitcher;
      return p ? { id: p.id, name: p.fullName, headshot: headshotUrl(p.id) } : null;
    };
    const order = (list) => (list || []).map((p) => ({ name: p.fullName, number: p.primaryNumber || '', pos: p.primaryPosition?.abbreviation || '' }));
    return {
      pitchers: { home: pp('home'), away: pp('away') },
      lineups: g.lineups ? { home: order(g.lineups.homePlayers), away: order(g.lineups.awayPlayers) } : null,
    };
  }

  /** Full live feed: scoring plays and last play description on top of the scoreboard data. */
  async getLiveDetail(game) {
    const f = await fetchJson(
      `${API}/v1.1/game/${game.gamePk}/feed/live?fields=gameData,status,abstractGameState,detailedState,codedGameState,liveData,linescore,` +
        'currentInning,currentInningOrdinal,inningState,isTopInning,scheduledInnings,balls,strikes,outs,innings,num,home,away,runs,hits,errors,teams,' +
        'offense,defense,first,second,third,batter,pitcher,id,fullName,plays,allPlays,scoringPlays,currentPlay,result,description,event,eventType,' +
        'awayScore,homeScore,rbi,about,halfInning,inning,isScoringPlay,matchup',
    );
    const ls = f.liveData?.linescore;
    const merged = { ...game };
    if (ls) {
      merged.baseball = baseballState(ls);
      Object.assign(merged, mapStatus({ status: f.gameData?.status, linescore: ls }));
    }
    const plays = f.liveData?.plays;
    const all = plays?.allPlays || [];
    merged.events = (plays?.scoringPlays || [])
      .map((i) => all[i])
      .filter(Boolean)
      .map((p) => ({
        kind: 'run',
        minute: `${p.about.isTopInning ? '▲' : '▼'}${p.about.inning}`,
        side: p.about.isTopInning ? 'away' : 'home',
        player: p.matchup?.batter?.fullName || '',
        detail: translatePlay(p.result),
        runs: p.result?.rbi || 1,
      }));
    const lastDone = [...all].reverse().find((p) => p.about?.isComplete !== false && p.result?.description);
    merged.baseball && (merged.baseball.lastPlay = lastDone ? translatePlay(lastDone.result) : null);
    return merged;
  }
}

function playoffStatus(r) {
  const clinch = { z: 'bestRecord', y: 'division', w: 'wildcard', x: 'clinched' }[r.clinchIndicator];
  if (clinch) return t(`mlb.playoff.${clinch}`);
  if (r.eliminationNumber === 'E' || r.wildCardEliminationNumber === 'E') return t('mlb.playoff.eliminated');
  if (r.wildCardRank) {
    const gb = r.wildCardGamesBack === '-' ? t('mlb.playoff.inSpot') : t('mlb.playoff.behind', { gb: r.wildCardGamesBack });
    return t('mlb.playoff.wildcardRank', { rank: ord(Number(r.wildCardRank)), gb });
  }
  return null;
}

/** Short localized label for a play ("Home run · 2 runs"). */
function translatePlay(r) {
  if (!r) return '';
  const known = t(`mlb.plays.${r.eventType}`);
  const label = known !== `mlb.plays.${r.eventType}` ? known : r.event || '';
  return r.rbi ? `${label} · ${tn('mlb.runs', r.rbi)}` : label;
}
