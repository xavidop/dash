import type { CatalogTeam, Countdown, Favorites, FavTeam, GeneralSettings, LeagueInfo, Note } from './types';
import { esc, ago, timeOf, matchWhen } from './format';
import { nextOccurrence } from './panels/today';
import { crest, onColor } from './ui';
import { getState, subscribe } from './store';
import { visibleNotes } from './panels/notes';
import { t, setLanguage } from './i18n';

type Tab = 'general' | 'teams' | 'f1' | 'tennis' | 'markets' | 'notes' | 'kitchen' | 'dates';
type SportKey = LeagueInfo['sport'];

const TABS: Tab[] = ['general', 'teams', 'f1', 'tennis', 'markets', 'notes', 'kitchen', 'dates'];
const calList = (s: Partial<GeneralSettings>) => (s.calendar?.urls || []).map((c) => (typeof c === 'string' ? { url: c } : c));
/** "calendar.google.com/…": enough to recognise a link without showing its secret part. */
const maskUrl = (u: string) => {
  try {
    return `${new URL(u.replace(/^webcals?:/i, 'https:')).host}/…`;
  } catch {
    return '…';
  }
};

function motionSection(s: Partial<GeneralSettings>) {
  const m = s.motion || { dimAfterMinutes: 10, sensitivity: 'medium' };
  return `<section class="set-section">
    <h2>${t('settings.motion')}</h2>
    <p class="set-hint">${t('settings.motionPrivacy')}</p>
    <h3 class="set-sub">${t('settings.motionDim')}</h3>
    <div class="chips">${[0, 5, 10, 20, 30, 60].map((n) => `<button class="chip ${m.dimAfterMinutes === n ? 'on' : ''}" data-action="motion-dim" data-v="${n}">${n ? t('timers.minutes', { n }) : t('settings.motionNever')}</button>`).join('')}</div>
    <h3 class="set-sub">${t('settings.motionSensitivity')}</h3>
    <div class="chips">${(['low', 'medium', 'high'] as const).map((v) => `<button class="chip ${m.sensitivity === v ? 'on' : ''}" data-action="motion-sens" data-v="${v}">${t(`settings.motionSens.${v}`)}</button>`).join('')}</div>
  </section>`;
}

function spotifySection() {
  const sp = getState().config!.spotify!;
  // Spotify only redirects to 127.0.0.1 over plain http: connecting works on the display itself.
  const onDisplay = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return `<section class="set-section">
    <h2>Spotify</h2>
    ${
      sp.connected
        ? `<div class="set-row backup-actions"><span>${esc(t('settings.spotifyConnected', { user: sp.user || 'Spotify' }))}</span><button class="chip" data-action="spotify-logout">${t('settings.spotifyDisconnect')}</button></div>`
        : onDisplay
          ? `<p class="set-hint">${t('settings.spotifyConnectHint')}</p><div class="set-row backup-actions"><a class="btn-primary" href="/api/spotify/login?return=${encodeURIComponent(location.origin)}">${t('settings.spotifyConnect')}</a></div>`
          : `<p class="set-hint">${t('settings.spotifyOnDisplay')}</p>`
    }
    <p class="set-hint">${t('settings.spotifySetup', { uri: sp.redirectUri })}</p>
  </section>`;
}

function briefingSection(s: Partial<GeneralSettings>) {
  const b = s.briefing || { time: null, weekdays: [0, 1, 2, 3, 4, 5, 6] };
  // Monday first; labels from the locale's own weekday names.
  const fmt = new Intl.DateTimeFormat(getState().config?.locale || undefined, { weekday: 'short' });
  const days = [1, 2, 3, 4, 5, 6, 0];
  return `<section class="set-section">
    <h2>${t('settings.briefing')}</h2>
    <p class="set-hint">${t('settings.briefingHint')}</p>
    <div class="set-row">
      <button class="switch ${b.time ? 'on' : ''}" data-action="briefing-toggle" aria-label="${esc(t('settings.briefing'))}"><i></i></button>
      ${b.time ? `<label class="time-field">${t('settings.briefingAt')} <input class="set-input" type="time" value="${esc(b.time)}" data-input="briefingTime"></label>` : ''}
    </div>
    ${b.time ? `<div class="chips">${days.map((d) => `<button class="chip ${b.weekdays.includes(d) ? 'on' : ''}" data-action="briefing-day" data-v="${d}">${esc(fmt.format(new Date(Date.UTC(2024, 0, 7 + d, 12))))}</button>`).join('')}</div>` : ''}
  </section>`;
}

function calendarSection(s: Partial<GeneralSettings>) {
  const status = getState().sections.calendar?.data?.calendars || [];
  const rows = calList(s)
    .map((c, i) => {
      const st = status[i];
      return `<li><span class="cal-dot" style="background:${esc(st?.color || '#4f8ef7')}"></span><div><b>${esc(c.name || st?.name || t('settings.calendarUnnamed'))}</b><small>${esc(maskUrl(c.url))}${st && !st.ok ? ` · ${esc(t('settings.calendarFailing'))}` : ''}</small></div><button class="icon-btn danger" data-action="cal-remove" data-v="${i}" aria-label="${esc(t('settings.remove'))}">✕</button></li>`;
    })
    .join('');
  return `<section class="set-section">
    <h2>${t('settings.calendars')}</h2>
    <p class="set-hint">${t('settings.calendarsHint')}</p>
    ${rows ? `<ul class="fav-list cal-settings">${rows}</ul>` : ''}
    <div class="set-row cal-add">
      <input class="set-input" maxlength="40" placeholder="${esc(t('settings.calendarName'))}" data-cal="name" aria-label="${esc(t('settings.calendarName'))}">
      <input class="set-input wide" placeholder="https://… .ics" data-cal="url" autocomplete="off" aria-label="${esc(t('settings.calendarUrl'))}">
      <button class="btn-primary" data-action="cal-add">${t('settings.calendarAdd')}</button>
    </div>
  </section>`;
}

/** What a feature still needs before it can show anything (set outside the screen). */
function featureHint(k: string) {
  const c = getState().config;
  if (k === 'calendar' && !c?.calendar) return t('settings.calendarHint');
  if (k === 'spotify' && !c?.spotify) return t('settings.spotifyHint');
  if (k === 'motion') return t('settings.motionHint');
  if (k === 'assistant' && !c?.assistantKey) return t('settings.assistantHint');
  if (k === 'assistant') return t('settings.assistantOn');
  return '';
}

const FEATURE_KEYS = ['alerts', 'airQuality', 'uv', 'holidays', 'moon', 'electricity', 'reminders', 'countdowns', 'whereToWatch', 'preMatch', 'matchday', 'radar', 'brackets', 'calendar', 'cooking', 'spotify', 'assistant', 'motion', 'wifiQr'] as const;
const POWER_REGIONS = ['peninsula', 'canarias', 'baleares', 'ceuta', 'melilla'];
const COUNTDOWN_DAYS = [7, 14, 30, 60];
const ROTATIONS = [30, 60, 90, 120];
const SUGGESTED_SYMBOLS: [string, string][] = [
  ['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'], ['^DJI', 'Dow Jones'], ['^IBEX', 'IBEX 35'], ['^STOXX50E', 'Euro Stoxx 50'], ['^FTSE', 'FTSE 100'],
  ['^GDAXI', 'DAX'], ['^N225', 'Nikkei 225'], ['BTC-USD', 'Bitcoin'], ['ETH-USD', 'Ethereum'], ['EURUSD=X', 'EUR/USD'], ['GC=F', 'Oro / Gold'], ['CL=F', 'Petróleo / Oil'],
];
const MAX_SYMBOLS = 12;
const MAX_LEAGUES = 25;
const KINDS: LeagueInfo['kind'][] = ['league', 'cup', 'continental', 'national'];
const NOTE_COLORS = ['yellow', 'green', 'blue', 'pink'];

const ui = {
  open: false,
  tab: 'general' as Tab,
  general: null as { settings: GeneralSettings; languages: { code: string; name: string }[]; timezones: string[] } | null,
  symbolQuery: '',
  symbolResults: [] as { symbol: string; name: string; type: string; exchange: string }[],
  fav: null as Favorites | null,
  leagues: [] as LeagueInfo[],
  sport: 'soccer' as SportKey,
  league: null as string | null,
  teams: new Map<string, CatalogTeam[]>(),
  drivers: null as { id: string; name: string; code: string; team: string; color: string }[] | null,
  tour: 'atp' as 'atp' | 'wta',
  players: new Map<string, { id: string; name: string; rank: number; flag: string | null; tour: 'atp' | 'wta' }[]>(),
  query: '',
  noteColor: 'yellow',
  error: '',
  backups: null as { name: string; kind: 'auto' | 'before-restore'; at: number; size: number }[] | null,
  restore: null as { backup?: unknown; name?: string; at?: number; info?: BackupInfo } | null,
  restoreError: '',
  kitchen: null as { recipes: { id: string; title: string; source: string | null; image: string | null; steps: number }[]; memories: { id: string; text: string }[] } | null,
  cookBusy: false,
  cookError: '',
};

let root: HTMLElement;
let onCloseCb: (() => void) | null = null;

const api = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
  return res.status === 204 ? (undefined as T) : res.json();
};

const sportOfLeague = (key: string) => ui.leagues.find((l) => l.key === key)?.sport;
/** A team is the same favourite whichever competition list it was picked from. */
/** The same team? Football ids are global on ESPN (a national team is one id in every competition). */
const sameTeam = (f: FavTeam, league: string, team: CatalogTeam) => {
  if (sportOfLeague(f.league) !== sportOfLeague(league)) return false;
  const id = f.id || f.resolvedId;
  const anyLeague = sportOfLeague(league) === 'soccer';
  if (id) return id === team.id && (anyLeague || f.league === league);
  return f.league === league && f.name === team.name;
};

export const isSettingsOpen = () => ui.open;

export function initSettings(onClose: () => void) {
  onCloseCb = onClose;
  root = document.createElement('section');
  root.className = 'settings';
  root.hidden = true;
  document.body.appendChild(root);
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  subscribe((s, changed) => {
    if (ui.open && changed === 'notes' && ui.tab === 'notes') renderNotesList();
    if (ui.open && changed === 'countdowns' && ui.tab === 'dates') renderCountdowns();
    // Server came back: retry whatever failed to load.
    if (ui.open && changed === 'connection' && s.connected && ui.error) openSettings();
  });
  if (/^#(settings|ajustes)$/.test(location.hash)) openSettings();
  window.addEventListener('hashchange', () => (/^#(settings|ajustes)$/.test(location.hash) ? openSettings() : closeSettings()));
}

export async function openSettings(tab?: Tab) {
  ui.open = true;
  if (tab) ui.tab = tab;
  root.hidden = false;
  document.body.classList.add('settings-open');
  render();
  try {
    const [fav, leagues, general] = await Promise.all([
      api<Favorites>('/api/favorites'),
      ui.leagues.length ? Promise.resolve(ui.leagues) : api<LeagueInfo[]>('/api/catalog/leagues'),
      api<NonNullable<typeof ui.general>>('/api/settings'),
    ]);
    ui.fav = fav;
    ui.leagues = leagues;
    ui.general = general;
    ui.error = '';
  } catch {
    ui.error = t('settings.offline');
  }
  render();
}

export function closeSettings() {
  if (!ui.open) return;
  ui.open = false;
  root.hidden = true;
  document.body.classList.remove('settings-open');
  if (location.hash) history.replaceState(null, '', location.pathname);
  onCloseCb?.();
}

// ─── Persistence ────────────────────────────────────────────
let saveTimer: number | undefined;
function save() {
  if (!ui.fav) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      ui.fav = await api<Favorites>('/api/favorites', { method: 'PUT', body: JSON.stringify(ui.fav) });
      flash(t('settings.saved'));
      // Competitions are discovered in the background: refresh the list shortly after.
      setTimeout(async () => {
        if (!ui.open || ui.tab !== 'teams') return;
        ui.fav = await api<Favorites>('/api/favorites').catch(() => ui.fav);
        renderFavList();
      }, 8000);
    } catch (err) {
      flash(t('settings.saveFailed', { error: (err as Error).message }));
    }
  }, 300);
}

function flash(text: string) {
  const el = root.querySelector<HTMLElement>('.set-flash');
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 1800);
}

// ─── Rendering ──────────────────────────────────────────────
function render() {
  root.innerHTML = `
    <div class="set-panel">
      <header class="set-head">
        <h1>${t('settings.title')}</h1>
        <nav class="set-tabs">${TABS.map((k) => `<button class="${ui.tab === k ? 'on' : ''}" data-action="tab" data-v="${k}">${t(`settings.tabs.${k}`)}</button>`).join('')}</nav>
        <button class="set-done" data-action="close">${t('settings.done')}</button>
      </header>
      <div class="set-body">${ui.error ? `<div class="set-error">${esc(ui.error)}</div>` : ''}${body()}</div>
      <div class="set-flash" role="status"></div>
    </div>`;
  if (ui.tab === 'teams') {
    renderFavList();
    if (ui.league) loadTeams(ui.league);
  }
  if (ui.tab === 'f1') ui.drivers ? renderDrivers() : loadDrivers();
  if (ui.tab === 'tennis') ui.players.has(ui.tour) ? renderPlayers() : loadPlayers(ui.tour);
  if (ui.tab === 'notes') renderNotesList();
  if (ui.tab === 'markets') renderSymbols();
  if (ui.tab === 'dates') renderCountdowns();
  if (ui.tab === 'kitchen' && !ui.kitchen) loadKitchen();
  if (ui.tab === 'general' && !ui.backups) loadBackups();
}

// ─── Dates (countdowns) ─────────────────────────────────────
function datesTab() {
  return `
    <section class="set-section">
      <h2>${t('settings.countdowns')}</h2>
      <p class="set-hint">${t('settings.countdownsHint')}</p>
      <div class="note-compose">
        <div class="set-row">
          <input class="set-input" maxlength="60" placeholder="${esc(t('settings.countdownPlaceholder'))}" data-cd="title" aria-label="${esc(t('settings.countdownTitle'))}">
          <input class="set-input date" type="date" data-cd="date" aria-label="${esc(t('settings.countdownDate'))}">
        </div>
        <div class="set-row">
          <label class="check"><input type="checkbox" data-cd="yearly"> ${t('settings.countdownYearly')}</label>
          <button class="btn-primary" data-action="add-countdown">${t('settings.addCountdown')}</button>
        </div>
      </div>
      <ul class="fav-list cd-list" data-countdowns></ul>
    </section>`;
}

function renderCountdowns() {
  const box = root.querySelector('[data-countdowns]');
  if (!box) return;
  const s = getState();
  const list = [...(s.sections.countdowns?.data || [])].map((c: Countdown) => ({ c, ...nextOccurrence(c, s) })).sort((a, b) => a.days - b.days);
  box.innerHTML = list.length
    ? list
        .map(
          ({ c, date, days }) => `<li>
            <div class="fav-name"><b>${esc(c.title)}</b><span>${esc(matchWhen(`${date}T12:00:00Z`).label)} · ${days >= 0 ? t('settings.inDays', { n: days }) : ''}${c.yearly ? ` · ${t('settings.yearly')}` : ''}</span></div>
            <button class="icon-btn danger" data-action="del-countdown" data-id="${esc(c.id)}" aria-label="${t('settings.remove')}">✕</button>
          </li>`,
        )
        .join('')
    : `<p class="set-hint">${t('settings.noCountdowns')}</p>`;
}

// ─── General ────────────────────────────────────────────────
function generalTab() {
  if (!ui.general) return `<div class="set-loading">${t('common.loading')}</div>`;
  const s = ui.general.settings;
  const tzs = ui.general.timezones.includes(s.timezone) ? ui.general.timezones : [s.timezone, ...ui.general.timezones];
  return `
    <p class="set-hint">${t('settings.generalHint')}</p>
    <section class="set-section">
      <h2>${t('settings.language')}</h2>
      <div class="chips">${ui.general.languages.map((l) => `<button class="chip ${s.language === l.code ? 'on' : ''}" data-action="set-language" data-v="${esc(l.code)}">${esc(l.name)}</button>`).join('')}</div>
    </section>
    <section class="set-section">
      <h2>${t('settings.userName')}</h2>
      <input class="set-input narrow" type="text" maxlength="40" value="${esc(s.userName || '')}" data-input="userName" autocomplete="off">
      <p class="set-hint">${t('settings.userNameHint')}</p>
    </section>
    <section class="set-section set-grid">
      <div>
        <h2>${t('settings.timezone')}</h2>
        <select class="set-input" data-input="timezone">${tzs.map((z) => `<option ${z === s.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
      </div>
      <div>
        <h2>${t('settings.clock24h')}</h2>
        <button class="switch ${s.clock24h ? 'on' : ''}" data-action="set-clock" aria-label="${t('settings.clock24h')}"><i></i></button>
      </div>
    </section>
    <section class="set-section">
      <h2>${t('settings.rotation')}</h2>
      <div class="chips">${ROTATIONS.map((n) => `<button class="chip ${s.rotationSeconds === n ? 'on' : ''}" data-action="set-rotation" data-v="${n}">${t('settings.seconds', { n })}</button>`).join('')}</div>
    </section>
    <section class="set-section">
      <h2>${t('settings.features')}</h2>
      <p class="set-hint">${t('settings.featuresHint')}</p>
      <ul class="feature-list">${FEATURE_KEYS.map(
        (k) => `<li><span>${t(`settings.feature.${k}`)}${featureHint(k) ? `<small>${esc(featureHint(k))}</small>` : ''}</span><button class="switch ${s.features?.[k] ? 'on' : ''}" data-action="set-feature" data-v="${k}" aria-label="${esc(t(`settings.feature.${k}`))}"><i></i></button></li>`,
      ).join('')}</ul>
    </section>
    ${
      s.features?.radar
        ? `<section class="set-section"><h2>${t('settings.radarShowWhen')}</h2><div class="chips">${(['rain', 'always'] as const).map((v) => `<button class="chip ${(s.radar?.showWhen || 'rain') === v ? 'on' : ''}" data-action="set-radar" data-v="${v}">${t(v === 'rain' ? 'settings.radarRain' : 'settings.radarAlways')}</button>`).join('')}</div></section>`
        : ''
    }
    ${
      s.features?.electricity
        ? `<section class="set-section"><h2>${t('settings.powerRegion')}</h2><div class="chips">${POWER_REGIONS.map((r) => `<button class="chip ${s.electricity?.region === r ? 'on' : ''}" data-action="set-power-region" data-v="${r}">${t(`power.regions.${r}`)}</button>`).join('')}</div></section>`
        : ''
    }
    ${
      s.features?.countdowns
        ? `<section class="set-section"><h2>${t('settings.countdownDays')}</h2><div class="chips">${COUNTDOWN_DAYS.map((n) => `<button class="chip ${s.countdowns?.withinDays === n ? 'on' : ''}" data-action="set-countdown-days" data-v="${n}">${t('settings.days', { n })}</button>`).join('')}</div></section>`
        : ''
    }
    ${s.features?.motion ? motionSection(s) : ''}
    ${s.features?.calendar ? calendarSection(s) : ''}
    ${s.features?.spotify && getState().config?.spotify ? spotifySection() : ''}
    ${s.features?.assistant && getState().config?.assistantKey ? briefingSection(s) : ''}
    ${
      s.features?.wifiQr
        ? `<section class="set-section">
            <h2>${t('settings.wifiTitle')}</h2>
            <p class="set-hint">${t('settings.wifiHint')}</p>
            <div class="set-grid wifi-grid">
              <label>${t('settings.wifiSsid')}<input class="set-input" maxlength="32" value="${esc(s.wifi?.ssid || '')}" data-input="wifiSsid" autocomplete="off"></label>
              <label>${t('settings.wifiPassword')}<input class="set-input" maxlength="63" value="${esc(s.wifi?.password || '')}" data-input="wifiPassword" autocomplete="off"></label>
            </div>
            <div class="set-row">
              <div class="chips">${['WPA', 'WEP', 'nopass'].map((x) => `<button class="chip ${s.wifi?.security === x ? 'on' : ''}" data-action="set-wifi-security" data-v="${x}">${x === 'nopass' ? t('settings.wifiNopass') : x}</button>`).join('')}</div>
              <label class="check"><input type="checkbox" ${s.wifi?.hidden ? 'checked' : ''} data-input="wifiHidden"> ${t('settings.wifiHidden')}</label>
            </div>
          </section>`
        : ''
    }
    <section class="set-section">
      <h2>${t('settings.nightMode')}</h2>
      <div class="set-row">
        <button class="switch ${s.nightMode.enabled ? 'on' : ''}" data-action="set-night" aria-label="${t('settings.nightMode')}"><i></i></button>
        <label class="time-field">${t('settings.nightFrom')} <input class="set-input" type="time" value="${esc(s.nightMode.start)}" data-input="nightStart"></label>
        <label class="time-field">${t('settings.nightTo')} <input class="set-input" type="time" value="${esc(s.nightMode.end)}" data-input="nightEnd"></label>
      </div>
    </section>
    ${backupSection()}`;
}

// ─── Backup and restore ─────────────────────────────────────
async function pickBackupFile(el: HTMLInputElement) {
  const file = el.files?.[0];
  el.value = '';
  if (!file) return;
  ui.restore = null;
  ui.restoreError = '';
  try {
    const backup = JSON.parse(await file.text());
    const info = await api<BackupInfo>('/api/backup/inspect', { method: 'POST', body: JSON.stringify(backup) });
    ui.restore = { backup, info };
  } catch (err) {
    ui.restoreError = t('settings.backupFailed', { error: err instanceof SyntaxError ? t('settings.backupNotJson') : (err as Error).message });
  }
  render();
}
type BackupInfo = { exportedAt: string | null; counts: Record<string, number> };
async function loadBackups() {
  ui.backups = await api<NonNullable<typeof ui.backups>>('/api/backups').catch(() => []);
  if (ui.open && ui.tab === 'general') render();
}

const when = (ts: string | number | null) => (ts ? new Date(ts).toLocaleString(getState().config?.locale || undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '?');

/** "7 teams, 12 notes, 3 recipes…": what a restore brings back. */
function summary(info: BackupInfo) {
  return Object.entries(info.counts)
    .filter(([k, n]) => n && k !== 'settings')
    .map(([k, n]) => t(`settings.backupCounts.${k}`, { n }))
    .join(' · ');
}

function backupSection() {
  const r = ui.restore;
  return `<section class="set-section">
    <h2>${t('settings.backup')}</h2>
    <p class="set-hint">${t('settings.backupHint')}</p>
    <div class="set-row backup-actions">
      <a class="btn-primary" href="/api/backup" download>${t('settings.backupDownload')}</a>
      <label class="chip file-chip">${t('settings.backupFromFile')}<input type="file" accept="application/json,.json" data-input="backupFile" hidden></label>
    </div>
    ${ui.restoreError ? `<p class="set-error">${esc(ui.restoreError)}</p>` : ''}
    ${
      r
        ? `<div class="restore-confirm">
            <p><b>${esc(t('settings.backupConfirm', { date: when(r.info?.exportedAt || r.at || null) }))}</b>${r.info ? `<br><small>${esc(summary(r.info))}</small>` : ''}</p>
            <p class="set-hint">${t('settings.backupConfirmHint')}</p>
            <div class="set-row"><button class="btn-primary" data-action="restore-go">${t('settings.backupRestore')}</button><button class="chip" data-action="restore-cancel">${t('settings.cancel')}</button></div>
          </div>`
        : ''
    }
    ${
      ui.backups?.length
        ? `<h3 class="set-sub">${t('settings.backupAuto')}</h3>
          <ul class="fav-list cal-settings">${ui.backups
            .slice(0, 6)
            .map(
              (b) => `<li><div><b>${esc(when(b.at))}</b><small>${esc(t(b.kind === 'auto' ? 'settings.backupDaily' : 'settings.backupBeforeRestore'))} · ${Math.max(1, Math.round(b.size / 1024))} KB</small></div>
                <button class="chip" data-action="restore-pick" data-v="${esc(b.name)}" data-at="${b.at}">${t('settings.backupRestore')}</button></li>`,
            )
            .join('')}</ul>`
        : ''
    }
  </section>`;
}

let settingsTimer: number | undefined;
function saveSettings(patch: Partial<GeneralSettings>, delay = 0) {
  if (!ui.general) return;
  ui.general.settings = { ...ui.general.settings, ...patch } as GeneralSettings;
  clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(async () => {
    try {
      const r = await api<{ settings: GeneralSettings }>('/api/settings', { method: 'PUT', body: JSON.stringify(ui.general!.settings) });
      ui.general!.settings = r.settings;
      flash(t('settings.saved'));
    } catch (err) {
      flash(t('settings.saveFailed', { error: (err as Error).message }));
    }
  }, delay);
}

// ─── Markets ────────────────────────────────────────────────
function marketsTab() {
  return `
    <section class="set-section">
      <h2>${t('settings.symbols')}</h2>
      <div data-symbols></div>
    </section>
    <section class="set-section">
      <h2>${t('settings.addSymbol')}</h2>
      <input class="set-input" type="search" placeholder="${esc(t('settings.searchSymbol'))}" value="${esc(ui.symbolQuery)}" data-input="symbolQuery" autocomplete="off">
      <div class="symbol-results" data-symbol-results></div>
      <div class="league-group-set"><h3>${t('settings.suggested')}</h3><div class="chips" data-suggested></div></div>
    </section>`;
}

const symbolName = (sym: string) => getState().sections.finance?.data?.quotes.find((q) => q.symbol === sym)?.name || SUGGESTED_SYMBOLS.find(([s]) => s === sym)?.[1] || '';

function renderSymbols() {
  const box = root.querySelector('[data-symbols]');
  if (!box || !ui.fav) return;
  const list = ui.fav.symbols || [];
  box.innerHTML = list.length
    ? `<ul class="fav-list">${list
        .map(
          (sym, i) => `<li>
            <div class="fav-name"><b>${esc(symbolName(sym) || sym)}</b><span>${esc(sym)}</span></div>
            <button class="icon-btn" data-action="sym-move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="${t('settings.up')}">↑</button>
            <button class="icon-btn" data-action="sym-move" data-i="${i}" data-d="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="${t('settings.down')}">↓</button>
            <button class="icon-btn danger" data-action="sym-remove" data-v="${esc(sym)}" aria-label="${t('settings.remove')}">✕</button>
          </li>`,
        )
        .join('')}</ul>`
    : `<p class="set-hint">${t('settings.noSymbols')}</p>`;
  const sug = root.querySelector('[data-suggested]');
  if (sug) sug.innerHTML = SUGGESTED_SYMBOLS.map(([s, name]) => `<button class="chip ${list.includes(s) ? 'on' : ''}" data-action="sym-toggle" data-v="${esc(s)}">${esc(name)} <small>${esc(s)}</small></button>`).join('');
  renderSymbolResults();
}

function renderSymbolResults() {
  const box = root.querySelector('[data-symbol-results]');
  if (!box || !ui.fav) return;
  const list = ui.fav.symbols || [];
  if (!ui.symbolQuery.trim()) return void (box.innerHTML = '');
  box.innerHTML = ui.symbolResults.length
    ? ui.symbolResults
        .map(
          (r) => `<button class="player-pick ${list.includes(r.symbol) ? 'added' : ''}" data-action="sym-toggle" data-v="${esc(r.symbol)}">
            <span class="sym">${esc(r.symbol)}</span><b>${esc(r.name)}</b><small>${esc(typeLabel(r.type))} · ${esc(r.exchange)}</small>${list.includes(r.symbol) ? '<i class="tick">✓</i>' : ''}</button>`,
        )
        .join('')
    : `<p class="set-hint">${esc(t('settings.noSymbolMatch', { q: ui.symbolQuery }))}</p>`;
}

const typeLabel = (type: string) => {
  const label = t(`settings.types.${type}`);
  return label.startsWith('settings.') ? type : label;
};

let searchTimer: number | undefined;
function searchSymbols(q: string) {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(async () => {
    try {
      ui.symbolResults = q.trim() ? await api(`/api/catalog/symbols?q=${encodeURIComponent(q.trim())}`) : [];
    } catch {
      ui.symbolResults = [];
    }
    if (ui.symbolQuery === q) renderSymbolResults();
  }, 300);
}

function body() {
  if (!ui.fav && ui.tab !== 'notes' && ui.tab !== 'kitchen') return `<div class="set-loading">${t('common.loading')}</div>`;
  switch (ui.tab) {
    case 'general':
      return generalTab();
    case 'markets':
      return marketsTab();
    case 'teams':
      return teamsTab();
    case 'f1':
      return f1Tab();
    case 'tennis':
      return tennisTab();
    case 'notes':
      return notesTab();
    case 'kitchen':
      return kitchenTab();
    case 'dates':
      return datesTab();
  }
}

function teamsTab() {
  const leagues = ui.leagues.filter((l) => l.sport === ui.sport);
  const sports: SportKey[] = [...new Set(ui.leagues.map((l) => l.sport))];
  return `
    <section class="set-section">
      <h2>${t('settings.yourTeams')}</h2>
      <div data-favs></div>
    </section>
    <section class="set-section">
      <h2>${t('settings.yourLeagues')}</h2>
      <p class="set-hint">${t('settings.leaguesHint')}</p>
      ${
        ui.fav?.leagues?.length
          ? `<div class="chips">${ui.fav.leagues
              .map((k) => `<button class="chip on" data-action="unfollow-league" data-v="${esc(k)}">${esc(ui.leagues.find((l) => l.key === k)?.name || k)} ✕</button>`)
              .join('')}</div>`
          : `<p class="set-hint">${t('settings.noLeagues')}</p>`
      }
    </section>
    <section class="set-section">
      <h2>${t('settings.addTeam')}</h2>
      <p class="set-hint">${t('settings.addTeamHint')}</p>
      <div class="chips">${sports.map((k) => `<button class="chip ${ui.sport === k ? 'on' : ''}" data-action="sport" data-v="${k}">${t(`settings.sports.${k}`)}</button>`).join('')}</div>
      ${KINDS.map((kind) => {
        const ls = leagues.filter((l) => l.kind === kind);
        if (!ls.length) return '';
        return `<div class="league-group-set"><h3>${t(`settings.kinds.${kind}`)}</h3><div class="chips">${ls
          .map((l) => `<button class="chip ${ui.league === l.key ? 'on' : ''}" data-action="league" data-v="${l.key}">${esc(l.name)}${l.kind === 'league' ? ` <small>${esc(l.country)}</small>` : ''}</button>`)
          .join('')}</div></div>`;
      }).join('')}
      ${
        ui.league
          ? `<label class="follow-league"><button class="switch ${ui.fav?.leagues?.includes(ui.league) ? 'on' : ''}" data-action="follow-league" data-v="${esc(ui.league)}" aria-label="${esc(t('settings.followLeague'))}"><i></i></button>
              <span><b>${t('settings.followLeague')}</b><small>${t('settings.followLeagueHint')}</small></span></label>`
          : ''
      }
      <div class="team-picker" data-teams>${ui.league ? '' : `<p class="set-hint">${t('settings.pickCompetition')}</p>`}</div>
    </section>`;
}

function renderFavList() {
  const box = root.querySelector('[data-favs]');
  if (!box || !ui.fav) return;
  const favs = ui.fav.teams;
  box.innerHTML = favs.length
    ? `<ul class="fav-list">${favs
        .map(
          (f, i) => `<li class="${f.enabled === false ? 'off' : ''}">
            ${crest({ logo: f.logo || null, name: f.displayName || f.name }, 'md')}
            <div class="fav-name"><b>${esc(f.displayName || f.name)}</b><span>${esc(f.competitions?.length ? t('settings.competitions', { list: f.competitions.join(' · ') }) : f.leagueName || f.league)}</span></div>
            <button class="icon-btn" data-action="move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="${t('settings.up')}">↑</button>
            <button class="icon-btn" data-action="move" data-i="${i}" data-d="1" ${i === favs.length - 1 ? 'disabled' : ''} aria-label="${t('settings.down')}">↓</button>
            <button class="switch ${f.enabled === false ? '' : 'on'}" data-action="toggle-team" data-i="${i}" aria-label="${t('settings.show')}"><i></i></button>
            <button class="icon-btn danger" data-action="remove-team" data-i="${i}" aria-label="${t('settings.remove')}">✕</button>
          </li>`,
        )
        .join('')}</ul>`
    : `<p class="set-hint">${t('settings.noTeams')}</p>`;
}

async function loadTeams(league: string) {
  const box = root.querySelector<HTMLElement>('[data-teams]');
  if (!box) return;
  if (!ui.teams.has(league)) {
    box.innerHTML = `<div class="set-loading">${t('settings.loadingTeams')}</div>`;
    try {
      ui.teams.set(league, await api<CatalogTeam[]>(`/api/catalog/teams?league=${encodeURIComponent(league)}`));
    } catch (err) {
      box.innerHTML = `<p class="set-error">${esc(t('settings.teamsFailed', { error: (err as Error).message }))}</p>`;
      return;
    }
  }
  if (ui.league !== league) return;
  const teams = ui.teams.get(league)!;
  box.innerHTML = teams.length
    ? `<div class="team-grid">${teams
        .map((tm) => {
          const added = ui.fav!.teams.some((f) => sameTeam(f, league, tm));
          return `<button class="team-pick ${added ? 'added' : ''}" data-action="add-team" data-id="${esc(tm.id)}">${crest({ logo: tm.logo, name: tm.name }, 'md')}<span>${esc(tm.shortName || tm.name)}</span>${added ? '<i class="tick">✓</i>' : ''}</button>`;
        })
        .join('')}</div>`
    : `<p class="set-hint">${t('settings.noTeamsInComp')}</p>`;
}

function f1Tab() {
  return `
    <section class="set-section">
      <h2>${t('settings.drivers')}</h2>
      <p class="set-hint">${t('settings.driversHint')}</p>
      <div class="driver-grid" data-drivers><div class="set-loading">${t('settings.loadingDrivers')}</div></div>
    </section>`;
}

async function loadDrivers() {
  try {
    ui.drivers = await api('/api/catalog/drivers');
  } catch (err) {
    const box = root.querySelector('[data-drivers]');
    if (box) box.innerHTML = `<p class="set-error">${esc(t('settings.driversFailed', { error: (err as Error).message }))}</p>`;
    return;
  }
  renderDrivers();
}

function renderDrivers() {
  const box = root.querySelector('[data-drivers]');
  if (!box || !ui.drivers || !ui.fav) return;
  const mine = new Set(ui.fav.drivers.map((d) => d.id));
  box.innerHTML = ui.drivers
    .map(
      (d) => `<button class="driver-pick ${mine.has(d.id) ? 'added' : ''}" data-action="toggle-driver" data-id="${esc(d.id)}" style="--c:${esc(d.color)}">
        <i class="f1-bar"></i><b>${esc(d.name)}</b><span>${esc(d.team)}</span>${mine.has(d.id) ? '<i class="tick">✓</i>' : ''}</button>`,
    )
    .join('');
}

function tennisTab() {
  const mine = ui.fav!.players;
  return `
    <section class="set-section">
      <h2>${t('settings.players')}</h2>
      ${
        mine.length
          ? `<div class="chips">${mine.map((p) => `<button class="chip on" data-action="remove-player" data-id="${esc(p.id)}">${esc(p.name)} <small>${p.tour.toUpperCase()}</small> ✕</button>`).join('')}</div>`
          : `<p class="set-hint">${t('settings.playersHint')}</p>`
      }
    </section>
    <section class="set-section">
      <div class="set-row">
        <div class="chips">${(['atp', 'wta'] as const).map((tour) => `<button class="chip ${ui.tour === tour ? 'on' : ''}" data-action="tour" data-v="${tour}">${tour.toUpperCase()}</button>`).join('')}</div>
        <input class="set-input" type="search" placeholder="${esc(t('settings.searchPlayer'))}" value="${esc(ui.query)}" data-input="query" autocomplete="off">
      </div>
      <div class="player-list" data-players><div class="set-loading">${t('settings.loadingRanking')}</div></div>
    </section>`;
}

async function loadPlayers(tour: 'atp' | 'wta') {
  try {
    const list = await api<{ id: string; name: string; rank: number; flag: string | null }[]>(`/api/catalog/players?tour=${tour}`);
    ui.players.set(tour, list.map((p) => ({ ...p, tour })));
  } catch (err) {
    const box = root.querySelector('[data-players]');
    if (box) box.innerHTML = `<p class="set-error">${esc(t('settings.rankingFailed', { error: (err as Error).message }))}</p>`;
    return;
  }
  renderPlayers();
}

function renderPlayers() {
  const box = root.querySelector('[data-players]');
  const list = ui.players.get(ui.tour);
  if (!box || !list || !ui.fav) return;
  const q = ui.query.trim().toLowerCase();
  const mine = new Set(ui.fav.players.map((p) => p.id));
  const shown = list.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 60);
  box.innerHTML = shown.length
    ? shown
        .map(
          (p) => `<button class="player-pick ${mine.has(p.id) ? 'added' : ''}" data-action="toggle-player" data-id="${esc(p.id)}">
            <span class="rk">${p.rank}</span><b>${esc(p.name)}</b>${mine.has(p.id) ? '<i class="tick">✓</i>' : ''}</button>`,
        )
        .join('')
    : `<p class="set-hint">${esc(t('settings.noPlayerMatch', { q: ui.query }))}</p>`;
}

// ─── Kitchen: cooking mode recipes and what Dash remembers ──
async function loadKitchen() {
  try {
    const [recipes, memories] = await Promise.all([api<NonNullable<typeof ui.kitchen>['recipes']>('/api/recipes'), api<NonNullable<typeof ui.kitchen>['memories']>('/api/memories')]);
    ui.kitchen = { recipes, memories };
  } catch {
    ui.kitchen = { recipes: [], memories: [] };
  }
  if (ui.tab === 'kitchen') render();
}

function kitchenTab() {
  const k = ui.kitchen;
  const cooking = getState().sections.cooking?.data;
  return `
    <section class="set-section">
      <h2>${t('settings.cookTitle')}</h2>
      <p class="set-hint">${t('settings.cookHint')}</p>
      <div class="set-row cal-add">
        <input class="set-input wide" placeholder="https://…" data-cook="url" autocomplete="off" aria-label="${esc(t('settings.cookUrl'))}">
        <button class="btn-primary" data-action="cook-url" ${ui.cookBusy ? 'disabled' : ''}>${ui.cookBusy ? t('settings.cookReading') : t('settings.cookStart')}</button>
      </div>
      ${ui.cookError ? `<p class="set-error">${esc(ui.cookError)}</p>` : ''}
      ${cooking ? `<p class="set-hint">${esc(t('settings.cookingNow', { title: cooking.title }))} <button class="chip" data-action="cook-stop">${t('cooking.exit')}</button></p>` : ''}
    </section>
    <section class="set-section">
      <h2>${t('settings.recentRecipes')}</h2>
      ${
        !k
          ? `<p class="set-hint">${t('common.loading')}</p>`
          : k.recipes.length
            ? `<ul class="fav-list cal-settings">${k.recipes
                .map(
                  (r) => `<li><div><b>${esc(r.title)}</b><small>${esc([t('cooking.steps', { n: r.steps }), r.source ? new URL(r.source).host : t('settings.byAssistant')].join(' · '))}</small></div>
                  <button class="chip" data-action="cook-open" data-v="${esc(r.id)}">${t('settings.cookAgain')}</button>
                  <button class="icon-btn danger" data-action="recipe-del" data-v="${esc(r.id)}" aria-label="${esc(t('settings.remove'))}">✕</button></li>`,
                )
                .join('')}</ul>`
            : `<p class="set-hint">${t('settings.noRecipes')}</p>`
      }
    </section>
    <section class="set-section">
      <h2>${t('settings.memories')}</h2>
      <p class="set-hint">${t('settings.memoriesHint')}</p>
      <div class="set-row cal-add">
        <input class="set-input wide" maxlength="300" placeholder="${esc(t('settings.memoryPlaceholder'))}" data-mem="text" aria-label="${esc(t('settings.memories'))}">
        <button class="btn-primary" data-action="mem-add">${t('settings.memoryAdd')}</button>
      </div>
      ${
        k?.memories.length
          ? `<ul class="fav-list cal-settings">${k.memories.map((m) => `<li><div><b>${esc(m.text)}</b></div><button class="icon-btn danger" data-action="mem-del" data-v="${esc(m.id)}" aria-label="${esc(t('settings.remove'))}">✕</button></li>`).join('')}</ul>`
          : ''
      }
    </section>`;
}

function notesTab() {
  return `
    <section class="set-section">
      <h2>${t('settings.newNote')}</h2>
      <div class="note-compose">
        <textarea class="set-input" rows="3" maxlength="500" placeholder="${esc(t('settings.notePlaceholder'))}" data-input="note"></textarea>
        ${
          getState().config?.features?.reminders !== false
            ? `<label class="time-field remind">${t('settings.remindAt')} <input class="set-input" type="datetime-local" data-input="remindAt"><small>${t('settings.remindHint')}</small></label>`
            : ''
        }
        <div class="set-row">
          <div class="color-dots">${NOTE_COLORS.map((c) => `<button class="dot-c ${c} ${ui.noteColor === c ? 'on' : ''}" data-action="note-color" data-v="${c}" aria-label="${c}"></button>`).join('')}</div>
          <label class="check"><input type="checkbox" data-input="pin"> ${t('settings.pin')}</label>
          <button class="btn-primary" data-action="add-note">${t('settings.addNote')}</button>
        </div>
      </div>
    </section>
    <section class="set-section">
      <h2>${t('settings.yourNotes')}</h2>
      <ul class="note-list" data-notes></ul>
    </section>`;
}

function renderNotesList() {
  const box = root.querySelector('[data-notes]');
  if (!box) return;
  const notes: Note[] = visibleNotes(getState());
  box.innerHTML = notes.length
    ? notes
        .map(
          (n) => `<li class="note-item ${esc(n.color)} ${n.done ? 'done' : ''}">
            <button class="check-btn ${n.done ? 'on' : ''}" data-action="note-done" data-id="${esc(n.id)}" aria-label="${t('settings.markDone')}">✓</button>
            <p>${esc(n.text)}<small>${esc(ago(n.updatedAt))}${n.remindAt && !n.reminded ? ` · ⏰ ${esc(t('settings.reminderSet', { when: `${matchWhen(new Date(n.remindAt).toISOString()).label} ${timeOf(new Date(n.remindAt))}` }))}` : ''}</small></p>
            <button class="icon-btn ${n.pinned ? 'on' : ''}" data-action="note-pin" data-id="${esc(n.id)}" aria-label="${t('settings.pinNote')}">📌</button>
            <button class="icon-btn danger" data-action="note-del" data-id="${esc(n.id)}" aria-label="${t('settings.deleteNote')}">✕</button>
          </li>`,
        )
        .join('')
    : `<p class="set-hint">${t('settings.noNotes')}</p>`;
}

// ─── Events ─────────────────────────────────────────────────
function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  switch (el.dataset.input) {
    case 'backupFile':
      return void pickBackupFile(el);
    case 'query':
      ui.query = el.value;
      return renderPlayers();
    case 'symbolQuery':
      ui.symbolQuery = el.value;
      return searchSymbols(el.value);
    case 'userName':
      return saveSettings({ userName: el.value }, 600);
    case 'timezone':
      return saveSettings({ timezone: el.value });
    case 'wifiSsid':
    case 'wifiPassword':
      if (!ui.general) return;
      return saveSettings({ wifi: { ...ui.general.settings.wifi, [el.dataset.input === 'wifiSsid' ? 'ssid' : 'password']: el.value } }, 700);
    case 'wifiHidden':
      if (!ui.general) return;
      return saveSettings({ wifi: { ...ui.general.settings.wifi, hidden: el.checked } });
    case 'briefingTime':
      if (!ui.general || !/^\d{2}:\d{2}$/.test(el.value)) return;
      return saveSettings({ briefing: { ...ui.general.settings.briefing, time: el.value } }, 400);
    case 'nightStart':
    case 'nightEnd':
      if (!ui.general || !/^\d{2}:\d{2}$/.test(el.value)) return;
      return saveSettings({ nightMode: { ...ui.general.settings.nightMode, [el.dataset.input === 'nightStart' ? 'start' : 'end']: el.value } }, 400);
  }
}

function toggleTeam(id: string) {
  const league = ui.league!;
  const tm = ui.teams.get(league)?.find((x) => x.id === id);
  if (!tm || !ui.fav) return;
  const existing = ui.fav.teams.findIndex((f) => sameTeam(f, league, tm));
  if (existing >= 0) {
    ui.fav.teams.splice(existing, 1);
  } else {
    // A near-white primary is useless as a surface color: prefer the alternate.
    const color = tm.color && onColor(tm.color) === '#14202e' && tm.altColor ? tm.altColor : tm.color || undefined;
    const fav: FavTeam = { key: `${league}-${tm.id}`, league, id: tm.id, name: tm.name, displayName: tm.shortName || tm.name, logo: tm.logo || undefined, color: color || undefined, enabled: true };
    ui.fav.teams.push(fav);
  }
  save();
  render();
}

async function onClick(e: Event) {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!btn) return;
  const { action, v, i, d, id } = btn.dataset;
  const fav = ui.fav;
  switch (action) {
    case 'close':
      return closeSettings();
    case 'set-language':
      if (!ui.general || ui.general.settings.language === v) return;
      setLanguage(v); // re-render Settings in the new language right away
      saveSettings({ language: v! });
      return render();
    case 'set-feature': {
      if (!ui.general) return;
      const k = v as (typeof FEATURE_KEYS)[number];
      saveSettings({ features: { ...ui.general.settings.features, [k]: !ui.general.settings.features?.[k] } });
      return render();
    }
    case 'set-radar':
      saveSettings({ radar: { showWhen: v as 'rain' | 'always' } });
      return render();
    case 'set-power-region':
      saveSettings({ electricity: { region: v! } });
      return render();
    case 'set-countdown-days':
      saveSettings({ countdowns: { withinDays: Number(v) } });
      return render();
    case 'set-wifi-security':
      if (ui.general) saveSettings({ wifi: { ...ui.general.settings.wifi, security: v! } });
      return render();
    case 'cal-add': {
      if (!ui.general) return;
      const name = root.querySelector<HTMLInputElement>('[data-cal="name"]')!;
      const url = root.querySelector<HTMLInputElement>('[data-cal="url"]')!;
      if (!/^(https?|webcals?):\/\/\S+$/i.test(url.value.trim())) return url.focus();
      saveSettings({ calendar: { ...ui.general.settings.calendar, urls: [...calList(ui.general.settings), { name: name.value.trim(), url: url.value.trim() }] } });
      return render();
    }
    case 'cal-remove': {
      if (!ui.general) return;
      saveSettings({ calendar: { ...ui.general.settings.calendar, urls: calList(ui.general.settings).filter((_, i) => i !== Number(v)) } });
      return render();
    }
    case 'add-countdown': {
      const title = root.querySelector<HTMLInputElement>('[data-cd="title"]')!;
      const date = root.querySelector<HTMLInputElement>('[data-cd="date"]')!;
      const yearly = root.querySelector<HTMLInputElement>('[data-cd="yearly"]')!;
      if (!title.value.trim()) return title.focus();
      if (!date.value) return date.focus();
      try {
        await api('/api/countdowns', { method: 'POST', body: JSON.stringify({ title: title.value, date: date.value, yearly: yearly.checked }) });
        title.value = '';
        date.value = '';
        yearly.checked = false;
        flash(t('settings.saved'));
      } catch (err) {
        flash(t('settings.saveFailed', { error: (err as Error).message }));
      }
      return;
    }
    case 'del-countdown':
      await api(`/api/countdowns/${id}`, { method: 'DELETE' }).catch(() => flash(t('settings.noteDeleteFailed')));
      return;
    case 'set-clock':
      saveSettings({ clock24h: !ui.general?.settings.clock24h });
      return render();
    case 'set-rotation':
      saveSettings({ rotationSeconds: Number(v) });
      return render();
    case 'set-night':
      if (ui.general) saveSettings({ nightMode: { ...ui.general.settings.nightMode, enabled: !ui.general.settings.nightMode.enabled } });
      return render();
    case 'sym-toggle': {
      if (!fav) return;
      const list = (fav.symbols ||= []);
      const idx = list.indexOf(v!);
      if (idx >= 0) list.splice(idx, 1);
      else if (list.length >= MAX_SYMBOLS) return flash(t('settings.symbolsMax'));
      else list.push(v!);
      save();
      return renderSymbols();
    }
    case 'sym-remove':
      if (fav) fav.symbols = (fav.symbols || []).filter((x) => x !== v);
      save();
      return renderSymbols();
    case 'sym-move': {
      if (!fav?.symbols) return;
      const a = +i!;
      const b = a + +d!;
      [fav.symbols[a], fav.symbols[b]] = [fav.symbols[b], fav.symbols[a]];
      save();
      return renderSymbols();
    }
    case 'tab':
      ui.tab = v as Tab;
      if (v === 'kitchen') ui.kitchen = null; // fresh list every time
      return render();
    case 'motion-dim':
    case 'motion-sens':
      if (!ui.general) return;
      saveSettings({ motion: { ...(ui.general.settings.motion || { dimAfterMinutes: 10, sensitivity: 'medium' }), ...(action === 'motion-dim' ? { dimAfterMinutes: Number(v) } : { sensitivity: v as 'low' | 'medium' | 'high' }) } });
      return render();
    case 'spotify-logout':
      await api('/api/spotify/logout', { method: 'POST' }).catch(() => {});
      return render();
    case 'restore-pick':
      ui.restore = { name: v, at: Number(btn.dataset.at) };
      ui.restoreError = '';
      return render();
    case 'restore-cancel':
      ui.restore = null;
      return render();
    case 'restore-go': {
      const r = ui.restore;
      if (!r) return;
      try {
        await api('/api/backup/restore', { method: 'POST', body: JSON.stringify(r.name ? { name: r.name } : r.backup) });
        ui.restore = null;
        ui.backups = null;
        await openSettings('general'); // reload everything from the restored data
        return flash(t('settings.backupRestored'));
      } catch (err) {
        ui.restoreError = t('settings.backupFailed', { error: (err as Error).message });
        return render();
      }
    }
    case 'cook-url': {
      const url = root.querySelector<HTMLInputElement>('[data-cook="url"]')!;
      if (!/^https?:\/\//i.test(url.value.trim())) return url.focus();
      ui.cookBusy = true;
      ui.cookError = '';
      render();
      try {
        await api('/api/cooking', { method: 'POST', body: JSON.stringify({ url: url.value.trim() }) });
        ui.cookBusy = false;
        return closeSettings(); // cooking mode takes the screen
      } catch (err) {
        ui.cookBusy = false;
        ui.cookError = t('settings.cookFailed', { error: (err as Error).message });
        return render();
      }
    }
    case 'cook-open':
      await api('/api/cooking', { method: 'POST', body: JSON.stringify({ id: v }) }).catch(() => {});
      return closeSettings();
    case 'cook-stop':
      await api('/api/cooking', { method: 'DELETE' }).catch(() => {});
      return render();
    case 'recipe-del':
      await api(`/api/recipes/${v}`, { method: 'DELETE' }).catch(() => {});
      return loadKitchen();
    case 'mem-add': {
      const el = root.querySelector<HTMLInputElement>('[data-mem="text"]')!;
      if (!el.value.trim()) return el.focus();
      await api('/api/memories', { method: 'POST', body: JSON.stringify({ text: el.value.trim() }) }).catch(() => {});
      return loadKitchen();
    }
    case 'mem-del':
      await api(`/api/memories/${v}`, { method: 'DELETE' }).catch(() => {});
      return loadKitchen();
    case 'briefing-toggle':
      if (!ui.general) return;
      saveSettings({ briefing: { ...ui.general.settings.briefing, time: ui.general.settings.briefing?.time ? null : '07:30' } });
      return render();
    case 'briefing-day': {
      if (!ui.general) return;
      const days = new Set(ui.general.settings.briefing?.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
      days.has(Number(v)) ? days.delete(Number(v)) : days.add(Number(v));
      saveSettings({ briefing: { ...ui.general.settings.briefing, weekdays: [...days] } });
      return render();
    }
    case 'sport':
      ui.sport = v as SportKey;
      ui.league = null;
      return render();
    case 'league':
      ui.league = v!;
      return render();
    case 'follow-league':
    case 'unfollow-league': {
      if (!fav) return;
      const set = new Set(fav.leagues || []);
      if (action === 'unfollow-league' || set.has(v!)) set.delete(v!);
      else if (set.size >= MAX_LEAGUES) return flash(t('settings.leaguesFull', { n: MAX_LEAGUES }));
      else set.add(v!);
      fav.leagues = [...set];
      save();
      return render();
    }
    case 'add-team':
      return toggleTeam(id!);
    case 'toggle-team':
      if (fav) fav.teams[+i!].enabled = fav.teams[+i!].enabled === false;
      save();
      return renderFavList();
    case 'remove-team':
      fav?.teams.splice(+i!, 1);
      save();
      return render();
    case 'move': {
      if (!fav) return;
      const a = +i!;
      const b = a + +d!;
      [fav.teams[a], fav.teams[b]] = [fav.teams[b], fav.teams[a]];
      save();
      return renderFavList();
    }
    case 'toggle-driver': {
      if (!fav || !ui.drivers) return;
      const idx = fav.drivers.findIndex((x) => x.id === id);
      if (idx >= 0) fav.drivers.splice(idx, 1);
      else {
        const dr = ui.drivers.find((x) => x.id === id)!;
        fav.drivers.push({ id: dr.id, name: dr.name, code: dr.code });
      }
      save();
      return renderDrivers();
    }
    case 'tour':
      ui.tour = v as 'atp' | 'wta';
      return render();
    case 'toggle-player': {
      if (!fav) return;
      const idx = fav.players.findIndex((x) => x.id === id);
      if (idx >= 0) fav.players.splice(idx, 1);
      else {
        const p = ui.players.get(ui.tour)!.find((x) => x.id === id)!;
        fav.players.push({ id: p.id, name: p.name, tour: ui.tour, flag: p.flag });
      }
      save();
      return render();
    }
    case 'remove-player':
      if (fav) fav.players = fav.players.filter((x) => x.id !== id);
      save();
      return render();
    case 'note-color':
      ui.noteColor = v!;
      root.querySelectorAll('.dot-c').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.v === v));
      return;
    case 'add-note': {
      const ta = root.querySelector<HTMLTextAreaElement>('[data-input="note"]')!;
      const pin = root.querySelector<HTMLInputElement>('[data-input="pin"]')!;
      const remind = root.querySelector<HTMLInputElement>('[data-input="remindAt"]');
      const text = ta.value.trim();
      if (!text) return ta.focus();
      // datetime-local is wall-clock time on this device: Date parses it as local time.
      const remindAt = remind?.value ? new Date(remind.value).getTime() : null;
      try {
        await api('/api/notes', { method: 'POST', body: JSON.stringify({ text, color: ui.noteColor, pinned: pin.checked, remindAt }) });
        ta.value = '';
        pin.checked = false;
        if (remind) remind.value = '';
        flash(t('settings.noteAdded'));
      } catch (err) {
        flash(t('settings.saveFailed', { error: (err as Error).message }));
      }
      return;
    }
    case 'note-done':
    case 'note-pin': {
      const n = getState().sections.notes?.data?.find((x) => x.id === id);
      if (!n) return;
      const patch = action === 'note-done' ? { done: !n.done } : { pinned: !n.pinned };
      await api(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).catch(() => flash(t('settings.noteUpdateFailed')));
      return;
    }
    case 'note-del':
      await api(`/api/notes/${id}`, { method: 'DELETE' }).catch(() => flash(t('settings.noteDeleteFailed')));
      return;
  }
}
