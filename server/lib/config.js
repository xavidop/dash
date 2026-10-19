import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = process.env.DASH_DATA_DIR ? path.resolve(process.env.DASH_DATA_DIR) : path.join(ROOT, 'data');

// Secrets (GEMINI_API_KEY) can live in a gitignored .env next to config.json; real env vars win.
const ENV_FILE = path.join(ROOT, '.env');
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    console.warn('[config] could not read .env:', err.message);
  }
}

const DEFAULTS = {
  port: 3000,
  userName: '',
  language: 'en',
  locale: null, // e.g. "en-US"; defaults to the language's locale
  timezone: null, // defaults to the system time zone
  clock24h: true,
  location: { mode: 'auto', fallback: null },
  rotationSeconds: 60,
  touchPauseSeconds: 120,
  nightMode: { enabled: true, start: '23:00', end: '07:00' },
  refresh: { weatherMinutes: 10, newsMinutes: 15, teamsMinutes: 30, liveIdleSeconds: 600, liveActiveSeconds: 20 },
  news: { maxAgeHours: 24, sources: [] },
  favorites: { teams: [], drivers: [], players: [] },
  liveLeagues: [],
  finance: { symbols: [], refreshMinutes: 5 },
  quote: { enabled: true },
  sportsNews: { enabled: true, perTeam: 4 },
  alerts: { enabled: true, areas: [] },
  airQuality: { enabled: true },
  // Optional features, each can be switched on/off here or in Settings → General.
  features: {
    alerts: true,
    airQuality: true,
    uv: true,
    holidays: true,
    moon: true,
    electricity: true,
    reminders: true,
    countdowns: true,
    whereToWatch: true,
    wifiQr: false,
    preMatch: true,
    matchday: true,
    radar: true,
    calendar: true,
    cooking: true,
    brackets: true, // playoff brackets during the postseason
    motion: false, // wake on motion (uses the camera; frames never leave the device)
    spotify: true, // shown only once spotify.clientId is set
    assistant: false, // also needs GEMINI_API_KEY
  },
  // showWhen: 'rain' (only when rain is likely) | 'always'. tiles: base map (OpenStreetMap by default;
  // point it to your own tile server for heavy use — keep {z}/{x}/{y}).
  radar: { showWhen: 'rain', tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap' },
  electricity: { region: 'peninsula' }, // peninsula | canarias | baleares | ceuta | melilla (Spain only)
  countdowns: { withinDays: 30 },
  wifi: { ssid: '', password: '', security: 'WPA', hidden: false },
  watchdog: { maxMemoryMB: 700, dailyReload: '04:00' },
  // iCal links (Google "secret address in iCal format", iCloud, Outlook, webcal://). Strings or
  // { name, url, color }. The Agenda panel and Today chips appear only when at least one is set.
  calendar: { urls: [], days: 14 },
  // Cooking mode: Gemini model used to read recipe pages that have no recipe card (needs the key).
  cooking: { model: 'gemini-3.8-flash' },
  // Spotify: the Client ID of your own Spotify app (developer.spotify.com/dashboard, free; the app
  // owner needs Premium). Redirect URI to register there: http://127.0.0.1:<port>/api/spotify/callback
  spotify: { clientId: '' },
  // Wake on motion: dim the screen after this many minutes without anyone around (0 = never dim);
  // sensitivity low | medium | high.
  motion: { dimAfterMinutes: 10, sensitivity: 'medium' },
  // Morning briefing spoken by the assistant at this local time ("07:30"; null = only on request).
  // weekdays: 0 = Sunday … 6 = Saturday.
  briefing: { time: null, weekdays: [1, 2, 3, 4, 5, 6, 0] },
  // Bin collection: [{ "name": "Recycling", "weekdays": [2, 5], "evening": true }]. evening: remind
  // the evening before (when bins go out) instead of on the day.
  bins: [],
  // "Hey Dash" voice assistant (Gemini Live). Needs GEMINI_API_KEY in the environment or .env.
  assistant: { model: 'gemini-3.8-live', voice: 'Kore', wakeWords: ['dash'], idleSeconds: 8, allowRemote: false },
};

export function loadConfig() {
  // config.json is personal (gitignored); config.example.json is the committed template.
  let file = process.env.DASH_CONFIG || path.join(ROOT, 'config.json');
  if (!process.env.DASH_CONFIG && !existsSync(file)) {
    file = path.join(ROOT, 'config.example.json');
    console.warn('[config] config.json not found, using config.example.json (copy it to config.json to customise)');
  }
  let user = {};
  if (existsSync(file)) user = JSON.parse(readFileSync(file, 'utf8'));
  const cfg = {
    ...DEFAULTS,
    ...user,
    location: { ...DEFAULTS.location, ...user.location },
    nightMode: { ...DEFAULTS.nightMode, ...user.nightMode },
    refresh: { ...DEFAULTS.refresh, ...user.refresh },
    news: { ...DEFAULTS.news, ...user.news },
    finance: { ...DEFAULTS.finance, ...user.finance },
    quote: { ...DEFAULTS.quote, ...user.quote },
    sportsNews: { ...DEFAULTS.sportsNews, ...user.sportsNews },
    alerts: { ...DEFAULTS.alerts, ...user.alerts },
    airQuality: { ...DEFAULTS.airQuality, ...user.airQuality },
    features: { ...DEFAULTS.features, ...user.features },
    electricity: { ...DEFAULTS.electricity, ...user.electricity },
    countdowns: { ...DEFAULTS.countdowns, ...user.countdowns },
    wifi: { ...DEFAULTS.wifi, ...user.wifi },
    watchdog: { ...DEFAULTS.watchdog, ...user.watchdog },
    radar: { ...DEFAULTS.radar, ...user.radar },
    calendar: { ...DEFAULTS.calendar, ...user.calendar },
    cooking: { ...DEFAULTS.cooking, ...user.cooking },
    spotify: { ...DEFAULTS.spotify, ...user.spotify },
    motion: { ...DEFAULTS.motion, ...user.motion },
    briefing: { ...DEFAULTS.briefing, ...user.briefing },
    bins: Array.isArray(user.bins) ? user.bins : DEFAULTS.bins,
    assistant: { ...DEFAULTS.assistant, ...user.assistant },
  };
  // Older configs switched these off in their own sections.
  if (user.alerts?.enabled === false) cfg.features.alerts = false;
  if (user.airQuality?.enabled === false) cfg.features.airQuality = false;
  cfg.timezone ||= Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  cfg.demo = process.argv.includes('--demo') || process.env.DASH_DEMO === '1';
  return cfg;
}
