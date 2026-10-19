export interface Section<T> {
  data: T | null;
  updatedAt: number | null;
  error: string | null;
}

export interface TeamRef {
  id: string;
  name: string;
  fullName?: string;
  abbr: string;
  logo: string | null;
  color: string | null;
  altColor?: string | null;
  score: number | null;
  winner?: boolean;
  record?: string | null;
}

export interface GameEvent {
  kind: 'goal' | 'own-goal' | 'penalty' | 'red' | 'yellow' | 'run';
  minute: string;
  side: 'home' | 'away';
  player: string;
  detail?: string;
}

export interface Person {
  id: number;
  name: string;
  headshot: string | null;
}

export interface Baseball {
  inning: number;
  half: 'top' | 'bottom';
  inningState?: string;
  balls: number;
  strikes: number;
  outs: number;
  bases: { first: boolean; second: boolean; third: boolean };
  batter?: Person | null;
  pitcher?: Person | null;
  lastPlay?: string | null;
  scheduledInnings?: number;
  linescore?: {
    innings: { n: number; away: number | null; home: number | null }[];
    away: { r: number; h: number; e: number };
    home: { r: number; h: number; e: number };
  };
}

export type GameState = 'pre' | 'live' | 'break' | 'final' | 'postponed' | 'canceled' | 'delayed';

export type Sport = 'soccer' | 'baseball' | 'basketball' | 'football' | 'hockey' | 'tennis' | 'f1';

export interface Game {
  id: string;
  provider: string;
  sport: Sport;
  league: { key: string; name: string };
  start: string;
  timeTBD?: boolean;
  state: GameState;
  status: string;
  home: TeamRef;
  away: TeamRef;
  events: GameEvent[];
  baseball?: Baseball | null;
  periods?: { period: number; clock: string; quarters: { home: number[]; away: number[] } };
  tennis?: { round: string; tournament: string; sets: { home: number; away: number }[] };
  f1?: { gp: string; session: string; lap: number | null; order: { pos: number; id: string; name: string; short: string; flag: string | null; me: boolean }[] };
  venue?: string | null;
  mine?: string | null;
  broadcasts?: { name: string; country: string }[];
  gamePk?: number;
  postseason?: boolean;
  stage?: string | null; // "West Finals - Game 2", "AL Championship Series · Game 5"
  series?: string | null; // "Series tied 2-2", "BOS leads series 3-1"
  playoffs?: boolean;
}

export interface StandingRow {
  rank: number;
  name: string;
  logo: string | null;
  points?: number;
  record?: string;
  gb?: string;
  me: boolean;
  noteColor?: string | null;
}

export interface F1Card {
  standings: { pos: number; id: string; name: string; code: string; team: string; color: string; points: number; me: boolean }[];
  last: { name: string; date: string; results: { pos: number; id: string; name: string; code: string; color: string; me: boolean }[] } | null;
  next: { name: string; round: number; place: string; race: string; sessions: { name: string; start: string }[] } | null;
  favorites: { id: string; name: string; code: string; pos: number | null; points: number; lastPos: number | null; color: string }[];
}

export interface TennisCard {
  rows: { id: string; name: string; tour: string; rank: number | null; flag: string | null; live: Game | null; last: Game | null; next: Game | null }[];
}

export interface WeatherAlert {
  level: 'yellow' | 'orange' | 'red';
  event: string;
  headline: string;
  area: string;
  onset: string;
  expires: string;
  description: string;
}

export interface Timer {
  id: string;
  label: string;
  seconds: number;
  startedAt: number;
  endsAt: number;
}

export interface Note {
  id: string;
  text: string;
  color: string;
  pinned: boolean;
  done: boolean;
  remindAt?: number | null;
  reminded?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Standing {
  title: string;
  group: string | null;
  rank: number;
  points?: number;
  played?: number;
  record?: string;
  gamesBack?: string;
  format?: 'points' | 'record';
  wildCard?: { rank: number; gamesBack: string } | null;
  streak?: string | null;
  playoff?: string | null;
  note?: string | null;
  rows: StandingRow[];
  total: number;
}

export interface CompetitionBlock {
  key: string;
  name: string;
  last: Game | null;
  next: Game | null;
  standing: Standing | null;
}

export interface TeamCard {
  key: string;
  name: string;
  sport: Sport;
  home?: string;
  color: string;
  altColor: string | null;
  logo: string | null;
  teamId: string | null;
  last?: Game | null;
  next?: Game | null;
  competitions?: CompetitionBlock[];
}

export interface Quote {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  open: boolean;
  time: number | null;
  spark: number[];
}

export interface SportsNewsItem {
  id: string;
  title: string;
  summary: string;
  image: string | null;
  source: string;
  publishedAt: string;
  tags: { key: string; name: string }[];
}

export interface Weather {
  place?: string;
  current: { temp: number; feels: number; desc: string; icon: string; isDay: boolean; humidity: number; wind: number; uv?: number | null };
  uvMax?: number | null;
  today: Day;
  rainSoon?: { time: string; prob: number; now: boolean } | null;
  hourly: { time: string; temp: number; icon: string; isDay: boolean; precip: number }[];
  daily: Day[];
}

export interface Day {
  date: string;
  max: number;
  min: number;
  icon: string;
  desc: string;
  precip: number;
  sunrise: string;
  sunset: string;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  link: string;
  image: string | null;
  source: string;
  publishedAt: string;
}

export interface PublicConfig {
  userName: string;
  language: string;
  locale: string | null;
  timezone: string;
  clock24h: boolean;
  rotationSeconds: number;
  touchPauseSeconds: number;
  nightMode: { enabled: boolean; start: string; end: string };
  refresh: { weatherMinutes: number; newsMinutes: number; teamsMinutes: number; financeMinutes: number };
  demo: { controls: { key: string; label: string }[] } | null;
  buildId: string;
  features: Features;
  wifi: { ssid: string; password: string; security: string; hidden: boolean } | null;
  countdownDays: number;
  radarShowWhen: 'rain' | 'always';
  motion: { dimAfterMinutes: number; sensitivity: 'low' | 'medium' | 'high' } | null;
  calendar: boolean;
  cooking: boolean;
  spotify: { connected: boolean; user: string | null; redirectUri: string } | null;
  briefing: { time: string; weekdays: number[] } | null;
  bins: { name: string; weekdays: number[]; evening: boolean }[];
  assistant: { wakeWords: string[]; idleSeconds: number } | null;
  assistantKey: boolean;
  radarTiles: string;
  radarAttribution: string;
  dailyReload: string | null;
}

export interface Features {
  alerts: boolean;
  airQuality: boolean;
  uv: boolean;
  holidays: boolean;
  moon: boolean;
  electricity: boolean;
  reminders: boolean;
  countdowns: boolean;
  whereToWatch: boolean;
  wifiQr: boolean;
  preMatch: boolean;
  matchday: boolean;
  radar: boolean;
  calendar: boolean;
  cooking: boolean;
  spotify: boolean;
  brackets: boolean;
  motion: boolean;
  assistant: boolean;
}

export interface SpotifyState {
  user: string | null;
  playing: boolean;
  progressMs: number;
  at: number;
  shuffle?: boolean;
  item: { name: string; by: string; album: string | null; image: string | null; durationMs: number; uri: string; kind?: 'track' | 'episode'; artist?: string | null } | null;
  device: { name: string; type: string; volume: number | null } | null;
}

export interface ShoppingItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

export interface CalendarEvent {
  id: string;
  title: string | null;
  start: string; // ISO instant, or YYYY-MM-DD when allDay
  end: string;
  allDay: boolean;
  location: string | null;
  calendar: string;
  color: string;
}

export interface Lineup {
  teamId: string;
  formation: string;
  starters: { name: string; number: string; pos: string }[];
}

export interface Preview {
  key: string;
  game: Game;
  lineups: Lineup[] | null;
  pitchers: { home: Person | null; away: Person | null } | null;
  standing: Standing | null;
}

export interface Round {
  key: string;
  name: string;
  sport: Sport;
  live: Game[];
  results: Game[];
  upcoming: Game[];
  followed?: boolean;
  playoffs?: boolean;
  table?: { format: 'points' | 'record'; groups: { group: string | null; rows: { rank: number; id: string; name: string; logo: string | null; played: number; points?: number; record?: string; noteColor: string | null }[] }[] } | null;
}

export interface Bracket {
  key: string;
  name: string;
  sport: Sport;
  rounds: {
    name: string;
    matchups: {
      id: string;
      conf: string | null;
      a: { id: string; name: string; abbr: string; logo: string | null; wins?: number; score?: number };
      b: { id: string; name: string; abbr: string; logo: string | null; wins?: number; score?: number };
      summary: string | null;
      winner: 'a' | 'b' | null;
      live: boolean;
      next: { start: string } | null;
    }[];
  }[];
}

export interface PowerPrice {
  hour: number;
  price: number;
  level: 'cheap' | 'mid' | 'expensive';
}

export interface Countdown {
  id: string;
  title: string;
  date: string;
  yearly: boolean;
}

export interface Sections {
  location?: Section<{ lat: number; lon: number; city: string; source: string; country?: string; region?: string }>;
  weather?: Section<Weather>;
  news?: Section<{ items: NewsItem[] }>;
  teams?: Section<{ teams: TeamCard[]; f1: F1Card | null; tennis: TennisCard | null }>;
  notes?: Section<Note[]>;
  finance?: Section<{ quotes: Quote[] }>;
  marketNews?: Section<{ items: NewsItem[] }>;
  airQuality?: Section<{ aqi: number | null; level: string | null; pm25: number | null; pollen: { type: string; value: number; level: string }[] }>;
  alerts?: Section<{ alerts: WeatherAlert[]; country: string }>;
  timers?: Section<{ timers: Timer[] }>;
  electricity?: Section<{
    date: string;
    region: string;
    prices: PowerPrice[];
    now: PowerPrice | null;
    min: number;
    max: number;
    avg: number;
    cheapest: { start: number; end: number; avg: number } | null;
    tomorrow: { date: string; prices: PowerPrice[]; cheapest: { start: number; end: number; avg: number } | null } | null;
  }>;
  holidays?: Section<{ today: { date: string; name: string } | null; tomorrow: { date: string; name: string } | null; next: { date: string; name: string } | null }>;
  countdowns?: Section<Countdown[]>;
  shopping?: Section<ShoppingItem[]>;
  cooking?: Section<Cooking | null>;
  spotify?: Section<SpotifyState | null>;
  calendar?: Section<{ events: CalendarEvent[]; calendars: { name: string; color: string; ok: boolean }[] }>;
  previews?: Section<{ previews: Preview[] }>;
  rounds?: Section<{ rounds: Round[] }>;
  brackets?: Section<{ brackets: Bracket[] }>;
  recipeIdeas?: Section<{ day: string; round: number; items: RecipeIdea[] }>;
  radar?: Section<{ host: string; frames: { time: number; path: string }[]; nowcastFrom: number }>;
  quote?: Section<{ text: string; author: string; date: string }>;
  sportsNews?: Section<{ items: SportsNewsItem[] }>;
  live?: Section<{ games: Game[]; failing: string[]; polledAt: number }>;
}

export interface AppState {
  config: PublicConfig | null;
  sections: Sections;
  serverOffset: number;
  connected: boolean;
}

export interface Celebration {
  gameId: string;
  sport: Sport;
  mine: string;
  side: 'home' | 'away';
  forMe: boolean;
  team: { name: string; logo: string | null; color: string | null; altColor: string | null };
  player: string;
  detail: string;
  runs: number;
  score: { home: number; away: number };
}

// ── Settings / favourites ──
export interface LeagueInfo {
  key: string;
  sport: 'soccer' | 'basketball' | 'baseball' | 'football' | 'hockey';
  name: string;
  country: string;
  kind: 'league' | 'cup' | 'continental' | 'national';
}
export interface CatalogTeam {
  id: string;
  name: string;
  shortName: string;
  logo: string | null;
  color: string | null;
  altColor?: string | null;
}
export interface FavTeam {
  key: string;
  league: string;
  leagueName?: string;
  competitions?: string[];
  name: string;
  displayName?: string;
  id?: string;
  logo?: string;
  color?: string;
  altColor?: string;
  enabled?: boolean;
  resolvedId?: string;
}
export interface Favorites {
  teams: FavTeam[];
  drivers: { id: string; name: string; code: string }[];
  players: { id: string; name: string; tour: 'atp' | 'wta'; flag?: string | null }[];
  symbols: string[];
  leagues?: string[];
}

export interface GeneralSettings {
  language: string;
  userName: string;
  timezone: string;
  clock24h: boolean;
  rotationSeconds: number;
  touchPauseSeconds: number;
  nightMode: { enabled: boolean; start: string; end: string };
  features: Features;
  wifi: { ssid: string; password: string; security: string; hidden: boolean };
  electricity: { region: string };
  countdowns: { withinDays: number };
  radar: { showWhen: 'rain' | 'always' };
  calendar: { urls: ({ name?: string; url: string; color?: string } | string)[]; days?: number };
  briefing: { time: string | null; weekdays: number[] };
  motion: { dimAfterMinutes: number; sensitivity: 'low' | 'medium' | 'high' };
}

export interface RecipeIdea {
  id: string;
  title: string;
  image: string;
  category: string;
  area: string | null;
  ingredients: number;
  steps: number;
}

export interface Cooking {
  recipeId: string;
  title: string;
  source: string | null;
  image: string | null;
  servings: string | null;
  totalMinutes: number | null;
  ingredients: string[];
  steps: { text: string; minutes: number | null }[];
  step: number;
  startedAt: number;
}
