import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig, ROOT } from './lib/config.js';
import { setLanguage, LANGUAGES } from './lib/i18n.js';
import { readFileSync } from 'node:fs';
import { Store } from './lib/store.js';
import { Db } from './lib/db.js';
import { leagueByKey, catalogView, leagueName } from './catalog.js';
import { LocationProvider } from './providers/location.js';
import { WeatherProvider } from './providers/weather.js';
import { NewsProvider } from './providers/news.js';
import { FinanceProvider } from './providers/finance.js';
import { QuoteProvider } from './providers/quote.js';
import { SportsNewsProvider } from './providers/sportsNews.js';
import { AirQualityProvider } from './providers/airQuality.js';
import { AlertsProvider } from './providers/alerts.js';
import { TimersService } from './services/timers.js';
import { AssistantService } from './services/assistant.js';
import { CookingService } from './services/cooking.js';
import { SpotifyService, SpotifyError } from './providers/spotify.js';
import { CalendarProvider } from './providers/calendar.js';
import { ElectricityProvider } from './providers/electricity.js';
import { HolidaysProvider } from './providers/holidays.js';
import { RadarProvider } from './providers/radar.js';
import { MatchdayService, ROUNDS_VERSION } from './services/matchday.js';
import { BracketService } from './services/brackets.js';
import { RecipeIdeas } from './services/recipeIdeas.js';
import { lyricsFor } from './providers/lyrics.js';
import { statSync } from 'node:fs';
import { pausedHosts, requestsLastHour } from './lib/http.js';
import QRCode from 'qrcode';
import { createSportsProviders } from './providers/sports/index.js';
import { DemoProvider } from './providers/sports/demo.js';
import { FavoritesService } from './services/favorites.js';
import { LiveTracker } from './services/live.js';

const config = loadConfig();

// General settings editable on the Settings screen (stored as overrides in data/db.json).
const SETTING_KEYS = ['language', 'userName', 'timezone', 'clock24h', 'rotationSeconds', 'touchPauseSeconds', 'nightMode', 'features', 'wifi', 'electricity', 'countdowns', 'radar', 'calendar', 'briefing', 'motion'];
const OBJECT_SETTINGS = new Set(['nightMode', 'features', 'wifi', 'electricity', 'countdowns', 'radar', 'calendar', 'briefing', 'motion']);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const base = structuredClone(pick(config, SETTING_KEYS)); // config.json values, before on-screen overrides
const db = new Db({ ...config.favorites, symbols: config.finance.symbols || [] }, base);
function applySettings() {
  const o = db.settings();
  for (const k of SETTING_KEYS) if (o[k] !== undefined) config[k] = OBJECT_SETTINGS.has(k) ? { ...base[k], ...o[k] } : o[k];
  if (!LANGUAGES.includes(config.language)) {
    console.warn(`[i18n] language "${config.language}" not found in locales/, using English`);
    config.language = 'en';
  }
  setLanguage(config.language);
}
applySettings();

const store = new Store();
const location = new LocationProvider(config, store);
const sports = createSportsProviders();
const favorites = new FavoritesService({ config, store, db, providers: sports });
const symbols = () => db.favorites().symbols || [];
const finance = new FinanceProvider(symbols);

// Providers that depend on language/timezone are rebuilt when those settings change.
let weather, news, marketNews, quote, sportsNews, airQuality, alerts, electricity, calendar, newsCountry;
const holidays = new HolidaysProvider();
const radar = new RadarProvider();
function buildProviders() {
  electricity = new ElectricityProvider(config);
  weather = new WeatherProvider(config);
  airQuality = new AirQualityProvider(config);
  alerts = new AlertsProvider(config);
  newsCountry = location.current()?.country || null;
  news = new NewsProvider({ language: config.language, country: newsCountry, sources: config.news.sources, maxAgeHours: config.news.maxAgeHours });
  marketNews = new NewsProvider({ language: config.language, country: newsCountry, sources: config.finance.newsSources, maxAgeHours: 48, kind: 'markets', symbols });
  calendar = new CalendarProvider({ calendars: config.calendar.urls, days: config.calendar.days, timezone: config.timezone });
  quote = new QuoteProvider(config);
  sportsNews = new SportsNewsProvider(config);
}
buildProviders();

store.set('notes', db.notes());
const timers = new TimersService(store);
const cooking = new CookingService({ config, store, db, timers });
// Spotify's catalogue differs per country: the display's country picks it ("market").
const spotify = new SpotifyService({ config, store, country: () => location.current()?.country || null });
// Cached data in another language would show mixed strings until refreshed.
if (store.getMeta('language') !== config.language) {
  for (const k of ['weather', 'teams', 'sportsNews', 'quote', 'live', 'alerts']) delete store.sections[k];
  store.setMeta('language', config.language);
  store.setMeta('resolvedTeams', {});
  favorites.resolved = {};
}

// ─── SSE hub ────────────────────────────────────────────────
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
store.on('update', (key, section) => broadcast('update', { key, section }));

// ─── Refresh jobs ───────────────────────────────────────────
/**
 * Runs `fn` now and every `ms`. With `fresh(ms)` returning true, the first run waits until the cached
 * data is due instead: a restart (or every save under `npm run dev`) shouldn't re-download
 * everything, which is how a burst of restarts gets a source to start refusing us.
 */
function every(ms, fn, fresh = null) {
  const run = () => fn().catch((err) => console.warn('[job]', err.message));
  const age = fresh?.(ms);
  if (age == null) run();
  setTimeout(() => {
    if (age != null) run();
    setInterval(run, ms);
  }, age == null ? ms : Math.max(5e3, ms - age)).unref?.();
}

/** Age of a cached section if it's still fresh (and error-free), else null. */
const freshFor = (section, valid = () => true) => (ms) => {
  const s = store.get(section);
  const age = s?.updatedAt ? Date.now() - s.updatedAt : Infinity;
  return s?.data && !s.error && age < ms && valid() ? age : null;
};
// Team cards are only reusable if they were built for the favourites we have now.
const favoritesSig = () => JSON.stringify([db.favorites().teams, db.favorites().leagues, db.favorites().drivers, db.favorites().players]);

/** Run a provider and store its result, keeping the last good data on failure. */
const job = (key, fn) => async () => {
  try {
    store.set(key, await fn());
  } catch (err) {
    store.fail(key, err);
  }
};

const refreshWeather = async () => {
  const loc = location.current();
  if (loc) await job('weather', async () => ({ ...(await weather.fetch(loc)), place: loc.city }))();
};
const refreshAirQuality = async () => {
  const loc = location.current();
  if (loc && config.features.airQuality) await job('airQuality', () => airQuality.fetch(loc))();
};
const refreshAlerts = async () => {
  const loc = location.current();
  if (loc && config.features.alerts) await job('alerts', () => alerts.fetch(loc))();
};
// PVPC is Spain's regulated tariff: only fetched when the display is in Spain.
const refreshElectricity = async () => {
  if (config.features.electricity && location.current()?.country === 'ES') await job('electricity', () => electricity.fetch())();
};
const MAX_FOLLOWED = 25;
const followedLeagues = () => (db.favorites().leagues || []).filter((k) => leagueByKey(k));
const matchday = new MatchdayService({ config, store, providers: sports, followed: followedLeagues });
const refreshPreviews = async () => (config.features.preMatch ? job('previews', () => matchday.previews())() : undefined);
// Playoff brackets for leagues you follow or your teams play in (only while a postseason is on).
const brackets = new BracketService({
  store,
  providers: { espn: sports.espn, euroleague: sports.euroleague },
  followed: followedLeagues,
  homes: () => (store.get('teams')?.data?.teams || []).flatMap((c) => [c.home, ...(c.competitions || []).map((x) => x.key)]).filter(Boolean),
});
const refreshBrackets = async () => (config.features.brackets ? job('brackets', () => brackets.all())() : undefined);
// "What to cook": a few recipe ideas a day (TheMealDB), part of cooking mode.
const recipeIdeas = new RecipeIdeas({ config, store });
const refreshRecipeIdeas = async (opts) => (config.features.cooking ? job('recipeIdeas', () => recipeIdeas.ideas(opts))() : undefined);
const refreshRounds = async () => (config.features.matchday ? job('rounds', () => matchday.rounds())() : undefined);
const refreshRadar = async () => (config.features.radar ? job('radar', () => radar.fetch())() : undefined);

const calendarOn = () => config.features.calendar && [].concat(config.calendar.urls || []).length > 0;
const refreshCalendar = async () => (calendarOn() ? job('calendar', () => calendar.fetch())() : undefined);

const refreshHolidays = async () => {
  const loc = location.current();
  if (config.features.holidays && loc?.country) await job('holidays', () => holidays.fetch({ country: loc.country, region: loc.region, timezone: config.timezone, language: config.language }))();
};

async function refreshFavorites(opts) {
  try {
    await favorites.refresh(opts);
    store.setMeta('teamsFor', favoritesSig());
  } catch (err) {
    store.fail('teams', err);
  }
  // New team cards can mean a game entered the pre-match window, or new leagues to show rounds for.
  refreshPreviews().catch(() => {});
  const shown = (store.get('rounds')?.data?.rounds || []).map((r) => r.key).sort().join();
  if (shown !== matchday.roundLeagues().sort().join()) refreshRounds().catch(() => {});
}

/** What the sports news should be about. */
function newsTargets() {
  const cards = store.get('teams')?.data?.teams || [];
  return {
    teams: favorites.teams().map((f) => {
      const card = cards.find((c) => c.key === f.key);
      return { key: f.key, name: card?.name || f.displayName || f.name, sport: leagueByKey(f.league)?.sport, id: favorites.resolved[f.key]?.id, home: card?.home || f.league };
    }),
    drivers: favorites.drivers(),
    players: favorites.players(),
    leagues: followedLeagues().map((k) => ({ key: k, name: leagueName(k) })),
  };
}

const refreshFinance = job('finance', () => finance.fetch());
const refreshMarketNews = async () => (symbols().length ? job('marketNews', () => (newsFor(), marketNews.fetch()))() : undefined);
// News defaults depend on the country too (es-MX ≠ es-ES): rebuild once the location is known.
const newsFor = () => {
  if ((location.current()?.country || null) !== newsCountry) buildProviders();
};
const refreshNews = job('news', () => (newsFor(), news.fetch()));
const refreshQuote = job('quote', () => quote.fetch());
const refreshSportsNews = job('sportsNews', () => sportsNews.fetch(newsTargets()));

let live = null;
let demo = null;

// Followed leagues are polled whole: all their live games feed the Live panel and the ticker.
const liveLeagues = () => (demo ? demo.leagues() : [...config.liveLeagues, ...favorites.liveLeagues(), ...followedLeagues().map((k) => ({ provider: leagueByKey(k).provider, league: k }))]);

async function start() {
  // Location first (weather depends on it); everything else in parallel.
  await location.init().catch((err) => console.warn('[location]', err.message));
  const r = config.refresh;
  every(r.weatherMinutes * 60e3, refreshWeather);
  every(30 * 60e3, refreshAirQuality);
  every(15 * 60e3, refreshAlerts);
  every(30 * 60e3, refreshElectricity);
  every(6 * 3600e3, refreshHolidays, freshFor('holidays'));
  every(r.newsMinutes * 60e3, refreshNews);
  every(config.finance.refreshMinutes * 60e3, refreshFinance);
  every(r.newsMinutes * 60e3, refreshMarketNews);
  if (config.quote.enabled) every(60 * 60e3, refreshQuote);
  await favorites.resolveAll();
  // Cached cards are reused after a restart only if they were built for these favourites and none is
  // empty (an empty card usually means the source failed while it was being built).
  const cardsComplete = () => (store.get('teams')?.data?.teams || []).every((c) => c.last || c.next);
  // …and only if they are exactly the cards Dash would build now (one per team, in order).
  const sameCards = () => (store.get('teams')?.data?.teams || []).map((c) => c.key).join() === favorites.teams().map((t) => t.key).join();
  every(r.teamsMinutes * 60e3, refreshFavorites, freshFor('teams', () => store.getMeta('teamsFor') === favoritesSig() && cardsComplete() && sameCards()));
  // Line-ups appear ~1 h before kickoff: check often; rounds and radar on their own clocks.
  every(5 * 60e3, refreshPreviews);
  every(30 * 60e3, refreshBrackets, freshFor('brackets'));
  every(15 * 60e3, refreshRounds, freshFor('rounds', () => {
    const r = store.get('rounds')?.data;
    return r?.version === ROUNDS_VERSION && r?.day === new Date().toLocaleDateString('en-CA', { timeZone: config.timezone }).replaceAll('-', '');
  }));
  every(10 * 60e3, refreshRadar);
  every(15 * 60e3, refreshCalendar);
  every(60 * 60e3, refreshRecipeIdeas); // cheap: a new set only when the day changes
  if (config.sportsNews.enabled) setTimeout(() => every(r.newsMinutes * 60e3, refreshSportsNews, freshFor('sportsNews')), 15e3);

  if (config.demo) {
    demo = new DemoProvider({ favorites, providers: sports });
    await demo.prepare();
    config.refresh.liveActiveSeconds = 3;
  }
  live = new LiveTracker({
    config,
    store,
    providers: sports,
    favorites,
    leagues: liveLeagues(),
    followed: followedLeagues,
    onCelebration: (c) => {
      console.log(`[live] ${c.forMe ? 'celebration' : 'rival scored'}: ${c.team.name} ${c.player}`);
      broadcast('celebration', c);
    },
  });
  live.start();
  if (demo) broadcast('snapshot', snapshot()); // demo controls are known now
}

// ─── HTTP ───────────────────────────────────────────────────
const app = express();
// Backups can be large (recipes, notes): that one route gets its own, bigger limit.
const jsonSmall = express.json({ limit: '200kb' });
app.use((req, res, next) => (req.path === '/api/backup/restore' ? next() : jsonSmall(req, res, next)));

// The page reloads itself when the built frontend changes (npm run build while running).
const DIST_INDEX = path.join(ROOT, 'web', 'dist', 'index.html');
const buildId = () => {
  try {
    return String(statSync(DIST_INDEX).mtimeMs);
  } catch {
    return 'dev';
  }
};

const publicConfig = () => ({
  buildId: buildId(),
  features: config.features,
  wifi: config.features.wifiQr && config.wifi.ssid ? { ssid: config.wifi.ssid, password: config.wifi.password, security: config.wifi.security, hidden: config.wifi.hidden } : null,
  countdownDays: config.countdowns.withinDays,
  radarShowWhen: config.radar.showWhen,
  motion: config.features.motion ? config.motion : null,
  calendar: calendarOn(),
  cooking: config.features.cooking,
  spotify: spotify.enabled ? { connected: spotify.connected, user: spotify.tokens?.user || null, redirectUri: spotify.redirectUri() } : null,
  briefing: assistant.enabled && config.briefing.time ? config.briefing : null,
  bins: config.bins.map((b) => ({ name: String(b.name || ''), weekdays: [].concat(b.weekdays || []).map(Number), evening: !!b.evening })),
  assistant: assistant.enabled ? { wakeWords: config.assistant.wakeWords, idleSeconds: config.assistant.idleSeconds } : null,
  assistantKey: !!assistant.key,
  radarTiles: config.radar.tiles,
  radarAttribution: config.radar.attribution,
  dailyReload: config.watchdog.dailyReload,
  userName: config.userName,
  language: config.language,
  locale: config.locale,
  timezone: config.timezone,
  clock24h: config.clock24h,
  rotationSeconds: config.rotationSeconds,
  touchPauseSeconds: config.touchPauseSeconds,
  nightMode: config.nightMode,
  refresh: { ...config.refresh, financeMinutes: config.finance.refreshMinutes },
  demo: config.demo ? { controls: demo?.controls() || [] } : null,
});

const snapshot = () => ({ config: publicConfig(), sections: store.snapshot(), serverTime: Date.now() });

app.get('/api/state', (_req, res) => res.json(snapshot()));

app.get('/api/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  res.write(`retry: 3000\n`);
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res);
  // Named event (not a comment) so the page can tell a silent, half-dead connection from a quiet one.
  const ping = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 25e3);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

app.post('/api/location', async (req, res) => {
  const { lat, lon, accuracy } = req.body || {};
  try {
    const changed = await location.fromDevice(Number(lat), Number(lon), Number(accuracy));
    if (changed) {
      refreshWeather();
      refreshAirQuality();
      refreshAlerts();
    }
    res.json({ ok: true, changed, location: location.current() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Catalog (for the settings screen) ──────────────────────
const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};

app.get('/api/catalog/leagues', (_req, res) => res.json(catalogView()));
app.get(
  '/api/catalog/teams',
  wrap(async (req) => {
    const league = leagueByKey(String(req.query.league));
    if (!league) throw new Error('unknown league');
    return sports[league.provider].listTeams(league.key);
  }),
);
app.get('/api/catalog/drivers', wrap(() => sports.f1.listDrivers()));
app.get(
  '/api/catalog/symbols',
  wrap(async (req) => {
    const q = String(req.query.q || '').trim();
    return q.length < 1 ? [] : finance.search(q.slice(0, 40), config.language);
  }),
);

// ─── General settings (Settings → General) ──────────────────
const LANGUAGE_NAMES = Object.fromEntries(
  LANGUAGES.map((l) => {
    try {
      return [l, JSON.parse(readFileSync(path.join(ROOT, 'locales', `${l}.json`), 'utf8')).meta?.name || l];
    } catch {
      return [l, l];
    }
  }),
);
app.get('/api/settings', (_req, res) =>
  res.json({
    settings: pick(config, SETTING_KEYS),
    languages: LANGUAGES.map((code) => ({ code, name: LANGUAGE_NAMES[code] })),
    timezones: Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [config.timezone],
  }),
);
app.put('/api/settings', async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (typeof b.language === 'string' && LANGUAGES.includes(b.language)) patch.language = b.language;
  if (typeof b.userName === 'string') patch.userName = b.userName.trim().slice(0, 40);
  if (typeof b.timezone === 'string') {
    try {
      new Intl.DateTimeFormat('en', { timeZone: b.timezone });
      patch.timezone = b.timezone;
    } catch {}
  }
  if (typeof b.clock24h === 'boolean') patch.clock24h = b.clock24h;
  if (Number.isFinite(b.rotationSeconds)) patch.rotationSeconds = Math.min(600, Math.max(10, Math.round(b.rotationSeconds)));
  if (b.nightMode && typeof b.nightMode === 'object') {
    const hhmm = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : undefined);
    patch.nightMode = { enabled: b.nightMode.enabled !== false, start: hhmm(b.nightMode.start) || config.nightMode.start, end: hhmm(b.nightMode.end) || config.nightMode.end };
  }
  if (b.features && typeof b.features === 'object') {
    patch.features = { ...(db.settings().features || {}) };
    for (const k of Object.keys(config.features)) if (typeof b.features[k] === 'boolean') patch.features[k] = b.features[k];
  }
  if (b.wifi && typeof b.wifi === 'object') {
    patch.wifi = {
      ssid: String(b.wifi.ssid ?? config.wifi.ssid).slice(0, 32),
      password: String(b.wifi.password ?? config.wifi.password).slice(0, 63),
      security: ['WPA', 'WEP', 'nopass'].includes(b.wifi.security) ? b.wifi.security : config.wifi.security,
      hidden: typeof b.wifi.hidden === 'boolean' ? b.wifi.hidden : config.wifi.hidden,
    };
  }
  if (b.electricity && ['peninsula', 'canarias', 'baleares', 'ceuta', 'melilla'].includes(b.electricity.region)) patch.electricity = { region: b.electricity.region };
  if (b.countdowns && Number.isFinite(b.countdowns.withinDays)) patch.countdowns = { withinDays: Math.min(366, Math.max(1, Math.round(b.countdowns.withinDays))) };
  if (b.radar && ['rain', 'always'].includes(b.radar.showWhen)) patch.radar = { showWhen: b.radar.showWhen };
  // Calendar links pasted in Settings (private iCal addresses): http(s) or webcal, up to 10.
  if (b.calendar && Array.isArray(b.calendar.urls)) {
    patch.calendar = {
      urls: b.calendar.urls
        .map((c) => (typeof c === 'string' ? { url: c } : c))
        .filter((c) => c && /^(https?|webcals?):\/\/\S+$/i.test(String(c.url || '').trim()))
        .slice(0, 10)
        .map((c) => ({ name: String(c.name || '').trim().slice(0, 40), url: String(c.url).trim(), ...(c.color && /^#[0-9a-f]{6}$/i.test(c.color) ? { color: c.color } : {}) })),
    };
  }
  if (b.motion && typeof b.motion === 'object') {
    patch.motion = {
      dimAfterMinutes: [0, 5, 10, 20, 30, 60].includes(Number(b.motion.dimAfterMinutes)) ? Number(b.motion.dimAfterMinutes) : config.motion.dimAfterMinutes,
      sensitivity: ['low', 'medium', 'high'].includes(b.motion.sensitivity) ? b.motion.sensitivity : config.motion.sensitivity,
    };
  }
  if (b.briefing && typeof b.briefing === 'object') {
    patch.briefing = {
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(b.briefing.time) ? b.briefing.time : null,
      weekdays: Array.isArray(b.briefing.weekdays) ? [...new Set(b.briefing.weekdays.map(Number).filter((d) => d >= 0 && d <= 6))] : config.briefing.weekdays,
    };
  }
  const before = { ...pick(config, ['language', 'timezone']), features: { ...config.features }, region: config.electricity.region, calendars: JSON.stringify(config.calendar.urls) };
  db.setSettings(patch);
  applySettings();
  res.json({ settings: pick(config, SETTING_KEYS) });

  // Apply live: language/timezone changes re-localize every section.
  const relocalize = before.language !== config.language || before.timezone !== config.timezone;
  const turnedOn = (k) => config.features[k] && !before.features[k];
  if (relocalize || before.region !== config.electricity.region) buildProviders();
  if (turnedOn('electricity') || before.region !== config.electricity.region) refreshElectricity();
  if (turnedOn('holidays')) refreshHolidays();
  if (turnedOn('alerts')) refreshAlerts();
  if (turnedOn('airQuality')) refreshAirQuality();
  if (turnedOn('preMatch')) refreshPreviews();
  if (turnedOn('matchday')) refreshRounds();
  if (turnedOn('radar')) refreshRadar();
  if (before.calendars !== JSON.stringify(config.calendar.urls)) {
    buildProviders();
    if (calendarOn()) refreshCalendar();
    else store.set('calendar', { events: [], calendars: [] });
  } else if (turnedOn('calendar')) refreshCalendar();
  if (turnedOn('cooking')) refreshRecipeIdeas();
  if (relocalize) {
    if (before.language !== config.language) {
      sports.espn.teamLists.clear();
      favorites.resolved = {};
      store.setMeta('resolvedTeams', {});
      store.setMeta('language', config.language);
    }
  }
  broadcast('snapshot', snapshot());
  if (relocalize) {
    await Promise.allSettled([refreshWeather(), refreshNews(), refreshQuote(), refreshMarketNews(), refreshAirQuality(), refreshAlerts(), refreshHolidays()]);
    await favorites.resolveAll();
    await refreshFavorites({ force: true });
    // Statuses ("Final", "Halbzeit") are translated server-side: redo the round results too.
    refreshRounds();
    refreshSportsNews();
    refreshRecipeIdeas();
    live?.pollNow();
  }
});
app.get('/api/catalog/players', wrap((req) => sports.tennis.listPlayers(req.query.tour === 'wta' ? 'wta' : 'atp')));

// ─── Favourites (local DB) ──────────────────────────────────
const favoritesView = () => {
  const f = db.favorites();
  const cards = store.get('teams')?.data?.teams || [];
  return {
    ...f,
    teams: f.teams.map((t) => ({
      ...t,
      // Defaults from config are matched by name: show the crest and competitions found for them.
      logo: t.logo || favorites.resolved[t.key]?.logo || undefined,
      // The id Dash found for name-only favourites, so Settings recognises them in any list.
      resolvedId: t.id || favorites.resolved[t.key]?.id || undefined,
      competitions: (cards.find((c) => c.key === t.key)?.competitions || []).map((c) => c.name),
      leagueName: leagueName(t.league),
    })),
  };
};
app.get('/api/favorites', (_req, res) => res.json(favoritesView()));
app.put('/api/favorites', async (req, res) => {
  const body = req.body || {};
  const clean = {};
  if (Array.isArray(body.teams)) {
    clean.teams = body.teams
      .filter((t) => t && leagueByKey(t.league) && (t.name || t.id))
      .map((t) => ({
        key: String(t.key || `${t.league}-${t.id || t.name}`).slice(0, 80),
        league: t.league,
        name: String(t.name || '').slice(0, 80),
        displayName: t.displayName ? String(t.displayName).slice(0, 80) : undefined,
        id: t.id != null ? String(t.id) : undefined,
        logo: t.logo || undefined,
        color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : undefined,
        altColor: /^#[0-9a-f]{6}$/i.test(t.altColor || '') ? t.altColor : undefined,
        enabled: t.enabled !== false,
      }));
  }
  if (Array.isArray(body.drivers)) clean.drivers = body.drivers.filter((d) => d?.id).map((d) => ({ id: String(d.id), name: String(d.name || ''), code: d.code || '' }));
  if (Array.isArray(body.symbols))
    clean.symbols = [...new Set(body.symbols.map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z0-9.\-^=]{1,20}$/.test(x)))].slice(0, 12);
  if (Array.isArray(body.leagues)) {
    const leagues = [...new Set(body.leagues.map(String).filter((k) => leagueByKey(k)))];
    if (leagues.length > MAX_FOLLOWED) return res.status(400).json({ error: `you can follow up to ${MAX_FOLLOWED} leagues` });
    clean.leagues = leagues;
  }
  if (Array.isArray(body.players))
    clean.players = body.players.filter((p) => p?.id).map((p) => ({ id: String(p.id), name: String(p.name || ''), tour: p.tour === 'wta' ? 'wta' : 'atp', flag: p.flag || null }));
  db.setFavorites(clean);
  res.json(favoritesView());
  if (clean.symbols) {
    refreshFinance();
    refreshMarketNews();
  }
  if (clean.leagues) {
    refreshBrackets();
    refreshRounds();
    refreshSportsNews();
  }
  // Rebuild in the background: resolve new teams, rebuild cards, re-target live polling.
  try {
    await favorites.resolveAll();
    await refreshFavorites();
    live?.setLeagues(liveLeagues());
    live?.pollNow();
  } catch (err) {
    console.warn('[favorites] rebuild failed:', err.message);
  }
});

// ─── Notes (local DB) ───────────────────────────────────────
const publishNotes = () => store.set('notes', db.notes());
app.get('/api/notes', (_req, res) => res.json(db.notes()));
app.post('/api/notes', (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty note' });
  const note = db.addNote({ text, color: req.body?.color, pinned: req.body?.pinned, remindAt: req.body?.remindAt });
  publishNotes();
  res.status(201).json(note);
});
app.patch('/api/notes/:id', (req, res) => {
  const note = db.updateNote(req.params.id, req.body || {});
  if (!note) return res.status(404).json({ error: 'not found' });
  publishNotes();
  res.json(note);
});
app.delete('/api/notes/:id', (req, res) => {
  const ok = db.deleteNote(req.params.id);
  publishNotes();
  res.status(ok ? 204 : 404).end();
});

// ─── Shopping list (local DB) ───────────────────────────────
const publishShopping = () => store.set('shopping', db.shopping());
publishShopping();
app.get('/api/shopping', (_req, res) => res.json(db.shopping()));
app.post('/api/shopping', (req, res) => {
  const added = db.addShopping(req.body?.items ?? req.body?.text);
  publishShopping();
  res.status(201).json(added);
});
app.post('/api/shopping/clear-done', (_req, res) => {
  db.clearShoppingDone();
  publishShopping();
  res.status(204).end();
});
app.patch('/api/shopping/:id', (req, res) => {
  const item = db.updateShopping(req.params.id, req.body || {});
  if (!item) return res.status(404).json({ error: 'not found' });
  publishShopping();
  res.json(item);
});
app.delete('/api/shopping/:id', (req, res) => {
  const n = db.removeShopping({ id: req.params.id });
  publishShopping();
  res.status(n ? 204 : 404).end();
});

// ─── Voice assistant (Gemini Live) ──────────────────────────
const assistant = new AssistantService({
  config,
  store,
  db,
  timers,
  cooking,
  spotify,
  languageName: () => LANGUAGE_NAMES[config.language],
  onChange: (section) => (section === 'shopping' ? publishShopping() : publishNotes()),
});
// Minting tokens spends the API key: only the display itself (localhost) may, unless allowed.
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const assistantGuard = (req, res, next) => {
  if (!assistant.enabled) return res.status(404).json({ error: 'assistant disabled' });
  if (!config.assistant.allowRemote && !isLocal(req)) return res.status(403).json({ error: 'assistant only from the display itself' });
  next();
};
app.post('/api/assistant/session', assistantGuard, async (_req, res) => {
  try {
    res.json(await assistant.session());
  } catch (err) {
    console.warn('[assistant]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});
app.post('/api/assistant/tool', assistantGuard, async (req, res) => {
  const { name, args } = req.body || {};
  console.log(`[assistant] tool ${name}`);
  res.json(await assistant.tool(String(name), args && typeof args === 'object' ? args : {}));
});

// ─── Cooking mode ───────────────────────────────────────────
// ?by=button|voice from the display; the device address tells which screen or phone it was.
const device = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const cookingRoute = (fn) => async (req, res) => {
  try {
    res.json((await fn(req)) ?? { ok: true });
  } catch (err) {
    res.status(err.message === 'not cooking' || err.message === 'recipe not found' ? 404 : 400).json({ error: err.message });
  }
};
app.post(
  '/api/cooking',
  cookingRoute((req) => {
    const b = req.body || {};
    if (b.url) return cooking.startFromUrl(String(b.url).trim(), `link from ${device(req)}`);
    if (b.id || b.name) return cooking.open(b, `history from ${device(req)}`);
    if (b.recipe) return cooking.startFrom(b.recipe);
    if (b.idea) return recipeIdeas.recipe(String(b.idea)).then(({ items, ideaId, ...r }) => cooking.start(r, `idea from ${device(req)}`));
    throw new Error('send { url }, { id }, { idea } or { recipe }');
  }),
);
app.patch('/api/cooking', cookingRoute((req) => cooking.go(req.body?.go)));
app.post('/api/cooking/timer', cookingRoute((req) => cooking.timer(req.body?.minutes)));
app.delete('/api/cooking', cookingRoute((req) => cooking.stop(`${String(req.query.by || 'api').slice(0, 12)} from ${device(req)}`)));
app.get('/api/recipes/ideas/:id', cookingRoute((req) => recipeIdeas.recipe(req.params.id)));
app.post('/api/recipes/ideas/shuffle', cookingRoute(async () => (await refreshRecipeIdeas({ shuffle: true }), store.get('recipeIdeas')?.data)));
app.get('/api/recipes', (_req, res) => res.json(db.recipes().map(({ id, title, source, image, savedAt, steps }) => ({ id, title, source, image, savedAt, steps: steps.length }))));
app.delete('/api/recipes/:id', (req, res) => res.status(db.deleteRecipe(req.params.id) ? 204 : 404).end());
setInterval(() => cooking.expire(), 10 * 60e3).unref();

// ─── Assistant memory ───────────────────────────────────────
app.get('/api/memories', (_req, res) => res.json(db.memories()));
app.post('/api/memories', (req, res) => {
  try {
    res.status(201).json(db.remember(req.body?.text));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.delete('/api/memories/:id', (req, res) => res.status(db.forget({ id: req.params.id }).length ? 204 : 404).end());

// ─── Backup and restore ─────────────────────────────────────
app.get('/api/backup', (_req, res) => {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
  res.setHeader('Content-Disposition', `attachment; filename="dash-backup-${day}.json"`);
  res.json(db.exportData());
});
app.get('/api/backups', (_req, res) => res.json(db.backups()));
app.post('/api/backup/inspect', express.json({ limit: '20mb' }), (req, res) => {
  try {
    res.json(Db.inspect(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post('/api/backup/restore', express.json({ limit: '20mb' }), async (req, res) => {
  let result;
  try {
    // { name } restores a copy kept on disk; otherwise the body is the backup file itself.
    const backup = req.body?.name && !req.body?.app ? db.readBackup(req.body.name) : req.body;
    result = db.importData(backup);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  console.log(`[backup] restored (${Object.entries(result.counts).map(([k, n]) => `${k} ${n}`).join(', ')}); previous data saved as ${result.savedCurrentAs}`);
  res.json(result);
  // Everything that reads the DB starts again from the restored data.
  const lang = config.language;
  applySettings();
  buildProviders();
  publishNotes();
  publishCountdowns();
  publishShopping();
  if (lang !== config.language) {
    sports.espn.teamLists.clear();
    favorites.resolved = {};
    store.setMeta('resolvedTeams', {});
    store.setMeta('language', config.language);
  }
  broadcast('snapshot', snapshot());
  try {
    refreshCalendar();
    refreshFinance();
    refreshMarketNews();
    await favorites.resolveAll();
    await refreshFavorites({ force: true });
    live?.setLeagues(liveLeagues());
    live?.pollNow();
    if (lang !== config.language) await Promise.allSettled([refreshWeather(), refreshNews(), refreshQuote(), refreshHolidays(), refreshSportsNews()]);
  } catch (err) {
    console.warn('[backup] refresh after restore failed:', err.message);
  }
});
// A copy a day in data/backups (the last 14 are kept).
const autoBackup = () => {
  try {
    const name = db.autoBackup();
    if (name) console.log(`[backup] daily copy ${name}`);
  } catch (err) {
    console.warn('[backup] daily copy failed:', err.message);
  }
};
autoBackup();
setInterval(autoBackup, 3 * 3600e3).unref();

// ─── Spotify ────────────────────────────────────────────────
const spotifyRoute = (fn) => async (req, res) => {
  try {
    res.json((await fn(req)) ?? { ok: true });
  } catch (err) {
    res.status(err instanceof SpotifyError ? err.status : 500).json({ error: err.message, reason: err.reason || null });
  }
};
/** Only screens on this machine or the local network may be sent back to after sign-in. */
function safeReturn(raw) {
  try {
    const u = new URL(String(raw || ''));
    const host = u.hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host) || host.endsWith('.local');
    return u.protocol === 'http:' && local ? `${u.origin}/#settings` : '/#settings';
  } catch {
    return '/#settings';
  }
}
app.get('/api/spotify/login', (req, res) => {
  // Spotify only accepts http redirects to 127.0.0.1: sign-in must happen on this machine.
  if (!isLocal(req)) return res.status(403).send('Open Settings → Spotify on the display itself to connect.');
  try {
    res.redirect(spotify.loginUrl(safeReturn(req.query.return)));
  } catch (err) {
    res.status(err.status || 500).send(err.message);
  }
});
app.get('/api/spotify/callback', async (req, res) => {
  try {
    const back = await spotify.callback(req.query);
    console.log(`[spotify] connected as ${spotify.tokens?.user || '?'}`);
    broadcast('snapshot', snapshot());
    res.redirect(back);
  } catch (err) {
    console.warn('[spotify] sign-in failed:', err.message);
    res.status(400).send(`Spotify sign-in failed: ${err.message}. Close this and try again from Settings.`);
  }
});
app.post(
  '/api/spotify/logout',
  spotifyRoute(() => {
    spotify.logout();
    broadcast('snapshot', snapshot());
  }),
);
app.get('/api/spotify/devices', spotifyRoute(() => spotify.devices()));
app.post('/api/spotify/control', spotifyRoute((req) => spotify.control(String(req.body?.action || ''), req.body || {})));
app.post('/api/spotify/play', spotifyRoute((req) => (req.body?.uri ? spotify.playUri(req.body) : spotify.play(req.body || {}))));
app.get('/api/spotify/playlists', spotifyRoute(() => spotify.playlists()));
app.get('/api/spotify/search', spotifyRoute((req) => spotify.search(req.query.q)));
app.get('/api/spotify/details', spotifyRoute((req) => spotify.details(req.query.uri)));
// Lyrics for the song playing now (LRCLIB); `null` when there are none.
app.get('/api/spotify/lyrics', async (req, res) => {
  const q = req.query;
  try {
    res.json(await lyricsFor({ uri: q.uri, track: q.track, artist: q.artist, album: q.album, durationMs: Number(q.duration) || null }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
app.post('/api/spotify/duck', spotifyRoute((req) => spotify.duck(!!req.body?.on)));
spotify.refresh();

// ─── Countdowns (local DB) ──────────────────────────────────
const publishCountdowns = () => store.set('countdowns', db.countdowns());
publishCountdowns();
app.get('/api/countdowns', (_req, res) => res.json(db.countdowns()));
app.post('/api/countdowns', (req, res) => {
  try {
    const c = db.addCountdown(req.body || {});
    publishCountdowns();
    res.status(201).json(c);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.delete('/api/countdowns/:id', (req, res) => {
  const ok = db.deleteCountdown(req.params.id);
  publishCountdowns();
  res.status(ok ? 204 : 404).end();
});

// ─── Guest Wi-Fi QR ─────────────────────────────────────────
const wifiEscape = (v) => String(v).replace(/([\\;,:"])/g, '\\$1');
app.get('/api/wifi/qr.svg', async (_req, res) => {
  const w = config.wifi;
  if (!config.features.wifiQr || !w.ssid) return res.status(404).end();
  // Standard Wi-Fi QR payload understood by iOS and Android cameras.
  const payload = `WIFI:T:${w.security === 'nopass' ? 'nopass' : w.security};S:${wifiEscape(w.ssid)};${w.security === 'nopass' ? '' : `P:${wifiEscape(w.password)};`}${w.hidden ? 'H:true;' : ''};`;
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
});

// ─── Health (for the supervisor / monitoring) ───────────────
app.get('/api/health', (_req, res) => {
  const ages = Object.fromEntries(Object.entries(store.snapshot()).map(([k, v]) => [k, v?.updatedAt ? Math.round((Date.now() - v.updatedAt) / 1000) : null]));
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    clients: clients.size,
    sectionAgeSeconds: ages,
    // Sources paused because they answered 403/429 (rate limiting), with when they resume.
    pausedSources: pausedHosts().map((p) => ({ host: p.host, until: new Date(p.until).toISOString() })),
    requestsLastHour: requestsLastHour(),
    livePolling: live?.status() || [],
  });
});

// ─── Kitchen timers ─────────────────────────────────────────
app.post('/api/timers', (req, res) => {
  try {
    res.status(201).json(timers.add(req.body?.seconds, req.body?.label));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.patch('/api/timers/:id', (req, res) => {
  const tm = timers.extend(req.params.id, Number(req.body?.addSeconds) || 60);
  return tm ? res.json(tm) : res.status(404).json({ error: 'not found' });
});
app.delete('/api/timers/:id', (req, res) => res.status(timers.remove(req.params.id) ? 204 : 404).end());

// ─── Demo ───────────────────────────────────────────────────
app.post('/api/demo/score', async (req, res) => {
  if (!demo) return res.status(404).json({ ok: false, error: 'not in demo mode' });
  const ok = demo.force(req.body?.team);
  setTimeout(() => live.pollNow(), 200);
  res.json({ ok });
});

const dist = path.join(ROOT, 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.send('Frontend not built. Run <code>npm run build</code> (or <code>npm run dev</code>).'));
}

// ─── Self-healing ───────────────────────────────────────────
// New frontend build on disk → push a snapshot; screens compare buildId and reload themselves.
let lastBuild = buildId();
setInterval(() => {
  const id = buildId();
  if (id !== lastBuild) {
    lastBuild = id;
    console.log('[dash] new frontend build detected, asking screens to reload');
    broadcast('snapshot', snapshot());
  }
}, 30e3).unref();

// Crash → exit, and the supervisor (server/supervise.js) restarts us; stray promise errors are only logged.
process.on('uncaughtException', (err) => {
  console.error('[dash] uncaught exception, exiting for a clean restart:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => console.warn('[dash] unhandled rejection:', err?.message || err));
// A slow leak on a device that runs for weeks: restart before it hurts.
setInterval(() => {
  const mb = process.memoryUsage().rss / 1048576;
  if (mb > config.watchdog.maxMemoryMB) {
    console.warn(`[dash] memory ${Math.round(mb)} MB > ${config.watchdog.maxMemoryMB} MB, restarting`);
    process.exit(1);
  }
}, 5 * 60e3).unref();

app
  .listen(config.port, () => {
    console.log(`[dash] listening on http://localhost:${config.port} (${config.language}, ${config.timezone})`);
    start().catch((err) => console.error('[dash] startup failed', err));
  })
  // Port taken (another Dash still running?): exit, so the supervisor retries until it's free,
  // instead of a server that runs but serves nothing.
  .on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `[dash] port ${config.port} is already in use (is another Dash running?); retrying` : `[dash] can't listen: ${err.message}`);
    process.exit(1);
  });
