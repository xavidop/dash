import type { AppState, Celebration, Section, Sections } from './types';
import { setLanguage } from './i18n';

type Listener = (state: AppState, changed: keyof Sections | 'config' | 'connection') => void;

const state: AppState = { config: null, sections: {}, serverOffset: 0, connected: false };
const listeners = new Set<Listener>();
const celebrationListeners = new Set<(c: Celebration) => void>();

const LOCAL_KEY = 'dash:snapshot';

function emit(changed: Parameters<Listener>[1]) {
  for (const l of listeners) l(state, changed);
}

export function getState() {
  return state;
}

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onCelebration(fn: (c: Celebration) => void) {
  celebrationListeners.add(fn);
}

/** Server-corrected "now" (the Surface's clock can drift; the server is the source of truth). */
export const now = () => Date.now() + state.serverOffset;

function applySnapshot(snap: { config: AppState['config']; sections: Sections; serverTime: number }) {
  state.config = snap.config;
  setLanguage(snap.config?.language);
  state.sections = snap.sections || {};
  state.serverOffset = snap.serverTime ? snap.serverTime - Date.now() : 0;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ config: snap.config, sections: { ...snap.sections, live: undefined } }));
  } catch {}
  emit('config');
  for (const k of Object.keys(state.sections) as (keyof Sections)[]) emit(k);
}

/** Paint instantly from the browser's copy while the server boots. */
function restoreLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;
    const snap = JSON.parse(raw);
    state.config = snap.config;
    setLanguage(snap.config?.language);
    state.sections = snap.sections || {};
  } catch {}
}

// ─── Self-healing ──────────────────────────────────────────
// The page runs for weeks: it reconnects dead streams, reloads when a new build is deployed,
// and reloads after a long outage so it starts from a clean state.
const STALE_STREAM_MS = 75e3; // the server pings every 25 s
const LONG_OUTAGE_MS = 2 * 60e3;
let lastSeen = Date.now();
let lostAt: number | null = null;
let bootBuild: string | null = null;

function checkBuild(id: string | undefined) {
  if (!id || id === 'dev') return;
  if (!bootBuild) bootBuild = id;
  else if (id !== bootBuild) location.reload();
}

export function connect() {
  restoreLocal();
  let es: EventSource | null = null;
  let retry = 1000;

  const open = () => {
    es = new EventSource('/api/stream');
    lastSeen = Date.now();
    es.addEventListener('ping', () => (lastSeen = Date.now()));
    es.addEventListener('snapshot', (e) => {
      retry = 1000;
      lastSeen = Date.now();
      if (lostAt && Date.now() - lostAt > LONG_OUTAGE_MS) return location.reload();
      lostAt = null;
      state.connected = true;
      const snap = JSON.parse((e as MessageEvent).data);
      checkBuild(snap.config?.buildId);
      applySnapshot(snap);
      emit('connection');
    });
    es.addEventListener('update', (e) => {
      lastSeen = Date.now();
      const { key, section } = JSON.parse((e as MessageEvent).data) as { key: keyof Sections; section: Section<unknown> };
      (state.sections as Record<string, Section<unknown>>)[key] = section;
      emit(key);
      if (key !== 'live') {
        try {
          const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
          raw.sections = { ...(raw.sections || {}), [key]: section };
          localStorage.setItem(LOCAL_KEY, JSON.stringify(raw));
        } catch {}
      }
    });
    es.addEventListener('celebration', (e) => {
      const c = JSON.parse((e as MessageEvent).data) as Celebration;
      for (const fn of celebrationListeners) fn(c);
    });
    es.onerror = () => {
      lostAt ??= Date.now();
      state.connected = false;
      emit('connection');
      // EventSource retries by itself, but a hard-closed stream needs a manual reopen.
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        setTimeout(open, retry);
        retry = Math.min(retry * 2, 30000);
      }
    };
  };
  open();

  // A stream can die silently (sleeping network, proxy): no ping for a while → reopen it.
  setInterval(() => {
    if (Date.now() - lastSeen > STALE_STREAM_MS) {
      lostAt ??= Date.now();
      state.connected = false;
      emit('connection');
      es?.close();
      open();
    }
  }, 15e3);
}

/** Report the device's position (Windows location services via Edge). Falls back silently to IP location on the server. */
export function reportLocation() {
  if (!('geolocation' in navigator)) return;
  const send = (p: GeolocationPosition) =>
    fetch('/api/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
    }).catch(() => {});
  const ask = () => navigator.geolocation.getCurrentPosition(send, () => {}, { enableHighAccuracy: false, timeout: 20000, maximumAge: 30 * 60e3 });
  ask();
  setInterval(ask, 60 * 60e3);
}
