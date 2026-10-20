import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { DATA_DIR } from '../lib/config.js';

// Spotify: what's playing on any of your devices, controls, and "play …" for the assistant.
//
// - Each install registers its own Spotify app (developer.spotify.com, free) and sets its Client ID.
//   Spotify requires the app owner to have Premium, and allows up to 5 users per app.
// - Sign-in is OAuth "authorization code with PKCE" (no client secret). Spotify only accepts plain
//   http redirects on 127.0.0.1, so sign-in happens on the display itself at http://127.0.0.1:<port>.
// - Tokens live in data/spotify.json (not in backups: they're credentials for this device).

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPES = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-read-private', 'user-library-read'];
const TOKEN_FILE = () => path.join(DATA_DIR, 'spotify.json');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export class SpotifyError extends Error {
  constructor(message, status = 500, reason = null) {
    super(message);
    this.status = status;
    this.reason = reason; // e.g. NO_ACTIVE_DEVICE, PREMIUM_REQUIRED
  }
}

export class SpotifyService {
  constructor({ config, store, country = () => null }) {
    this.config = config;
    this.country = country;
    this.store = store;
    this.pending = new Map(); // state → { verifier, returnTo, at }
    this.tokens = this.load();
    this.ducked = null; // { volume, paused } while the assistant talks
    this.timer = null;
  }

  get clientId() {
    return process.env.SPOTIFY_CLIENT_ID || this.config.spotify?.clientId || '';
  }

  get enabled() {
    return !!this.clientId && this.config.features.spotify !== false;
  }

  get connected() {
    return !!this.tokens?.refresh_token;
  }

  redirectUri() {
    return `http://127.0.0.1:${this.config.port}/api/spotify/callback`;
  }

  load() {
    try {
      return existsSync(TOKEN_FILE()) ? JSON.parse(readFileSync(TOKEN_FILE(), 'utf8')) : null;
    } catch {
      return null;
    }
  }

  saveTokens(t) {
    this.tokens = t;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(TOKEN_FILE(), JSON.stringify(t, null, 2), { mode: 0o600 });
  }

  // ── Sign-in (PKCE) ──
  loginUrl(returnTo) {
    if (!this.enabled) throw new SpotifyError('Spotify is not configured', 404);
    const verifier = b64url(randomBytes(48));
    const state = b64url(randomBytes(16));
    for (const [k, v] of this.pending) if (Date.now() - v.at > 15 * 60e3) this.pending.delete(k);
    this.pending.set(state, { verifier, returnTo, at: Date.now() });
    const q = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      scope: SCOPES.join(' '),
      state,
    });
    return `${ACCOUNTS}/authorize?${q}`;
  }

  async callback({ code, state, error }) {
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (error) throw new SpotifyError(`Spotify said: ${error}`, 400);
    if (!p || !code) throw new SpotifyError('sign-in expired, try again', 400);
    const t = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri(), code_verifier: p.verifier });
    this.saveTokens(t);
    try {
      const me = await this.api('GET', '/me');
      this.saveTokens({ ...this.tokens, user: me.display_name || me.id });
    } catch {}
    this.refresh();
    return p.returnTo;
  }

  async tokenRequest(params) {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, ...params }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await res.json().catch(() => ({}));
    // Only invalid_grant means the sign-in is gone; any other failure is worth retrying later.
    if (!res.ok) throw new SpotifyError(d.error_description || d.error || `token HTTP ${res.status}`, d.error === 'invalid_grant' ? 401 : 502);
    // PKCE refresh may or may not rotate the refresh token: keep the old one if none comes back.
    return { ...this.tokens, ...d, refresh_token: d.refresh_token || this.tokens?.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000 - 60e3 };
  }

  async accessToken() {
    if (!this.connected) throw new SpotifyError('Spotify is not connected', 401);
    if (Date.now() < (this.tokens.expires_at || 0)) return this.tokens.access_token;
    // One refresh at a time: Spotify rotates the refresh token, so a second concurrent refresh
    // (the poll plus a command) would be refused with invalid_grant and sign us out.
    this.refreshing ??= this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token })
      .then((t) => this.saveTokens(t))
      .catch((err) => {
        // A revoked or expired sign-in: forget it so Settings offers "Connect" again.
        if (err.status === 401) {
          this.logout();
          this.onLogout?.();
        }
        throw err;
      })
      .finally(() => {
        this.refreshing = null;
      });
    await this.refreshing;
    return this.tokens.access_token;
  }

  logout() {
    this.tokens = null;
    try {
      unlinkSync(TOKEN_FILE());
    } catch {}
    this.publish(null);
  }

  async api(method, url, body, retried = false) {
    const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    // Access token rejected before its expiry: get a new one and try once more.
    if (res.status === 401 && !retried && this.tokens) {
      this.tokens.expires_at = 0;
      return this.api(method, url, body, true);
    }
    if (res.status === 429) this.backoffUntil = Date.now() + (Number(res.headers.get('retry-after')) || 30) * 1000;
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    const d = text ? JSON.parse(text) : null;
    if (!res.ok) throw new SpotifyError(d?.error?.message || `Spotify HTTP ${res.status}`, res.status, d?.error?.reason || null);
    return d;
  }

  // ── Now playing (polled; faster while music plays) ──
  publish(state) {
    this.store.set('spotify', state);
  }

  async refresh() {
    clearTimeout(this.timer);
    let next = 30e3;
    // Rate-limited: wait out Spotify's Retry-After instead of polling into a longer ban.
    if (this.backoffUntil > Date.now()) next = Math.max(next, this.backoffUntil - Date.now());
    else if (this.enabled && this.connected) {
      try {
        const p = await this.api('GET', '/me/player?additional_types=episode');
        // null when nothing is playing on any device (Spotify answers 204 with no body).
        const state = normalizePlayer(p, this.tokens.user);
        this.publish(state);
        if (state?.playing) next = 5e3;
      } catch (err) {
        if (err.status !== 401) console.warn('[spotify]', err.message);
      }
    }
    this.timer = setTimeout(() => this.refresh(), next);
    this.timer.unref?.();
  }

  /** Re-poll soon after a command so the screen catches up. */
  soon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 700);
  }

  async devices() {
    const d = await this.api('GET', '/me/player/devices');
    return (d?.devices || []).map((x) => ({ id: x.id, name: x.name, type: x.type, active: x.is_active, volume: x.supports_volume ? x.volume_percent : null }));
  }

  /** Finds a device by (part of) its name. */
  async deviceByName(name) {
    if (!name) return null;
    const want = String(name).toLowerCase();
    const list = await this.devices();
    return list.find((d) => d.name.toLowerCase() === want) || list.find((d) => d.name.toLowerCase().includes(want) || want.includes(d.name.toLowerCase())) || null;
  }

  async control(action, { volume, device, deviceId } = {}) {
    const q = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    const now = this.store.get('spotify')?.data;
    switch (action) {
      case 'play':
        await this.api('PUT', `/me/player/play${q}`);
        break;
      case 'pause':
        await this.api('PUT', '/me/player/pause');
        break;
      case 'toggle':
        await this.api('PUT', now?.playing ? '/me/player/pause' : '/me/player/play');
        break;
      case 'next':
        await this.api('POST', '/me/player/next');
        break;
      case 'previous':
        await this.api('POST', '/me/player/previous');
        break;
      case 'volume': {
        const v = Math.max(0, Math.min(100, Math.round(Number(volume))));
        await this.api('PUT', `/me/player/volume?volume_percent=${v}`);
        break;
      }
      case 'volume_up':
      case 'volume_down': {
        const cur = now?.device?.volume ?? 50;
        await this.api('PUT', `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, cur + (action === 'volume_up' ? 15 : -15)))}`);
        break;
      }
      case 'shuffle':
        await this.api('PUT', `/me/player/shuffle?state=${!now?.shuffle}`);
        break;
      case 'transfer': {
        const d = deviceId ? { id: deviceId } : await this.deviceByName(device);
        if (!d) throw new SpotifyError(`no device called "${device}"`, 404);
        await this.api('PUT', '/me/player', { device_ids: [d.id], play: true });
        break;
      }
      default:
        throw new SpotifyError(`unknown action ${action}`, 400);
    }
    this.soon();
    return { ok: true };
  }

  /**
   * "play some jazz", "play Rosalía", "play my Discover Weekly": search and play the best match.
   * kind: track | artist | album | playlist (default: guess from the results).
   */
  async play({ query, kind, device }) {
    const q = String(query || '').trim();
    if (!q) throw new SpotifyError('what should I play?', 400);
    const d = device ? await this.deviceByName(device) : null;
    if (device && !d) throw new SpotifyError(`no device called "${device}"`, 404);
    const qs = d ? `?device_id=${encodeURIComponent(d.id)}` : '';

    // Your own playlists first ("my running playlist", "Discover Weekly").
    if (!kind || kind === 'playlist') {
      const mine = await this.api('GET', '/me/playlists?limit=50').catch(() => null);
      const want = q.toLowerCase().replace(/^(my|mi|ma|mein|meine|la mia|minha)\s+/, '');
      const hit = (mine?.items || []).find((p) => p?.name?.toLowerCase() === want) || (mine?.items || []).find((p) => p?.name?.toLowerCase().includes(want));
      if (hit) return this.start({ context_uri: hit.uri }, qs, { kind: 'playlist', name: hit.name });
    }
    const types = kind ? [kind] : ['track', 'artist', 'playlist', 'album'];
    const res = await this.api('GET', `/search?${new URLSearchParams({ q, type: types.join(','), limit: '5' })}`);
    const first = (t) => (res?.[`${t}s`]?.items || []).filter(Boolean)[0];
    let pick;
    if (kind) pick = { kind, item: first(kind) };
    else {
      // An artist whose name matches the query beats a song that merely contains the words.
      const artist = first('artist');
      if (artist && artist.name.toLowerCase() === q.toLowerCase()) pick = { kind: 'artist', item: artist };
      else if (first('track')) pick = { kind: 'track', item: first('track') };
      else pick = ['playlist', 'album', 'artist'].map((k) => ({ kind: k, item: first(k) })).find((x) => x.item);
    }
    if (!pick?.item) throw new SpotifyError(`nothing found for "${q}"`, 404);
    const body = pick.kind === 'track' ? { uris: [pick.item.uri] } : { context_uri: pick.item.uri };
    const by = pick.kind === 'track' || pick.kind === 'album' ? pick.item.artists?.map((a) => a.name).join(', ') : null;
    return this.start(body, qs, { kind: pick.kind, name: pick.item.name, by });
  }

  /** Your playlists for the picker (cached for a few minutes). */
  async playlists() {
    if (this.playlistCache && Date.now() - this.playlistCache.at < 5 * 60e3) return this.playlistCache.list;
    const d = await this.api('GET', '/me/playlists?limit=50');
    const list = (d?.items || [])
      .filter(Boolean)
      .map((p) => ({ name: p.name, uri: p.uri, image: pickImage(p.images, 300), by: p.owner?.display_name || null, count: p.items?.total ?? p.tracks?.total ?? null }));
    this.playlistCache = { at: Date.now(), list };
    return list;
  }

  /** Search for the picker: a few of each kind (Spotify caps search at 10 per type). */
  async search(q) {
    const query = String(q || '').trim().slice(0, 100);
    if (!query) return { tracks: [], artists: [], albums: [], playlists: [], shows: [] };
    const find = (type) => this.api('GET', `/search?${new URLSearchParams({ q: query, type, limit: '6' })}`);
    // Podcasts may need more permissions on some accounts: without them, search the music only.
    const d = await find('track,artist,album,playlist,show').catch((err) => (/scope/i.test(err.message) ? find('track,artist,album,playlist') : Promise.reject(err)));
    const items = (k) => (d?.[k]?.items || []).filter(Boolean);
    return {
      tracks: items('tracks').map((x) => ({ name: x.name, by: x.artists?.map((a) => a.name).join(', ') || '', uri: x.uri, image: pickImage(x.album?.images, 64) })),
      artists: items('artists').map((x) => ({ name: x.name, uri: x.uri, image: pickImage(x.images, 300) })),
      albums: items('albums').map((x) => ({ name: x.name, by: x.artists?.map((a) => a.name).join(', ') || '', uri: x.uri, image: pickImage(x.images, 300) })),
      playlists: items('playlists').map((x) => ({ name: x.name, by: x.owner?.display_name || null, uri: x.uri, image: pickImage(x.images, 300) })),
      shows: items('shows').map((x) => ({ name: x.name, by: x.publisher || null, uri: x.uri, image: pickImage(x.images, 300) })),
    };
  }

  /**
   * What's inside an artist, album, playlist or podcast, for the browser: header info plus its songs
   * (an artist's popular songs and albums; a podcast's latest episodes). Parts Spotify refuses
   * (some endpoints are closed to development-mode apps) are left empty instead of failing.
   */
  async details(uri) {
    const m = String(uri).match(/^spotify:(artist|album|playlist|show):([A-Za-z0-9]+)$/);
    if (!m) throw new SpotifyError('not a Spotify item', 400);
    const [, kind, id] = m;
    // An explicit market: "from_token" needs a permission Dash doesn't ask for.
    const market = `market=${this.country() || String(this.config.locale || '').split('-')[1] || 'US'}`;
    const soft = (url) => this.api('GET', url).catch(() => null);
    const names = (list) => (list || []).map((a) => a.name).join(', ');
    const song = (x, image) => (x?.uri ? { name: x.name, by: names(x.artists), uri: x.uri, durationMs: x.duration_ms || 0, image: image ?? pickImage(x.album?.images, 64) } : null);

    if (kind === 'artist') {
      const [a, top, albums] = await Promise.all([this.api('GET', `/artists/${id}`), soft(`/artists/${id}/top-tracks?${market}`), soft(`/artists/${id}/albums?include_groups=album,single&limit=10&${market}`)]);
      let tracks = (top?.tracks || []).map((x) => song(x)).filter(Boolean);
      if (!tracks.length) {
        // No top-tracks access: the artist's best search hits instead.
        const found = await soft(`/search?${new URLSearchParams({ q: `artist:"${a.name}"`, type: 'track', limit: '10', market: market.slice('market='.length) })}`);
        tracks = (found?.tracks?.items || []).filter((x) => x?.artists?.some((y) => y.id === id)).map((x) => song(x)).filter(Boolean);
      }
      const seen = new Set();
      const list = (albums?.items || []).filter((x) => x && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase()));
      return {
        kind,
        uri,
        name: a.name,
        image: pickImage(a.images, 300),
        followers: a.followers?.total ?? null,
        genres: (a.genres || []).slice(0, 3),
        tracks: tracks.slice(0, 10),
        albums: list.map((x) => ({ name: x.name, by: [x.release_date?.slice(0, 4), x.album_type === 'single' ? 'single' : null].filter(Boolean).join(' · '), uri: x.uri, image: pickImage(x.images, 300) })),
      };
    }
    if (kind === 'album') {
      const a = await this.api('GET', `/albums/${id}?${market}`);
      const img = pickImage(a.images, 64);
      return {
        kind,
        uri,
        name: a.name,
        image: pickImage(a.images, 300),
        by: names(a.artists),
        artistUri: a.artists?.[0]?.uri || null,
        year: a.release_date?.slice(0, 4) || null,
        total: a.total_tracks ?? null,
        tracks: (a.tracks?.items || []).map((x) => song(x, img)).filter(Boolean),
      };
    }
    if (kind === 'playlist') {
      const p = await this.api('GET', `/playlists/${id}?${market}`);
      // 2026 API: songs moved from `tracks[].track` to `items[].item`; both shapes are read.
      let rows = p.items?.items || p.tracks?.items;
      if (!rows) rows = (await soft(`/playlists/${id}/items?limit=50&${market}`))?.items || [];
      return {
        kind,
        uri,
        name: p.name,
        image: pickImage(p.images, 300),
        by: p.owner?.display_name || null,
        total: p.items?.total ?? p.tracks?.total ?? null,
        description: String(p.description || '').replace(/<[^>]+>/g, '').slice(0, 200) || null,
        tracks: rows
          .map((r) => song(r?.item || r?.track))
          .filter(Boolean)
          .slice(0, 50),
        // Development-mode apps only see the songs of your own playlists; others still play.
        restricted: !rows.length,
      };
    }
    const show = await this.api('GET', `/shows/${id}?${market}`);
    // The show's own list can be short; the episodes endpoint has the latest ones (10 at most in 2026).
    let eps = show.episodes?.items || [];
    if (eps.length < 10) eps = (await soft(`/shows/${id}/episodes?limit=10&${market}`))?.items || eps;
    return {
      kind,
      uri,
      name: show.name,
      image: pickImage(show.images, 300),
      by: show.publisher || null,
      description: String(show.description || '').slice(0, 220) || null,
      episodes: eps
        .filter(Boolean)
        .slice(0, 20)
        .map((e) => ({ name: e.name, uri: e.uri, durationMs: e.duration_ms || 0, date: e.release_date || null, image: pickImage(e.images, 64) })),
    };
  }

  /**
   * Plays an exact item from the picker on a device: a song or episode, a whole album/artist/
   * playlist/podcast, or one song inside it (`from`: the song to start at, so the rest follows).
   * `uris`: a list to play in order (an artist's popular songs). `shuffle`: true/false to set it.
   */
  async playUri({ uri, deviceId, name, from, uris, shuffle }) {
    const valid = (u) => /^spotify:(track|album|artist|playlist|show|episode):[A-Za-z0-9]+$/.test(String(u));
    if (!valid(uri) || (from && !valid(from))) throw new SpotifyError('not a Spotify item', 400);
    const list = Array.isArray(uris) ? uris.filter(valid).slice(0, 50) : null;
    let body;
    if (list?.length) body = { uris: list, ...(from && list.includes(from) ? { offset: { uri: from } } : {}) };
    else if (/^spotify:(track|episode):/.test(uri)) body = { uris: [uri] };
    else body = { context_uri: uri, ...(from && !/^spotify:(artist|show):/.test(uri) ? { offset: { uri: from } } : {}) };
    const dq = deviceId ? `device_id=${encodeURIComponent(deviceId)}` : '';
    const setShuffle = () => (typeof shuffle === 'boolean' ? this.api('PUT', `/me/player/shuffle?state=${shuffle}${dq ? `&${dq}` : ''}`) : Promise.resolve());
    // Shuffle first so the first song is already random; if no device is awake yet, set it after.
    const early = await setShuffle().then(() => true, () => false);
    const out = await this.start(body, dq ? `?${dq}` : '', { kind: uri.split(':')[1], name: name || null });
    if (!early) await setShuffle().catch(() => {});
    return out;
  }

  async start(body, qs, what) {
    try {
      await this.api('PUT', `/me/player/play${qs}`, body);
    } catch (err) {
      // Nothing active: wake the last-used device (or the first one) and try again.
      if (err.reason !== 'NO_ACTIVE_DEVICE' && err.status !== 404) throw err;
      const list = await this.devices();
      const target = list.find((x) => x.active) || list[0];
      if (!target) throw new SpotifyError('no Spotify device is on: open Spotify on a phone, computer or speaker first', 404, 'NO_ACTIVE_DEVICE');
      await this.api('PUT', `/me/player/play?device_id=${encodeURIComponent(target.id)}`, body);
    }
    this.soon();
    return { playing: what };
  }

  /** Lowers the music while the assistant talks, and puts it back afterwards. */
  async duck(on) {
    if (!this.connected) return;
    const now = this.store.get('spotify')?.data;
    try {
      if (on && !this.ducked && now?.playing) {
        if (now.device?.volume != null && now.device.volume > 20) {
          this.ducked = { volume: now.device.volume };
          await this.api('PUT', '/me/player/volume?volume_percent=15');
        } else {
          this.ducked = { paused: true };
          await this.api('PUT', '/me/player/pause');
        }
      } else if (!on && this.ducked) {
        const d = this.ducked;
        this.ducked = null;
        if (d.volume != null) await this.api('PUT', `/me/player/volume?volume_percent=${d.volume}`);
        else if (d.paused) await this.api('PUT', '/me/player/play');
      }
    } catch (err) {
      this.ducked = on ? this.ducked : null;
      console.warn('[spotify] duck', err.message);
    }
    this.soon();
  }
}

/** The /me/player response → what the screen shows. null = nothing playing anywhere. */
export function normalizePlayer(p, user = null) {
  if (!p || !p.item) return p?.device ? { user, playing: false, item: null, device: dev(p.device), progressMs: 0, at: Date.now() } : null;
  const it = p.item;
  const images = it.album?.images || it.images || it.show?.images || [];
  return {
    user,
    playing: !!p.is_playing,
    progressMs: p.progress_ms || 0,
    at: Date.now(),
    shuffle: !!p.shuffle_state,
    item: {
      name: it.name,
      by: it.artists ? it.artists.map((a) => a.name).join(', ') : it.show?.name || '',
      album: it.album?.name || null,
      image: (images.find((i) => i.width && i.width >= 300 && i.width <= 700) || images[0])?.url || null,
      durationMs: it.duration_ms || 0,
      uri: it.uri,
      kind: it.type === 'episode' ? 'episode' : 'track',
      artist: it.artists?.[0]?.name || null,
    },
    device: dev(p.device),
  };
}

/** The image closest to `size` px (Spotify lists several sizes). */
function pickImage(images, size) {
  const list = (images || []).filter((i) => i?.url);
  if (!list.length) return null;
  return [...list].sort((a, b) => Math.abs((a.width || size) - size) - Math.abs((b.width || size) - size))[0].url;
}

const dev = (d) => (d ? { name: d.name, type: d.type, volume: d.supports_volume === false ? null : d.volume_percent } : null);
