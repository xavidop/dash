import '@fontsource-variable/outfit';
import './styles.css';
import { connect, subscribe, getState, onCelebration, reportLocation } from './store';
import type { AppState, Game, Sections } from './types';
import { clock, ampm, longDate, localHM, hm, esc, ago } from './format';
import { t as tr } from './i18n';
import { renderHome } from './panels/home';
import { renderNews } from './panels/news';
import { renderSports, sportsPageCount, selectCompetition, cycleCompetitions, compIndex } from './panels/sports';
import { renderFinance } from './panels/finance';
import { renderQuote } from './panels/quote';
import { renderSportsNews } from './panels/sportsnews';
import { renderNotes, visibleNotes } from './panels/notes';
import { renderTodayStrip, fitTodayStrip, stripSource } from './panels/today';
import { initTimers, isTimersOpen } from './timers';
import { initExtras, isExtrasOpen } from './extras';
import { renderElectricity } from './panels/electricity';
import { renderRound, roundsOf } from './panels/matchday';
import { renderBracket, bracketsOf } from './panels/bracket';
import { renderPreview, previewsOf } from './panels/preview';
import { mountRadar, stopRadar, radarWanted, radarAvailable, onRadarCoverage } from './panels/radar';
import { matchWhen } from './format';
import { renderCalendar, upcomingEvents } from './panels/calendar';
import { renderMusic, musicShown, musicAvailable, initMusic } from './panels/music';
import { renderRecipes, recipeIdeas, openRecipe, shuffleRecipes, isRecipeOpen } from './panels/recipes';
import { renderShopping, shoppingItems } from './panels/shopping';
import { initAssistant, isAssistantOpen } from './assistant';
import { initCooking, isCooking } from './cooking';
import { initMotion } from './motion';
import { initSettings, openSettings, isSettingsOpen } from './settings';
import { renderLiveOthers, otherLive } from './panels/live-others';
import { scoreboard } from './live/scoreboard';
import { celebrate } from './live/celebration';
import { weatherIcon } from './icons';
import { crest } from './ui';

/** Panel ids: home, news, sports:<page>, notes, live. */
type PanelId = string;
type PanelSpec = { render: (el: HTMLElement, s: AppState) => void; deps: (keyof Sections | 'config')[] };
const BASE_PANELS: Record<string, PanelSpec> = {
  home: { render: renderHome, deps: ['weather', 'location', 'config', 'teams', 'alerts', 'airQuality', 'notes', 'holidays', 'countdowns', 'electricity', 'calendar'] },
  electricity: { render: renderElectricity, deps: ['electricity'] },
  preview: { render: renderPreview, deps: ['previews', 'teams'] },
  // The radar animates only while it's on screen.
  radar: { render: (el, s) => (current === 'radar' ? mountRadar(el, s) : undefined), deps: ['radar', 'location'] },
  news: { render: renderNews, deps: ['news'] },
  notes: { render: renderNotes, deps: ['notes'] },
  sportsnews: { render: renderSportsNews, deps: ['sportsNews'] },
  finance: { render: renderFinance, deps: ['finance', 'marketNews'] },
  quote: { render: renderQuote, deps: ['quote'] },
  calendar: { render: renderCalendar, deps: ['calendar', 'config'] },
  shopping: { render: renderShopping, deps: ['shopping'] },
  music: { render: renderMusic, deps: ['spotify', 'config'] },
  live: { render: renderLiveOthers, deps: ['live'] },
  recipes: { render: renderRecipes, deps: ['recipeIdeas', 'config'] },
};
function spec(id: PanelId): PanelSpec {
  if (id.startsWith('bracket:')) {
    const key = id.slice('bracket:'.length);
    return { render: (el, s) => renderBracket(el, s, key), deps: ['brackets', 'teams'] };
  }
  if (id.startsWith('round:')) {
    const key = id.slice('round:'.length);
    return { render: (el, s) => renderRound(el, s, key), deps: ['rounds', 'teams'] };
  }
  if (id.startsWith('sports:')) {
    const page = Number(id.split(':')[1]) || 0;
    return { render: (el, s) => renderSports(el, s, page), deps: ['teams'] };
  }
  return BASE_PANELS[id] || BASE_PANELS.home;
}

const MY_GAME_ROTATE_MS = 30e3;
const PEEK_EVERY_MS = 60e3;
const PEEK_SHOW_MS = 10e3;

// ─── DOM skeleton ───────────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="sky" aria-hidden="true">
    <div class="sky-l sky-dawn"></div><div class="sky-l sky-day"></div><div class="sky-l sky-dusk"></div><div class="sky-l sky-night"></div>
    <div class="sky-veil"></div>
  </div>
  <main class="stage"></main>
  <nav class="dots"></nav>
  <section class="live-layer" hidden></section>
  <aside class="peek" hidden></aside>
  <div class="ticker" hidden><div class="ticker-track"></div></div>
  <section class="night-screen" hidden></section>
  <button class="gear"><svg viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" fill="currentColor" transform="translate(-1 0)"/></svg></button>
  <div class="fx"></div>
  <div class="offline" hidden></div>`;

const $ = <T extends HTMLElement>(sel: string) => app.querySelector(sel) as T;
const stage = $('.stage');
const dotsEl = $('.dots');
const liveLayer = $('.live-layer');
const peekEl = $('.peek');
const ticker = $('.ticker');
const tickerTrack = $('.ticker-track');
const nightEl = $('.night-screen');
const fx = $('.fx');
const offlineEl = $('.offline');

const panelEls = new Map<PanelId, HTMLElement>();
function panelEl(id: PanelId) {
  let el = panelEls.get(id);
  if (!el) {
    el = document.createElement('div');
    el.className = `panel panel-${id.split(':')[0]}`;
    el.dataset.panel = id;
    stage.appendChild(el);
    panelEls.set(id, el);
  }
  return el;
}

// ─── UI state ───────────────────────────────────────────────
let order: PanelId[] = ['home', 'news', 'sports:0'];
let current: PanelId = 'home';
let lastAdvance = Date.now();
let pausedUntil = 0; // touch pause
let browseUntil = 0; // manual browsing while my team is live
let nightWokeUntil = 0;
let myGameIdx = 0;
let myGameSwitched = Date.now();
let focusGameId: string | null = null; // celebration pins this game
let lastPeek = Date.now();
let lastLiveHtml = '';

const cfg = () => getState().config;

function rotationMs() {
  return (cfg()?.rotationSeconds ?? 60) * 1000;
}
function touchPauseMs() {
  return (cfg()?.touchPauseSeconds ?? 120) * 1000;
}

// ─── Panels & rotation ──────────────────────────────────────
/** Rotation order; optional panels appear only when they have something to show. Panels of one
 *  section stay together, so the page dots can be grouped by section. */
function computeOrder(s: AppState): PanelId[] {
  const o: PanelId[] = ['home'];
  if (radarWanted(s)) o.push('radar');
  // What's happening now goes right after Home: other live games, today's previews, the music.
  if (otherLive(s).length) o.push('live');
  if (previewsOf(s).length) o.push('preview');
  if (musicShown(s) || musicAvailable(s)) o.push('music');
  // Your day: agenda, what to cook, shopping, notes.
  if (upcomingEvents(s).length) o.push('calendar');
  if (recipeIdeas(s).length) o.push('recipes');
  if (shoppingItems(s).length) o.push('shopping');
  if (visibleNotes(s).length) o.push('notes');
  o.push('news');
  if (s.sections.sportsNews?.data?.items?.length) o.push('sportsnews');
  if (s.sections.quote?.data) o.push('quote');
  for (let i = 0; i < sportsPageCount(s); i++) o.push(`sports:${i}`);
  for (const r of roundsOf(s)) o.push(`round:${r.key}`);
  for (const b of bracketsOf(s)) o.push(`bracket:${b.key}`);
  if (s.sections.finance?.data?.quotes?.length) o.push('finance');
  if (s.config?.features?.electricity !== false && s.sections.electricity?.data?.prices?.length) o.push('electricity');
  return o;
}

/** Sections for the page dots: one dot each; the current section opens up into one dash per page. */
const SECTIONS: [string, RegExp][] = [
  ['home', /^(home|radar)$/],
  ['now', /^(live|preview|music)$/],
  ['day', /^(calendar|recipes|shopping|notes)$/],
  ['news', /^(news|sportsnews|quote)$/],
  ['sports', /^(sports|round|bracket):/],
  ['markets', /^(finance|electricity)$/],
];
function sectionsOf(ids: PanelId[]) {
  const out: { key: string; ids: PanelId[] }[] = [];
  for (const id of ids) {
    const key = SECTIONS.find(([, re]) => re.test(id))?.[0] || id;
    const last = out.at(-1);
    if (last?.key === key) last.ids.push(id);
    else out.push({ key, ids: [id] });
  }
  return out;
}

function renderPanel(id: PanelId) {
  try {
    spec(id).render(panelEl(id), getState());
  } catch (err) {
    console.error('render', id, err);
  }
}

function renderDots() {
  document.querySelector('.gear')?.setAttribute('aria-label', tr('settings.title'));
  dotsEl.innerHTML = sectionsOf(order)
    .map((g) => {
      const here = g.ids.includes(current);
      const name = tr(`dots.${g.key}`);
      if (!here || g.ids.length === 1) return `<button class="dot ${here ? 'on' : ''}" data-go="${g.ids[0]}" aria-label="${name}"></button>`;
      return `<span class="dot-group">${g.ids.map((id, i) => `<button class="dot sub ${id === current ? 'on' : ''}" data-go="${id}" aria-label="${name} ${i + 1}/${g.ids.length}"></button>`).join('')}</span>`;
    })
    .join('');
}

function show(id: PanelId, dir: 1 | -1 = 1) {
  if (!order.includes(id)) id = 'home';
  panelEl(id);
  document.body.dataset.panel = id.split(':')[0];
  const prev = current;
  if (prev === 'radar' && id !== 'radar') stopRadar();
  current = id;
  lastAdvance = Date.now();
  for (const [pid, el] of panelEls) {
    el.classList.remove('active', 'leaving', 'from-left', 'from-right');
    if (pid === id) {
      el.classList.add('active', dir > 0 ? 'from-right' : 'from-left');
    } else if (pid === prev && prev !== id) {
      el.classList.add('leaving', dir > 0 ? 'to-left' : 'to-right');
      setTimeout(() => el.classList.remove('leaving', 'to-left', 'to-right'), 900);
    }
  }
  renderPanel(id);
  renderDots();
}

function step(dir: 1 | -1) {
  const i = order.indexOf(current);
  show(order[(i + dir + order.length) % order.length], dir);
}

// ─── Live takeover (my teams) ───────────────────────────────
function myLiveGames(s: AppState): Game[] {
  return (s.sections.live?.data?.games || []).filter((g) => g.mine);
}

function liveMode(s: AppState) {
  return myLiveGames(s).length > 0 && Date.now() > browseUntil;
}

function renderLive(s: AppState) {
  const games = myLiveGames(s);
  if (!games.length) {
    lastLiveHtml = '';
    return;
  }
  let g = focusGameId ? games.find((x) => x.id === focusGameId) : undefined;
  if (!g) {
    if (Date.now() - myGameSwitched > MY_GAME_ROTATE_MS) {
      myGameIdx++;
      myGameSwitched = Date.now();
    }
    g = games[myGameIdx % games.length];
  }
  const html =
    scoreboard(g) +
    (games.length > 1 ? `<div class="game-dots">${games.map((x) => `<i class="${x.id === g!.id ? 'on' : ''}"></i>`).join('')}</div>` : '');
  if (html === lastLiveHtml) return;

  // Animate the score digit that changed.
  const prevScores = [...liveLayer.querySelectorAll<HTMLElement>('[data-score]')].map((e) => e.textContent);
  const sameGame = liveLayer.dataset.game === g.id;
  liveLayer.innerHTML = html;
  liveLayer.dataset.game = g.id;
  lastLiveHtml = html;
  if (sameGame) {
    liveLayer.querySelectorAll<HTMLElement>('[data-score]').forEach((e, i) => {
      if (prevScores[i] != null && prevScores[i] !== e.textContent) e.classList.add('bump');
    });
  }
}

// ─── Peek strip (other panels while live) ───────────────────
function renderPeek(s: AppState) {
  const w = s.sections.weather?.data;
  const news = (s.sections.news?.data?.items || []).slice(0, 2);
  const others = otherLive(s).slice(0, 3);
  peekEl.innerHTML = `
    <div class="peek-clock">${clock()}</div>
    ${w ? `<div class="peek-wx">${weatherIcon(w.current.icon, w.current.isDay)}<b>${w.current.temp}°</b><span>${esc(w.current.desc)}</span></div>` : ''}
    ${news.map((n) => `<div class="peek-news"><span>${esc(n.source)} · ${esc(ago(n.publishedAt))}</span>${esc(n.title)}</div>`).join('')}
    ${others.length ? `<div class="peek-games">${others.map((g) => `<div>${crest(g.home, 'xs')}<b>${g.home.score ?? 0}–${g.away.score ?? 0}</b>${crest(g.away, 'xs')}<span>${esc(g.status)}</span></div>`).join('')}</div>` : ''}`;
}

// ─── Ticker (other live games) ──────────────────────────────
let lastTicker = '';
function renderTicker(s: AppState) {
  const games = otherLive(s);
  ticker.hidden = !games.length || isNight(s);
  ticker.dataset.label = tr('common.live');
  document.body.classList.toggle('has-ticker', !ticker.hidden);
  if (!games.length) return;
  const items = games
    .map((g) => `<span class="tk"><em>${esc(g.league.name)}</em>${esc(g.home.name)} <b>${g.home.score ?? 0}–${g.away.score ?? 0}</b> ${esc(g.away.name)} <small>${esc(g.status)}</small></span>`)
    .join('');
  if (items === lastTicker) return;
  lastTicker = items;
  tickerTrack.innerHTML = items + items; // duplicated for a seamless loop
  tickerTrack.style.animationDuration = `${Math.max(20, games.length * 9)}s`;
}

// ─── Night mode ─────────────────────────────────────────────
function isNight(s: AppState) {
  const n = s.config?.nightMode;
  if (!n?.enabled || Date.now() < nightWokeUntil) return false;
  const t = localHM().minutes;
  const a = hm(n.start);
  const b = hm(n.end);
  return a > b ? t >= a || t < b : t >= a && t < b;
}

function renderNight(s: AppState) {
  const w = s.sections.weather?.data;
  nightEl.innerHTML = `
    <div class="night-clock"><span data-clock>${clock()}</span><small data-ampm>${ampm()}</small></div>
    <div class="night-date" data-date>${esc(longDate())}</div>
    ${w ? `<div class="night-wx">${w.current.temp}° · ${esc(w.current.desc)}</div>` : ''}
    <div class="wordmark">Dash</div>`;
}

// ─── Sky (time of day + weather) ────────────────────────────
function updateSky(s: AppState) {
  const w = s.sections.weather?.data;
  const t = localHM().minutes;
  let phase = t >= 7 * 60 && t < 19 * 60 ? 'day' : 'night';
  if (w) {
    const rise = hm(w.today.sunrise.slice(11, 16));
    const set = hm(w.today.sunset.slice(11, 16));
    if (Math.abs(t - rise) <= 50) phase = 'dawn';
    else if (Math.abs(t - set) <= 50) phase = 'dusk';
    else phase = t > rise && t < set ? 'day' : 'night';
  }
  const wx = w ? (['rain', 'showers', 'storm', 'drizzle'].includes(w.current.icon) ? 'rain' : ['cloudy', 'fog'].includes(w.current.icon) ? 'cloudy' : 'clear') : 'clear';
  document.body.dataset.sky = phase;
  document.body.dataset.wx = wx;
  document.body.dataset.theme = phase === 'night' || phase === 'dusk' ? 'dark' : 'light';
}

// ─── Mode resolution (called often, cheap) ─────────────────
let mode: 'panels' | 'live' | 'night' = 'panels';
function resolveMode() {
  const s = getState();
  const next = liveMode(s) ? 'live' : isNight(s) ? 'night' : 'panels';
  if (next !== mode) {
    mode = next;
    document.body.dataset.mode = mode;
    liveLayer.hidden = mode !== 'live';
    nightEl.hidden = mode !== 'night';
    stage.classList.toggle('hidden', mode !== 'panels');
    dotsEl.hidden = mode !== 'panels';
    if (mode === 'live') {
      lastPeek = Date.now();
      renderLive(s);
    }
    if (mode === 'night') renderNight(s);
    if (mode === 'panels') show(current);
  }
  renderTicker(s);
}

// ─── Store wiring ───────────────────────────────────────────
subscribe((s, changed) => {
  if (changed === 'connection') {
    offlineEl.textContent = tr('common.offline');
    offlineEl.hidden = s.connected;
    return;
  }
  const newOrder = computeOrder(s);
  if (newOrder.join() !== order.join()) {
    order = newOrder;
    if (!order.includes(current)) show('home');
    renderDots();
  }
  // Settings (language, clock, timezone…) changed: everything on screen is re-rendered.
  if (changed === 'config') {
    renderPanel(current);
    lastLiveHtml = '';
    renderLive(s);
    if (mode === 'night') renderNight(s);
    demoControls();
  } else if (spec(current).deps.includes(changed as never)) renderPanel(current);
  // Live scores feed the Today strip: patch just the strip instead of re-rendering Home.
  if (changed === 'live' && current === 'home') {
    const home = panelEl('home');
    const strip = home.querySelector('.today-strip');
    const html = renderTodayStrip(s);
    if (strip ? stripSource(strip) !== html : html) {
      if (strip) {
        strip.outerHTML = html || '';
        fitTodayStrip(home);
      } else renderPanel('home');
    }
  }
  if (changed === 'live') {
    if (focusGameId && !myLiveGames(s).some((g) => g.id === focusGameId)) focusGameId = null;
    renderLive(s);
  }
  if (changed === 'weather') updateSky(s);
  if (mode === 'night' && (changed === 'weather' || changed === 'config')) renderNight(s);
  resolveMode();
});

onCelebration((c) => {
  // Always surface the scoring game; a goal even wakes night mode briefly.
  if (c.mine && c.forMe) {
    focusGameId = c.gameId;
    browseUntil = 0;
    nightWokeUntil = Math.max(nightWokeUntil, Date.now() + 3 * 60e3);
    resolveMode();
    renderLive(getState());
    setTimeout(() => {
      if (focusGameId === c.gameId) focusGameId = null;
    }, 15e3);
  }
  celebrate(fx, c);
});

// ─── Touch: swipe + pause ───────────────────────────────────
const COMP_CYCLE_MS = 8000;
const compHold = new Map<string, number>(); // team key → don't auto-cycle until
let lastCompCycle = Date.now();
let downX = 0;
let downY = 0;
let downAt = 0;
document.addEventListener('pointerdown', (e) => {
  if (isSettingsOpen()) return;
  downX = e.clientX;
  downY = e.clientY;
  downAt = Date.now();
  pausedUntil = Date.now() + touchPauseMs();
});
document.addEventListener('pointerup', (e) => {
  const target = e.target as HTMLElement;
  if (isSettingsOpen() || target.closest('.settings')) return;
  if (radarSheet && !radarSheet.hidden) {
    if (target.closest('[data-radar-close]') || target === radarSheet) closeRadarSheet();
    pausedUntil = Date.now() + touchPauseMs();
    return;
  }
  // Tap the weather on Home → rain radar.
  if (mode === 'panels' && current === 'home' && target.closest('.now-weather') && Math.abs(e.clientX - downX) < 20 && radarAvailable(getState())) {
    openRadarSheet();
    return;
  }
  if (isTimersOpen() || isExtrasOpen() || isAssistantOpen() || isCooking() || isRecipeOpen() || target.closest('.rx-sheet, .timers, .timer-btn, .timer-pills, .timer-ring, .wifi-btn, .wifi-sheet, .reminder-ring, .assistant-btn, .assistant-sheet, .cooking-layer, .music-pill, .music-btn, .music [data-mu], .mu-search')) {
    pausedUntil = Date.now() + touchPauseMs();
    return;
  }
  if (target.closest('.gear')) {
    pausedUntil = Date.now() + touchPauseMs();
    openSettings();
    return;
  }
  const dx = e.clientX - downX;
  const dy = e.clientY - downY;
  pausedUntil = Date.now() + touchPauseMs();
  if (target.closest('.demo-ctl')) return;
  if (mode === 'night') {
    nightWokeUntil = Date.now() + touchPauseMs();
    resolveMode();
    return;
  }
  // Team cards with several competitions: tap a tab, or swipe inside the card.
  const tab = target.closest<HTMLElement>('[data-comp]');
  if (tab) {
    compHold.set(tab.dataset.teamKey!, Date.now() + touchPauseMs());
    return selectCompetition(stage, tab.dataset.teamKey!, Number(tab.dataset.comp));
  }
  const multi = target.closest<HTMLElement>('.team.multi');
  if (multi && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) {
    const key = multi.dataset.team!;
    compHold.set(key, Date.now() + touchPauseMs());
    return selectCompetition(stage, key, (compIndex.get(key) ?? 0) + (dx < 0 ? 1 : -1));
  }
  // Shopping list: tap an item to tick it off (a swipe still changes panel).
  const shop = target.closest<HTMLElement>('[data-shop]');
  if (shop && Math.abs(dx) < 20 && Math.abs(dy) < 20) {
    shop.classList.toggle('done');
    return void fetch(`/api/shopping/${shop.dataset.shop}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: shop.dataset.done !== '1' }) });
  }
  if (target.closest('[data-shop-clear]')) return void fetch('/api/shopping/clear-done', { method: 'POST' });
  // What to cook: tap a recipe for its ingredients and "Start cooking".
  const rx = target.closest<HTMLElement>('[data-rx]');
  if (rx && Math.abs(dx) < 20 && Math.abs(dy) < 20) return void openRecipe(rx.dataset.rx!, getState());
  const shuffle = target.closest<HTMLElement>('[data-rx-shuffle]');
  if (shuffle) return void shuffleRecipes(shuffle);
  const go = target.closest<HTMLElement>('[data-go]');
  if (go) return show(go.dataset.go as PanelId, order.indexOf(go.dataset.go as PanelId) >= order.indexOf(current) ? 1 : -1);
  const swipe = Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - downAt < 1200;
  if (mode === 'live') {
    // Swipe (or tap) away from the scoreboard to browse; it comes back after the pause.
    if (swipe || Date.now() - downAt < 400) {
      browseUntil = Date.now() + touchPauseMs();
      resolveMode();
    }
    return;
  }
  if (swipe) step(dx < 0 ? 1 : -1);
});
document.addEventListener('keydown', (e) => {
  if (isSettingsOpen() || (e.target as HTMLElement).matches?.('input, textarea')) return;
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
});

// ─── Timers ─────────────────────────────────────────────────
let lastMinute = '';
setInterval(() => {
  const c = clock();
  if (c !== lastMinute) {
    lastMinute = c;
    document.querySelectorAll('[data-clock]').forEach((e) => (e.textContent = c));
    const ap = ampm();
    document.querySelectorAll('[data-ampm]').forEach((e) => (e.textContent = ap));
    const d = longDate();
    document.querySelectorAll('[data-date]').forEach((e) => {
      if (e.textContent !== d) e.textContent = d;
    });
    updateSky(getState());
    resolveMode();
    if (mode === 'panels' && current !== 'home') renderPanel(current); // refresh "hace X min"
  }
  const t = Date.now();
  if (isSettingsOpen() || isTimersOpen() || isExtrasOpen() || isAssistantOpen() || isCooking()) pausedUntil = t + touchPauseMs();
  // Daily reload (default 04:00) keeps a weeks-long session fresh; never during a live game or while in use.
  const reloadAt = cfg()?.dailyReload;
  if (reloadAt && mode !== 'live' && !isSettingsOpen() && !isTimersOpen() && !isAssistantOpen() && !isCooking() && t > pausedUntil && Date.now() - bootedAt > 3600e3) {
    const { minutes } = localHM();
    if (minutes === hm(reloadAt)) location.reload();
  }
  if (mode === 'panels' && t > pausedUntil && t - lastAdvance >= rotationMs()) step(1);
  if (mode === 'panels' && current.startsWith('sports:') && t - lastCompCycle >= COMP_CYCLE_MS) {
    lastCompCycle = t;
    const held = new Set([...compHold].filter(([, until]) => until > t).map(([k]) => k));
    cycleCompetitions(panelEl(current), held);
  }
  if (mode === 'live') {
    renderLive(getState());
    if (peekEl.hidden && t - lastPeek >= PEEK_EVERY_MS) {
      renderPeek(getState());
      peekEl.hidden = false;
      requestAnimationFrame(() => {
        peekEl.classList.add('in');
        document.body.classList.add('peeking');
      });
      lastPeek = t;
    } else if (!peekEl.hidden && t - lastPeek >= PEEK_SHOW_MS) {
      peekEl.classList.remove('in');
      document.body.classList.remove('peeking');
      setTimeout(() => (peekEl.hidden = true), 700);
      lastPeek = t;
    }
  } else if (!peekEl.hidden) {
    peekEl.hidden = true;
    peekEl.classList.remove('in');
    document.body.classList.remove('peeking');
  }
  if (browseUntil && t > browseUntil) {
    browseUntil = 0;
    resolveMode();
  }
}, 1000);

// ─── Rain radar overlay (tap the weather on Home) ───────────
let radarSheet: HTMLElement | null = null;
function openRadarSheet() {
  const s = getState();
  if (!s.sections.radar?.data) return;
  radarSheet ??= Object.assign(document.createElement('section'), { className: 'radar-sheet' });
  if (!radarSheet.isConnected) document.body.appendChild(radarSheet);
  radarSheet.hidden = false;
  mountRadar(radarSheet, s, { overlay: true });
}
function closeRadarSheet() {
  if (!radarSheet) return;
  radarSheet.hidden = true;
  radarSheet.innerHTML = '';
  stopRadar();
  if (current === 'radar') renderPanel('radar');
}

// ─── Kickoff toast (15 min before my team plays) ────────────
const KICKOFF_MS = 15 * 60e3;
function checkKickoff() {
  const s = getState();
  if (s.config?.features?.preMatch === false) return;
  for (const card of s.sections.teams?.data?.teams || []) {
    const g = card.next;
    if (!g || g.state !== 'pre' || g.timeTBD) continue;
    const left = Date.parse(g.start) - Date.now();
    if (left <= 0 || left > KICKOFF_MS) continue;
    const key = `dash:kickoff:${g.id}`;
    try {
      if (localStorage.getItem(key)) continue;
      localStorage.setItem(key, '1');
    } catch {}
    const el = document.createElement('div');
    el.className = 'score-toast kickoff';
    el.style.setProperty('--c', card.color || '#1a73e8');
    el.innerHTML = `${crest(g.home, 'sm')}<div><b>${esc(tr('preview.toast', { n: Math.max(1, Math.round(left / 60e3)) }))}</b><span>${esc(g.home.name)} – ${esc(g.away.name)} · ${esc(g.league.name)} · ${esc(matchWhen(g.start).time)}</span></div>${crest(g.away, 'sm')}`;
    fx.appendChild(el);
    setTimeout(() => el.classList.add('out'), 12000);
    setTimeout(() => el.remove(), 12600);
  }
}
setInterval(checkKickoff, 20e3);

// ─── Keep the screen awake ──────────────────────────────────
async function wakeLock() {
  try {
    await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock?.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wakeLock());

// ─── Demo controls ──────────────────────────────────────────
const demoScore = (team?: string) =>
  fetch('/api/demo/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team }) });

/** Buttons that make one of the simulated favourites score (labels come from the server). */
function demoControls() {
  const controls = cfg()?.demo?.controls;
  document.querySelector('.demo-ctl')?.remove();
  if (!controls?.length) return;
  const el = document.createElement('div');
  el.className = 'demo-ctl';
  el.innerHTML = `<span>${esc(tr('demo.label'))}</span>${controls.map((c) => `<button data-team="${esc(c.key)}">${esc(c.label)}</button>`).join('')}`;
  el.addEventListener('click', (e) => {
    const team = (e.target as HTMLElement).dataset.team;
    if (team) demoScore(team);
  });
  document.body.appendChild(el);
}
document.addEventListener('keydown', (e) => {
  const controls = cfg()?.demo?.controls;
  if (!controls?.length || isSettingsOpen()) return;
  const n = Number(e.key);
  if (n >= 1 && n <= controls.length) demoScore(controls[n - 1].key);
});
subscribe((_s, changed) => changed === 'config' && demoControls());

// ─── Boot ───────────────────────────────────────────────────
const bootedAt = Date.now();
initTimers();
initExtras();
initCooking();
initMusic();
initMotion();
// Someone walked in: wake from night mode for a while, as a tap would (rotation keeps going).
window.addEventListener('dash:motion', () => {
  if (mode !== 'night' && Date.now() < nightWokeUntil) return;
  if (getState().config?.nightMode?.enabled) {
    nightWokeUntil = Math.max(nightWokeUntil, Date.now() + touchPauseMs());
    resolveMode();
  }
});
initAssistant();
// The mini player opens the Music panel; the speaker list re-renders it.
window.addEventListener('dash:go', (e) => {
  const id = (e as CustomEvent<string>).detail;
  pausedUntil = Date.now() + touchPauseMs();
  order = computeOrder(getState());
  renderDots();
  show(id);
});
window.addEventListener('dash:render', (e) => {
  const id = (e as CustomEvent<string>).detail;
  if (current === id) renderPanel(id);
});
initSettings(() => {
  pausedUntil = Date.now() + touchPauseMs();
  order = computeOrder(getState());
  renderPanel(current);
  renderDots();
});
document.body.dataset.mode = 'panels';
updateSky(getState());
connect();
order = computeOrder(getState());
show('home');
onRadarCoverage(() => {
  order = computeOrder(getState());
  renderDots();
});
resolveMode();
reportLocation();
wakeLock();
