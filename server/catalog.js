import { t } from './lib/i18n.js';

/**
 * Supported competitions. `provider` picks the data source. `country` is a code localized
 * via locales/*.json → countries. `kind`: league | cup | continental | national.
 * Names are proper nouns; locales/*.json → leagues.<key> overrides the ones that translate.
 */
export const LEAGUES = [
  // ── Football: domestic leagues ──
  { key: 'esp.1', sport: 'soccer', provider: 'espn', name: 'LaLiga', country: 'ESP', kind: 'league' },
  { key: 'esp.2', sport: 'soccer', provider: 'espn', name: 'LaLiga Hypermotion', country: 'ESP', kind: 'league' },
  { key: 'eng.1', sport: 'soccer', provider: 'espn', name: 'Premier League', country: 'ENG', kind: 'league' },
  { key: 'eng.2', sport: 'soccer', provider: 'espn', name: 'Championship', country: 'ENG', kind: 'league' },
  { key: 'ita.1', sport: 'soccer', provider: 'espn', name: 'Serie A', country: 'ITA', kind: 'league' },
  { key: 'ger.1', sport: 'soccer', provider: 'espn', name: 'Bundesliga', country: 'GER', kind: 'league' },
  { key: 'fra.1', sport: 'soccer', provider: 'espn', name: 'Ligue 1', country: 'FRA', kind: 'league' },
  { key: 'por.1', sport: 'soccer', provider: 'espn', name: 'Liga Portugal', country: 'POR', kind: 'league' },
  { key: 'ned.1', sport: 'soccer', provider: 'espn', name: 'Eredivisie', country: 'NED', kind: 'league' },
  { key: 'bel.1', sport: 'soccer', provider: 'espn', name: 'Pro League', country: 'BEL', kind: 'league' },
  { key: 'tur.1', sport: 'soccer', provider: 'espn', name: 'Süper Lig', country: 'TUR', kind: 'league' },
  { key: 'sco.1', sport: 'soccer', provider: 'espn', name: 'Scottish Premiership', country: 'SCO', kind: 'league' },
  { key: 'usa.1', sport: 'soccer', provider: 'espn', name: 'MLS', country: 'USA', kind: 'league' },
  { key: 'mex.1', sport: 'soccer', provider: 'espn', name: 'Liga MX', country: 'MEX', kind: 'league' },
  { key: 'bra.1', sport: 'soccer', provider: 'espn', name: 'Brasileirão', country: 'BRA', kind: 'league' },
  { key: 'arg.1', sport: 'soccer', provider: 'espn', name: 'Liga Profesional', country: 'ARG', kind: 'league' },
  { key: 'ksa.1', sport: 'soccer', provider: 'espn', name: 'Saudi Pro League', country: 'KSA', kind: 'league' },
  // ── Football: cups ──
  { key: 'esp.copa_del_rey', sport: 'soccer', provider: 'espn', name: 'Copa del Rey', country: 'ESP', kind: 'cup' },
  { key: 'esp.super_cup', sport: 'soccer', provider: 'espn', name: 'Supercopa', country: 'ESP', kind: 'cup' },
  { key: 'eng.fa', sport: 'soccer', provider: 'espn', name: 'FA Cup', country: 'ENG', kind: 'cup' },
  { key: 'eng.league_cup', sport: 'soccer', provider: 'espn', name: 'Carabao Cup', country: 'ENG', kind: 'cup' },
  { key: 'ita.coppa_italia', sport: 'soccer', provider: 'espn', name: 'Coppa Italia', country: 'ITA', kind: 'cup' },
  { key: 'ger.dfb_pokal', sport: 'soccer', provider: 'espn', name: 'DFB-Pokal', country: 'GER', kind: 'cup' },
  { key: 'fra.coupe_de_france', sport: 'soccer', provider: 'espn', name: 'Coupe de France', country: 'FRA', kind: 'cup' },
  { key: 'por.taca.portugal', sport: 'soccer', provider: 'espn', name: 'Taça de Portugal', country: 'POR', kind: 'cup' },
  { key: 'ned.cup', sport: 'soccer', provider: 'espn', name: 'KNVB Beker', country: 'NED', kind: 'cup' },
  { key: 'usa.open', sport: 'soccer', provider: 'espn', name: 'US Open Cup', country: 'USA', kind: 'cup' },
  { key: 'mex.copa_mx', sport: 'soccer', provider: 'espn', name: 'Copa MX', country: 'MEX', kind: 'cup' },
  // ── Football: international club competitions ──
  { key: 'uefa.champions', sport: 'soccer', provider: 'espn', name: 'Champions League', country: 'EUR', kind: 'continental' },
  { key: 'uefa.europa', sport: 'soccer', provider: 'espn', name: 'Europa League', country: 'EUR', kind: 'continental' },
  { key: 'uefa.europa.conf', sport: 'soccer', provider: 'espn', name: 'Conference League', country: 'EUR', kind: 'continental' },
  { key: 'conmebol.libertadores', sport: 'soccer', provider: 'espn', name: 'Libertadores', country: 'SAM', kind: 'continental' },
  { key: 'conmebol.sudamericana', sport: 'soccer', provider: 'espn', name: 'Sudamericana', country: 'SAM', kind: 'continental' },
  { key: 'concacaf.champions', sport: 'soccer', provider: 'espn', name: 'Concacaf Champions Cup', country: 'NAM', kind: 'continental' },
  { key: 'concacaf.leagues.cup', sport: 'soccer', provider: 'espn', name: 'Leagues Cup', country: 'NAM', kind: 'continental' },
  { key: 'fifa.cwc', sport: 'soccer', provider: 'espn', name: 'Club World Cup', country: 'WORLD', kind: 'continental' },
  // ── Football: national teams ──
  { key: 'fifa.world', sport: 'soccer', provider: 'espn', name: 'World Cup', country: 'NAT', kind: 'national' },
  { key: 'fifa.worldq.uefa', sport: 'soccer', provider: 'espn', name: 'World Cup qualifying (UEFA)', country: 'NAT', kind: 'national' },
  { key: 'uefa.nations', sport: 'soccer', provider: 'espn', name: 'Nations League', country: 'NAT', kind: 'national' },
  { key: 'uefa.euro', sport: 'soccer', provider: 'espn', name: 'Euro', country: 'NAT', kind: 'national' },
  { key: 'uefa.euroq', sport: 'soccer', provider: 'espn', name: 'Euro qualifying', country: 'NAT', kind: 'national' },
  { key: 'conmebol.america', sport: 'soccer', provider: 'espn', name: 'Copa América', country: 'NAT', kind: 'national' },
  { key: 'fifa.friendly', sport: 'soccer', provider: 'espn', name: 'Friendly', country: 'NAT', kind: 'national' },
  // ── Basketball ──
  { key: 'nba', sport: 'basketball', provider: 'espn', name: 'NBA', country: 'USA', kind: 'league' },
  { key: 'wnba', sport: 'basketball', provider: 'espn', name: 'WNBA', country: 'USA', kind: 'league' },
  { key: 'euroleague', sport: 'basketball', provider: 'euroleague', name: 'EuroLeague', country: 'EUR', kind: 'continental', code: 'E' },
  { key: 'eurocup', sport: 'basketball', provider: 'euroleague', name: 'EuroCup', country: 'EUR', kind: 'continental', code: 'U' },
  { key: 'fiba', sport: 'basketball', provider: 'espn', name: 'FIBA', country: 'NAT', kind: 'national' },
  // ── American football & hockey ──
  { key: 'nfl', sport: 'football', provider: 'espn', name: 'NFL', country: 'USA', kind: 'league' },
  { key: 'nhl', sport: 'hockey', provider: 'espn', name: 'NHL', country: 'USA', kind: 'league' },
  // ── Baseball ──
  { key: 'mlb', sport: 'baseball', provider: 'mlb', name: 'MLB', country: 'USA', kind: 'league' },
];

export const leagueByKey = (key) => LEAGUES.find((l) => l.key === key);

/** Localized competition name. */
export function leagueName(key, fallback) {
  // Keys contain dots (fifa.world), so index the map instead of using a dotted path.
  const localized = t('leagues')?.[key];
  return localized || leagueByKey(key)?.name || fallback || key;
}

/** Catalog as served to the settings screen (localized). */
export const catalogView = () =>
  LEAGUES.map(({ key, sport, country, kind }) => ({ key, sport, kind, name: leagueName(key), country: t(`countries.${country}`) }));

const COUNTRY_PREFIX = { esp: 'ESP', eng: 'ENG', ita: 'ITA', ger: 'GER', fra: 'FRA', por: 'POR', ned: 'NED', bel: 'BEL', tur: 'TUR', sco: 'SCO', usa: 'USA', mex: 'MEX', bra: 'BRA', arg: 'ARG', ksa: 'KSA' };
const REGION = { ESP: 'EUR', ENG: 'EUR', ITA: 'EUR', GER: 'EUR', FRA: 'EUR', POR: 'EUR', NED: 'EUR', BEL: 'EUR', TUR: 'EUR', SCO: 'EUR', USA: 'NAM', MEX: 'NAM', BRA: 'SAM', ARG: 'SAM' };

/**
 * Every competition a team whose home competition is `home` could be playing in.
 * The favourites service keeps the ones where the team actually has recent or upcoming games.
 */
export function candidateCompetitions(home) {
  const l = leagueByKey(home);
  if (!l) return [home];
  if (l.sport !== 'soccer') return [home];
  if (l.kind === 'national') return LEAGUES.filter((x) => x.sport === 'soccer' && x.kind === 'national').map((x) => x.key);
  const country = COUNTRY_PREFIX[home.split('.')[0]] || l.country;
  const region = REGION[country];
  const list = LEAGUES.filter(
    (x) =>
      x.sport === 'soccer' &&
      x.kind !== 'national' &&
      ((x.country === country && (x.kind === 'cup' || x.key === home)) || (x.kind === 'continental' && (x.country === region || x.country === 'WORLD'))),
  ).map((x) => x.key);
  return [home, ...list.filter((k) => k !== home)];
}

/** Map an ESPN `defaultLeague` link (…/league/_/name/esp.1) to a catalog key. */
export function homeLeagueFromEspn(defaultLeague) {
  const href = defaultLeague?.links?.find((x) => /\/name\//.test(x.href))?.href || '';
  const slug = href.match(/\/name\/([^/?#]+)/)?.[1];
  return slug && leagueByKey(slug) ? slug : null;
}
