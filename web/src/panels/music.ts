// Spotify: a mini player in the corner of every screen while music plays, and a Music panel.
// The panel shows what's playing (artwork, progress, controls, volume, speaker), or, when nothing
// is playing or you tap "Browse", a picker to start something: choose a speaker, then one of your
// playlists or anything from search. Artists, albums, playlists and podcasts open a page with their
// songs (play all, shuffle, or start from one). While a song plays, its synced lyrics follow along
// (LRCLIB). Playback runs on your own Spotify devices; Dash controls it.
import type { AppState, SpotifyState } from '../types';
import { getState, subscribe, now } from '../store';
import { esc } from '../format';
import { t } from '../i18n';

const music = (s: AppState = getState()): SpotifyState | null => (connected(s) ? s.sections.spotify?.data || null : null);
const connected = (s: AppState = getState()) => !!s.config?.spotify?.connected && s.config?.features?.spotify !== false;

// When music was last seen playing: a paused song stays on screen for a while, then goes away.
let lastPlaying = 0;
const recent = (m: SpotifyState | null) => {
  if (m?.playing) lastPlaying = now();
  return !!m?.item && (m.playing || now() - lastPlaying < 10 * 60e3);
};

/** Music is playing (or just paused): the panel comes right after Home. */
export const musicShown = (s: AppState) => recent(music(s));
/** Connected but idle: the panel stays reachable (end of the rotation) to start something. */
export const musicAvailable = (s: AppState) => connected(s);

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const control = (action: string, extra: Record<string, unknown> = {}) => post('/api/spotify/control', { action, ...extra });

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Where the song is now: the last poll plus the time since, while playing. */
const progressOf = (m: SpotifyState) => Math.min(m.item?.durationMs || 0, m.progressMs + (m.playing ? now() - m.at : 0));

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 6l8.5 6L6 18zm9 0h3v12h-3z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M18 6l-8.5 6 8.5 6zM6 6h3v12H6z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 11h14v2H5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M10 4a6 6 0 1 0 3.6 10.8l4.3 4.3 1.4-1.4-4.3-4.3A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3h-6Z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M14 4h6v6l-2.3-2.3-4.2 4.2-1.4-1.4 4.2-4.2zM4 5.4 5.4 4l14.3 14.3V16h2v6h-6v-2h2.3zM10.6 13.4 12 14.8 5.4 21.4 4 20z"/></svg>',
  lyrics: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h12v2H4zm0 4h12v2H4zm0 4h8v2H4zm14-4v6.3A3 3 0 1 0 20 18V11h2V9z"/></svg>',
};

type Device = { id: string; name: string; type: string; active: boolean };
type Item = { name: string; by?: string | null; uri: string; image: string | null };
type Results = { tracks: Item[]; artists: Item[]; albums: Item[]; playlists: Item[]; shows?: Item[] };
type Song = Item & { durationMs: number };
type Detail = {
  kind: 'artist' | 'album' | 'playlist' | 'show';
  uri: string;
  name: string;
  image: string | null;
  by?: string | null;
  year?: string | null;
  total?: number | null;
  description?: string | null;
  restricted?: boolean;
  artistUri?: string | null;
  tracks?: Song[];
  albums?: Item[];
  episodes?: (Song & { date: string | null })[];
};
type Lyrics = { instrumental: boolean; synced: { ms: number; text: string }[] | null; plain: string | null } | null;

// Picker state (this screen only).
let devices: Device[] | null = null;
let target: string | null = null; // device id to play on
let playlists: Item[] | null = null;
let query = '';
let results: Results | null = null;
let browse = false; // picker open while something plays
let starting = '';
let pickError = '';
let showDevices = false; // speaker list in the playing view
let detail: Detail | null = null; // artist / album / playlist / podcast page
let detailLoading = '';
const trail: string[] = []; // pages to go back to (artist → album → back)
let lyrics: { uri: string; data: Lyrics } | null = null;
let lyricsOn = (() => {
  try {
    return localStorage.getItem('dash:lyrics') !== 'off';
  } catch {
    return true;
  }
})();

// Something on the panel itself changed (a tap, search results…): the next render must happen.
let dirty = true;
const rerender = () => {
  dirty = true;
  window.dispatchEvent(new CustomEvent('dash:render', { detail: 'music' }));
};
const getJson = <T>(url: string): Promise<T | null> => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function loadPicker() {
  const [d, p] = await Promise.all([getJson<Device[]>('/api/spotify/devices'), playlists ? Promise.resolve(playlists) : getJson<Item[]>('/api/spotify/playlists')]);
  devices = d || [];
  playlists = p || [];
  // Default speaker: the active one, else the one used last time, else the first.
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('dash:spotifyDevice');
  } catch {}
  if (!target || !devices.some((x) => x.id === target)) target = devices.find((x) => x.active)?.id || devices.find((x) => x.id === saved)?.id || devices[0]?.id || null;
  rerender();
}

/** Songs play right away; artists, albums, playlists and podcasts open their page (the round button on
 *  the cover plays them straight away). */
const tile = (x: Item, big = true) => {
  const opens = /^spotify:(artist|album|playlist|show):/.test(x.uri);
  const round = x.uri.startsWith('spotify:artist:') ? 'round' : '';
  return `<div class="mu-tile ${big ? '' : 'row'}" data-mu="${opens ? 'open' : 'play-uri'}" data-uri="${esc(x.uri)}" data-name="${esc(x.name)}" role="button">
    <span class="mu-tile-img ${round}">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : ICON.note}
      ${opens && big ? `<button class="mu-tile-play" data-mu="play-uri" data-uri="${esc(x.uri)}" data-name="${esc(x.name)}" aria-label="${esc(t('music.play'))}">${ICON.play}</button>` : ''}</span>
    <span class="mu-tile-text"><b>${esc(x.name)}</b>${x.by ? `<small>${esc(x.by)}</small>` : ''}</span>
  </div>`;
};

/** One numbered song row; tapping it plays from there (the rest of the album/playlist follows). */
const songRow = (x: Song, i: number, ctx: string, showImage: boolean) =>
  `<button class="mu-song" data-mu="play-in" data-uri="${esc(x.uri)}" data-ctx="${esc(ctx)}" data-name="${esc(x.name)}">
    <span class="mu-song-n">${i + 1}</span>
    ${showImage && x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : ''}
    <span class="mu-tile-text"><b>${esc(x.name)}</b>${x.by ? `<small>${esc(x.by)}</small>` : ''}</span>
    <span class="mu-song-t">${x.durationMs ? mmss(x.durationMs) : ''}</span>
  </button>`;

function detailHtml() {
  if (detailLoading && !detail) return `<p class="mu-hint">${t('common.loading')}</p>`;
  if (!detail) return '';
  const d = detail;
  const sub =
    d.kind === 'artist'
      ? t('music.kind.artist')
      : [t(`music.kind.${d.kind}`), d.by, d.year, d.total ? t('music.songsCount', { n: d.total }) : null].filter(Boolean).join(' · ');
  const body =
    d.kind === 'artist'
      ? `${d.tracks?.length ? `<section class="mu-group"><h3>${t('music.popular')}</h3><div class="mu-songs">${d.tracks.map((x, i) => songRow(x, i, d.uri, true)).join('')}</div></section>` : ''}
         ${d.albums?.length ? `<section class="mu-group"><h3>${t('music.albums')}</h3><div class="mu-tiles">${d.albums.map((x) => tile(x)).join('')}</div></section>` : ''}`
      : d.kind === 'show'
        ? `<section class="mu-group"><h3>${t('music.episodes')}</h3><div class="mu-songs">${(d.episodes || [])
            .map(
              (x) => `<button class="mu-song ep" data-mu="play-uri" data-uri="${esc(x.uri)}" data-name="${esc(x.name)}">
                <span class="mu-tile-text"><b>${esc(x.name)}</b><small>${esc([x.date ? new Date(`${x.date}T12:00`).toLocaleDateString(getState().config?.locale || undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '', x.durationMs ? `${Math.round(x.durationMs / 60e3)} min` : ''].filter(Boolean).join(' · '))}</small></span>
                <span class="mu-song-play">${ICON.play}</span>
              </button>`,
            )
            .join('')}</div></section>`
        : d.restricted
          ? `<p class="mu-hint">${t('music.restricted')}</p>`
          : `<div class="mu-songs">${(d.tracks || []).map((x, i) => songRow(x, i, d.uri, d.kind === 'playlist')).join('')}</div>`;
  return `
    <div class="mu-detail">
      <header class="mu-dhead">
        <span class="mu-dimg ${d.kind === 'artist' ? 'round' : ''}">${d.image ? `<img src="${esc(d.image)}" alt="">` : ICON.note}</span>
        <div class="mu-dtext">
          <small>${esc(sub)}</small>
          <h2>${esc(d.name)}</h2>
          ${d.description ? `<p>${esc(d.description)}</p>` : ''}
          <div class="mu-dactions">
            ${d.kind !== 'show' ? `<button class="mu-pill-btn primary" data-mu="play-ctx" data-shuffle="0">${ICON.play}${t('music.play')}</button><button class="mu-pill-btn" data-mu="play-ctx" data-shuffle="1">${ICON.shuffle}${t('music.shuffle')}</button>` : ''}
            ${d.kind === 'album' && d.artistUri ? `<button class="mu-pill-btn" data-mu="open" data-uri="${esc(d.artistUri)}">${esc(d.by?.split(',')[0] || '')}</button>` : ''}
          </div>
        </div>
      </header>
      ${body}
    </div>`;
}

async function openDetail(uri: string, push = true) {
  if (push && detail) trail.push(detail.uri);
  detailLoading = uri;
  detail = null;
  pickError = '';
  rerender();
  const d = await getJson<Detail>(`/api/spotify/details?uri=${encodeURIComponent(uri)}`);
  if (detailLoading !== uri) return;
  detailLoading = '';
  detail = d;
  if (!d) pickError = t('music.failed');
  rerender();
  document.querySelector('.mu-picker')?.scrollTo({ top: 0 });
}

function closeDetail() {
  const prev = trail.pop();
  if (prev) return openDetail(prev, false);
  detail = null;
  detailLoading = '';
  rerender();
}

function resultsHtml() {
  if (!query) return '';
  if (!results) return `<p class="mu-hint">${t('music.searching')}</p>`;
  const groups: [keyof Results, string][] = [
    ['tracks', 'music.songs'],
    ['artists', 'music.artists'],
    ['albums', 'music.albums'],
    ['playlists', 'music.playlists'],
    ['shows', 'music.podcasts'],
  ];
  const html = groups
    .filter(([k]) => results![k]?.length)
    .map(([k, label]) => `<section class="mu-group"><h3>${t(label)}</h3><div class="mu-tiles ${k === 'tracks' ? 'list' : ''}">${results![k]!.slice(0, k === 'tracks' ? 6 : 4).map((x) => tile(x, k !== 'tracks')).join('')}</div></section>`)
    .join('');
  return html || `<p class="mu-hint">${t('music.noResults')}</p>`;
}

function pickerHtml(s: AppState, m: SpotifyState | null) {
  if (!devices) {
    loadPicker();
    return `<p class="mu-hint">${t('common.loading')}</p>`;
  }
  return `
    <div class="mu-picker">
      <div class="mu-target">
        <span>${ICON.speaker}${t('music.playOn')}</span>
        ${
          devices.length
            ? devices.map((d) => `<button class="chip ${d.id === target ? 'on' : ''}" data-mu="target" data-id="${esc(d.id)}">${esc(d.name)}</button>`).join('')
            : `<em>${t('music.noDevices')}</em>`
        }
      </div>
      ${
        detail || detailLoading
          ? `<button class="chip mu-dback" data-mu="detail-back">${ICON.back}${t('music.back')}</button>`
          : `<label class="mu-search">${ICON.search}<input type="search" placeholder="${esc(t('music.searchPlaceholder'))}" value="${esc(query)}" data-mu-search autocomplete="off"></label>`
      }
      ${starting ? `<p class="mu-hint">${esc(t('music.starting', { name: starting }))}</p>` : ''}
      ${pickError ? `<p class="set-error">${esc(pickError)}</p>` : ''}
      ${detail || detailLoading ? detailHtml() : `<div class="mu-results" data-mu-results>${resultsHtml()}</div>`}
      ${
        !query && !detail && !detailLoading
          ? `<section class="mu-group"><h3>${t('music.yourPlaylists')}</h3>${
              playlists?.length ? `<div class="mu-tiles">${playlists.slice(0, 12).map((x) => tile(x)).join('')}</div>` : `<p class="mu-hint">${t('music.noPlaylists')}</p>`
            }</section>`
          : ''
      }
      ${s.config?.assistant ? `<p class="mu-hint">${t('music.voiceHint')}</p>` : ''}
    </div>`;
}

/** What Spotify state the panel shows. The server publishes the player every 5–30 s; progress moves
 *  locally, so an update that changes none of this needs no re-render. */
let lastSig = '';
const viewSig = (s: AppState, m: SpotifyState | null) =>
  JSON.stringify([m?.item?.uri, m?.item?.image, m?.playing, m?.device?.name, m?.device?.volume, s.config?.language, !!s.config?.assistant]);

export function renderMusic(el: HTMLElement, s: AppState) {
  const m = music(s);
  // Re-rendering for nothing would close the tablet's keyboard, reset scrolling and drop taps.
  const sig = viewSig(s, m);
  if (!dirty && sig === lastSig && el.firstElementChild) return;
  dirty = false;
  lastSig = sig;
  const playingView = !!m?.item && !browse;
  // Keep the search box focused across re-renders (state updates arrive every few seconds).
  const focused = document.activeElement?.matches?.('[data-mu-search]');
  if (!playingView) {
    // Same dark backdrop as the player (the last song's artwork, if any), so text reads on any sky.
    el.innerHTML = `
      <div class="mu-backdrop">${m?.item?.image ? `<i style="background-image:url('${esc(m.item.image)}')"></i>` : ''}</div>
      <div class="panel-pad music np picker">
        <h1 class="panel-title">${t('music.title')}<span class="page-of">${t('music.startSomething')}</span>
          ${m?.item ? `<button class="chip mu-back" data-mu="nowplaying">${ICON.back}${t('music.nowPlaying')}</button>` : ''}</h1>
        ${pickerHtml(s, m)}
      </div>`;
    if (focused) {
      const input = el.querySelector<HTMLInputElement>('[data-mu-search]');
      input?.focus();
      input?.setSelectionRange(query.length, query.length);
    }
    return;
  }
  const it = m!.item!;
  loadLyrics(it);
  const lines = lyricsOn && lyrics?.uri === it.uri ? lyrics.data?.synced || null : null;
  const hasLyrics = lyrics?.uri === it.uri && !!lyrics.data?.synced;
  // Now playing: the artwork, blurred and darkened, fills the screen behind light text. With synced
  // lyrics, they take the artwork's place and follow the song.
  el.innerHTML = `
    <div class="mu-backdrop">${it.image ? `<i style="background-image:url('${esc(it.image)}')"></i>` : ''}</div>
    <div class="panel-pad music np">
      <h1 class="panel-title">${t('music.title')}${m!.device ? `<span class="page-of">${esc(t('music.on', { device: m!.device.name }))}</span>` : ''}
        <button class="chip mu-back" data-mu="browse">${ICON.search}${t('music.browse')}</button></h1>
      <div class="mu-body">
        ${
          lines
            ? `<div class="mu-lyrics"><div class="mu-lyrics-track" data-mu-lyrics>${lines.map((l) => `<p>${esc(l.text) || '♪'}</p>`).join('')}</div></div>`
            : `<div class="mu-art">${it.image ? `<img src="${esc(it.image)}" alt="">` : ''}</div>`
        }
        <div class="mu-info">
          ${lines && it.image ? `<img class="mu-mini-art" src="${esc(it.image)}" alt="">` : ''}
          <h2>${esc(it.name)}</h2>
          <p class="mu-by">${esc(it.by)}</p>
          ${it.album ? `<p class="mu-album">${esc(it.album)}</p>` : ''}
          <div class="mu-progress"><i data-mu-bar style="width:${it.durationMs ? (progressOf(m!) / it.durationMs) * 100 : 0}%"></i></div>
          <div class="mu-times"><span data-mu-pos>${mmss(progressOf(m!))}</span><span>${mmss(it.durationMs)}</span></div>
          <div class="mu-controls">
            <button data-mu="previous" aria-label="${esc(t('music.previous'))}">${ICON.prev}</button>
            <button class="mu-play" data-mu="toggle" aria-label="${esc(t(m!.playing ? 'music.pause' : 'music.play'))}">${m!.playing ? ICON.pause : ICON.play}</button>
            <button data-mu="next" aria-label="${esc(t('music.next'))}">${ICON.next}</button>
          </div>
          <div class="mu-row">
            ${m!.device?.volume != null ? `<button class="mu-small" data-mu="volume_down" aria-label="${esc(t('music.quieter'))}">${ICON.minus}</button><span class="mu-vol">${m!.device.volume}%</span><button class="mu-small" data-mu="volume_up" aria-label="${esc(t('music.louder'))}">${ICON.plus}</button>` : ''}
            <button class="mu-device" data-mu="devices">${ICON.speaker}${esc(m!.device?.name || t('music.devices'))}</button>
            ${hasLyrics ? `<button class="mu-device ${lyricsOn ? 'on' : ''}" data-mu="lyrics">${ICON.lyrics}${t('music.lyrics')}</button>` : ''}
          </div>
          ${
            showDevices && devices
              ? `<ul class="mu-devices">${devices.length ? devices.map((d) => `<li><button class="${d.active ? 'on' : ''}" data-mu="transfer" data-id="${esc(d.id)}">${esc(d.name)}</button></li>`).join('') : `<li class="set-hint">${t('music.noDevices')}</li>`}</ul>`
              : ''
          }
          ${s.config?.assistant ? `<p class="mu-hint">${t('music.voiceHint')}</p>` : ''}
          ${lines ? `<p class="mu-credit">${t('music.lyricsCredit')}</p>` : ''}
        </div>
      </div>
    </div>`;
  lyricLine = -1;
  syncLyrics(true);
}

// ─── Lyrics (LRCLIB, time-synced) ──────────────────────────
function loadLyrics(it: NonNullable<SpotifyState['item']>) {
  if (lyrics?.uri === it.uri || it.kind === 'episode' || !it.artist) return;
  const uri = it.uri;
  lyrics = { uri, data: null };
  const q = new URLSearchParams({ uri, track: it.name, artist: it.artist, album: it.album || '', duration: String(it.durationMs || '') });
  getJson<Lyrics>(`/api/spotify/lyrics?${q}`).then((data) => {
    if (lyrics?.uri !== uri) return;
    lyrics = { uri, data };
    if (data?.synced) rerender();
  });
}

let lyricLine = -1;
/** Highlights the line being sung and keeps it a little above the middle of the box. */
function syncLyrics(instant = false) {
  const track = document.querySelector<HTMLElement>('[data-mu-lyrics]');
  const m = music();
  const lines = lyrics?.data?.synced;
  if (!track || !m?.item || !lines || lyrics?.uri !== m.item.uri) return;
  // A little ahead: the screen catches up with polling and the eye reads before the voice sings.
  const pos = progressOf(m) + 350;
  let i = -1;
  while (i + 1 < lines.length && lines[i + 1].ms <= pos) i++;
  if (i === lyricLine && !instant) return;
  lyricLine = i;
  const rows = track.children;
  for (let k = 0; k < rows.length; k++) {
    rows[k].classList.toggle('on', k === i);
    rows[k].classList.toggle('past', k < i);
  }
  const row = rows[Math.max(0, i)] as HTMLElement | undefined;
  const box = track.parentElement!;
  if (!row) return;
  track.classList.toggle('instant', instant);
  track.style.transform = `translateY(${Math.round(box.clientHeight * 0.36 - row.offsetTop - row.offsetHeight / 2)}px)`;
}

// ─── Search (debounced; only the results area re-renders, so typing isn't interrupted) ──
let searchTimer: number | undefined;
function onSearch(input: HTMLInputElement) {
  query = input.value.trim();
  results = null;
  clearTimeout(searchTimer);
  const box = document.querySelector<HTMLElement>('[data-mu-results]');
  if (!query) return rerender();
  if (box) box.innerHTML = resultsHtml();
  searchTimer = window.setTimeout(async () => {
    const q = query;
    const r = await getJson<Results>(`/api/spotify/search?q=${encodeURIComponent(q)}`);
    if (q !== query) return;
    results = r || { tracks: [], artists: [], albums: [], playlists: [] };
    const b = document.querySelector<HTMLElement>('[data-mu-results]');
    if (b) b.innerHTML = resultsHtml();
    else rerender();
  }, 450);
}

// ─── Mini player (bottom right, every screen) ───────────────
let pill: HTMLElement;
let btn: HTMLButtonElement;
let lastPill = '';

function renderPill() {
  const m = music();
  btn.hidden = !connected();
  document.body.classList.toggle('has-spotify', connected());
  const show = recent(m) && document.body.dataset.panel !== 'music';
  document.body.classList.toggle('has-music', show);
  pill.hidden = !show;
  if (!show || !m?.item) return;
  const key = `${m.item.uri}|${m.playing}`;
  if (key === lastPill) return;
  lastPill = key;
  pill.innerHTML = `${m.item.image ? `<img src="${esc(m.item.image)}" alt="">` : ''}<div><b>${esc(m.item.name)}</b><small>${esc(m.item.by)}</small></div><button data-mu="toggle" aria-label="${esc(t(m.playing ? 'music.pause' : 'music.play'))}">${m.playing ? ICON.pause : ICON.play}</button>`;
}

/** Progress bars move every second between polls. */
function tick() {
  const m = music();
  if (!m?.item) return;
  for (const el of document.querySelectorAll<HTMLElement>('[data-mu-bar]')) el.style.width = `${m.item.durationMs ? (progressOf(m) / m.item.durationMs) * 100 : 0}%`;
  for (const el of document.querySelectorAll<HTMLElement>('[data-mu-pos]')) el.textContent = mmss(progressOf(m));
}

async function onClick(e: Event) {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-mu]');
  if (!el) {
    // Tap the mini player itself: go to the Music panel.
    if ((e.target as HTMLElement).closest('.music-pill')) window.dispatchEvent(new CustomEvent('dash:go', { detail: 'music' }));
    return;
  }
  e.stopPropagation();
  const a = el.dataset.mu!;
  switch (a) {
    case 'devices':
      showDevices = !showDevices;
      if (showDevices) devices = (await getJson<Device[]>('/api/spotify/devices')) || [];
      return rerender();
    case 'transfer':
      showDevices = false;
      return void control('transfer', { deviceId: el.dataset.id });
    case 'browse':
      browse = true;
      devices = null; // fresh device list
      return rerender();
    case 'nowplaying':
      browse = false;
      return rerender();
    case 'target':
      target = el.dataset.id || null;
      try {
        if (target) localStorage.setItem('dash:spotifyDevice', target);
      } catch {}
      return rerender();
    case 'play-uri':
      return startPlaying({ uri: el.dataset.uri }, el.dataset.name || '');
    case 'play-in': {
      // A song inside a page: the album/playlist continues from it; an artist's popular songs play in order.
      const from = el.dataset.uri!;
      const body = detail?.kind === 'artist' ? { uri: from, uris: (detail.tracks || []).map((x) => x.uri), from } : { uri: el.dataset.ctx, from };
      return startPlaying(body, el.dataset.name || '');
    }
    case 'play-ctx':
      if (!detail) return;
      return startPlaying({ uri: detail.uri, shuffle: el.dataset.shuffle === '1' }, detail.name);
    case 'open':
      return openDetail(el.dataset.uri!);
    case 'detail-back':
      return closeDetail();
    case 'lyrics':
      lyricsOn = !lyricsOn;
      try {
        localStorage.setItem('dash:lyrics', lyricsOn ? 'on' : 'off');
      } catch {}
      return rerender();
    default:
      el.classList.add('busy');
      await control(a).catch(() => {});
      // A command that changes nothing visible (volume already at max) gets no re-render to clear it.
      el.classList.remove('busy');
  }
}

async function startPlaying(body: Record<string, unknown>, name: string) {
  starting = name;
  pickError = '';
  rerender();
  const res = await post('/api/spotify/play', { ...body, deviceId: target, name });
  starting = '';
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    pickError = d.reason === 'PREMIUM_REQUIRED' ? t('music.premium') : d.error || t('music.failed');
    return rerender();
  }
  // Back to the playing view; the next poll fills it in.
  browse = false;
  query = '';
  results = null;
  detail = null;
  trail.length = 0;
  rerender();
}

export function initMusic() {
  pill = document.createElement('div');
  pill.className = 'music-pill';
  pill.hidden = true;
  btn = document.createElement('button');
  btn.className = 'music-btn';
  btn.hidden = true;
  btn.setAttribute('aria-label', t('music.title'));
  btn.innerHTML = ICON.note;
  document.body.append(pill, btn);
  pill.addEventListener('click', onClick);
  btn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('dash:go', { detail: 'music' })));
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.music [data-mu]')) onClick(e);
  });
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLElement;
    if (el.matches('[data-mu-search]')) onSearch(el as HTMLInputElement);
  });
  subscribe((_s, changed) => {
    if (changed === 'spotify' || changed === 'config') renderPill();
  });
  // The pill hides on the Music panel itself; leaving the panel closes the picker.
  new MutationObserver(() => {
    if (document.body.dataset.panel !== 'music') {
      browse = false;
      showDevices = false;
      detail = null;
      detailLoading = '';
      trail.length = 0;
      dirty = true;
    }
    renderPill();
  }).observe(document.body, { attributes: true, attributeFilter: ['data-panel'] });
  setInterval(tick, 1000);
  setInterval(() => syncLyrics(), 250);
  renderPill();
}
