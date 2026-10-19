import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let SpotifyService, normalizePlayer, dir;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'dash-spotify-'));
  process.env.DASH_DATA_DIR = dir;
  ({ SpotifyService, normalizePlayer } = await import('../server/providers/spotify.js'));
});

const fakeStore = () => {
  const data = {};
  return { get: (k) => data[k], set: (k, v) => (data[k] = { data: v, updatedAt: Date.now(), error: null }) };
};
const json = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function make() {
  const store = fakeStore();
  const sp = new SpotifyService({ config: { port: 3000, features: { spotify: true }, spotify: { clientId: 'abc123' } }, store });
  sp.tokens = { access_token: 'tok', refresh_token: 'ref', expires_at: Date.now() + 3600e3, user: 'Alex' };
  return { sp, store };
}

/** Records Spotify API calls and answers them from a route table. */
function mockApi(t, routes) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    const u = new URL(url);
    const key = `${opts.method || 'GET'} ${u.pathname}`;
    calls.push({ key, query: Object.fromEntries(u.searchParams), body: opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : String(opts.body)) : null });
    const r = routes[key];
    return typeof r === 'function' ? r(u, opts, calls) : r ? r.clone() : json(null, 204);
  });
  return calls;
}

test('sign-in link: PKCE S256, loopback redirect, scopes, state', () => {
  const { sp } = make();
  const u = new URL(sp.loginUrl('http://localhost:3000/#settings'));
  assert.equal(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/api/spotify/callback');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.match(u.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(u.searchParams.get('scope'), /user-modify-playback-state/);
  assert.ok(sp.pending.has(u.searchParams.get('state')));
});

test('callback exchanges the code with the verifier and stores tokens on disk', async (t) => {
  const { sp } = make();
  sp.tokens = null;
  const u = new URL(sp.loginUrl('http://localhost:3000/#settings'));
  const calls = mockApi(t, {
    'POST /api/token': json({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }),
    'GET /v1/me': json({ id: 'u1', display_name: 'Alex' }),
    'GET /v1/me/player': json(null, 204),
  });
  const back = await sp.callback({ code: 'C', state: u.searchParams.get('state') });
  clearTimeout(sp.timer);
  assert.equal(back, 'http://localhost:3000/#settings');
  const tokenCall = calls.find((c) => c.key === 'POST /api/token');
  assert.match(tokenCall.body, /grant_type=authorization_code/);
  assert.match(tokenCall.body, /code_verifier=/);
  assert.equal(sp.tokens.user, 'Alex');
  assert.ok(existsSync(path.join(dir, 'spotify.json')));
  await assert.rejects(() => sp.callback({ code: 'C', state: 'forged' }), /expired/);
});

test('expired access token is refreshed, keeping the refresh token if none comes back', async (t) => {
  const { sp } = make();
  sp.tokens.expires_at = 0;
  mockApi(t, { 'POST /api/token': json({ access_token: 'NEW', expires_in: 3600 }) });
  assert.equal(await sp.accessToken(), 'NEW');
  assert.equal(sp.tokens.refresh_token, 'ref');
});

test('now playing is normalized for the screen', () => {
  const s = normalizePlayer({
    is_playing: true,
    progress_ms: 61000,
    shuffle_state: false,
    device: { name: 'Kitchen speaker', type: 'Speaker', volume_percent: 40, supports_volume: true },
    item: { name: 'Malamente', uri: 'spotify:track:1', duration_ms: 150000, artists: [{ name: 'Rosalía' }], album: { name: 'El Mal Querer', images: [{ url: 'big', width: 640 }, { url: 'small', width: 64 }] } },
  });
  assert.deepEqual([s.playing, s.item.name, s.item.by, s.item.image, s.device.volume], [true, 'Malamente', 'Rosalía', 'big', 40]);
  assert.equal(normalizePlayer(null), null);
});

test('"play Rosalía": an exact artist match plays the artist; your playlists win by name', async (t) => {
  const { sp } = make();
  const calls = mockApi(t, {
    'GET /v1/me/playlists': json({ items: [{ name: 'Discover Weekly', uri: 'spotify:playlist:dw' }] }),
    'GET /v1/search': json({ tracks: { items: [{ name: 'Despechá', uri: 'spotify:track:x', artists: [{ name: 'Rosalía' }] }] }, artists: { items: [{ name: 'Rosalía', uri: 'spotify:artist:r' }] }, playlists: { items: [] }, albums: { items: [] } }),
  });
  assert.deepEqual((await sp.play({ query: 'Rosalía' })).playing, { kind: 'artist', name: 'Rosalía', by: null });
  assert.deepEqual(calls.find((c) => c.key === 'PUT /v1/me/player/play').body, { context_uri: 'spotify:artist:r' });
  assert.equal(calls.find((c) => c.key === 'GET /v1/search').query.limit, '5', 'within the 10-result cap');
  assert.equal((await sp.play({ query: 'my Discover Weekly' })).playing.name, 'Discover Weekly');
  clearTimeout(sp.timer);
});

test('no active device: wakes the first available one and retries', async (t) => {
  const { sp } = make();
  let tries = 0;
  const calls = mockApi(t, {
    'GET /v1/me/playlists': json({ items: [] }),
    'GET /v1/search': json({ tracks: { items: [{ name: 'Song', uri: 'spotify:track:s', artists: [{ name: 'A' }] }] } }),
    'PUT /v1/me/player/play': () => (tries++ === 0 ? json({ error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }, 404) : json(null, 204)),
    'GET /v1/me/player/devices': json({ devices: [{ id: 'd1', name: 'Phone', type: 'Smartphone', is_active: false, supports_volume: true, volume_percent: 50 }] }),
  });
  await sp.play({ query: 'Song', kind: 'track' });
  clearTimeout(sp.timer);
  assert.equal(calls.filter((c) => c.key === 'PUT /v1/me/player/play').at(-1).query.device_id, 'd1');
});

test('ducking lowers the volume while the assistant talks, then restores it', async (t) => {
  const { sp, store } = make();
  store.set('spotify', { playing: true, item: { name: 'x' }, device: { name: 'Speaker', volume: 70 }, progressMs: 0, at: Date.now() });
  const calls = mockApi(t, {});
  await sp.duck(true);
  await sp.duck(true); // twice: no change
  await sp.duck(false);
  clearTimeout(sp.timer);
  assert.deepEqual(calls.filter((c) => c.key === 'PUT /v1/me/player/volume').map((c) => c.query.volume_percent), ['15', '70']);
  // A device without volume control is paused instead.
  store.set('spotify', { playing: true, item: { name: 'x' }, device: { name: 'TV', volume: null }, progressMs: 0, at: Date.now() });
  const calls2 = mockApi(t, {});
  await sp.duck(true);
  await sp.duck(false);
  clearTimeout(sp.timer);
  assert.deepEqual(calls2.map((c) => c.key), ['PUT /v1/me/player/pause', 'PUT /v1/me/player/play']);
});

test('nothing playing anywhere: the poll publishes null without throwing', async (t) => {
  const { sp, store } = make();
  const warn = t.mock.method(console, 'warn', () => {});
  mockApi(t, { 'GET /v1/me/player': json(null, 204) });
  await sp.refresh();
  clearTimeout(sp.timer);
  assert.equal(store.get('spotify').data, null);
  assert.equal(warn.mock.callCount(), 0);
});

test('picker: playlists and search are shaped for tiles; exact items play on the chosen speaker', async (t) => {
  const { sp } = make();
  const calls = mockApi(t, {
    'GET /v1/me/playlists': json({ items: [{ name: 'Cocina', uri: 'spotify:playlist:c1', images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }], owner: { display_name: 'Alex' }, items: { total: 40 } }, null] }),
    'GET /v1/search': json({ tracks: { items: [{ name: 'So What', uri: 'spotify:track:sw', artists: [{ name: 'Miles Davis' }], album: { images: [{ url: 'a64', width: 64 }] } }] }, artists: { items: [] }, albums: { items: [] }, playlists: { items: [null] } }),
  });
  assert.deepEqual(await sp.playlists(), [{ name: 'Cocina', uri: 'spotify:playlist:c1', image: 'mid', by: 'Alex', count: 40 }]);
  const r = await sp.search('miles');
  assert.deepEqual(r.tracks[0], { name: 'So What', by: 'Miles Davis', uri: 'spotify:track:sw', image: 'a64' });
  assert.equal(r.playlists.length, 0, 'null entries are skipped');
  await sp.playUri({ uri: 'spotify:playlist:c1', deviceId: 'kitchen', name: 'Cocina' });
  await sp.playUri({ uri: 'spotify:track:sw', deviceId: 'kitchen' });
  clearTimeout(sp.timer);
  const plays = calls.filter((c) => c.key === 'PUT /v1/me/player/play');
  assert.deepEqual(plays.map((c) => [c.query.device_id, c.body]), [
    ['kitchen', { context_uri: 'spotify:playlist:c1' }],
    ['kitchen', { uris: ['spotify:track:sw'] }],
  ]);
  await assert.rejects(() => sp.playUri({ uri: 'javascript:alert(1)' }), /not a Spotify item/);
});

test('pages: start a song inside an album, play an artist\'s popular songs in order, shuffle first', async (t) => {
  const { sp } = make();
  const calls = mockApi(t, { 'PUT /v1/me/player/play': json(null, 204), 'PUT /v1/me/player/shuffle': json(null, 204) });
  await sp.playUri({ uri: 'spotify:album:lux', from: 'spotify:track:t3', deviceId: 'k' });
  await sp.playUri({ uri: 'spotify:track:t2', uris: ['spotify:track:t1', 'spotify:track:t2', 'bad'], from: 'spotify:track:t2', deviceId: 'k' });
  await sp.playUri({ uri: 'spotify:artist:ro', shuffle: true, deviceId: 'k' });
  clearTimeout(sp.timer);
  const keys = calls.map((c) => c.key);
  assert.deepEqual(keys, ['PUT /v1/me/player/play', 'PUT /v1/me/player/play', 'PUT /v1/me/player/shuffle', 'PUT /v1/me/player/play']);
  assert.deepEqual(calls[0].body, { context_uri: 'spotify:album:lux', offset: { uri: 'spotify:track:t3' } });
  assert.deepEqual(calls[1].body, { uris: ['spotify:track:t1', 'spotify:track:t2'], offset: { uri: 'spotify:track:t2' } });
  assert.equal(calls[2].query.state, 'true');
  assert.deepEqual(calls[3].body, { context_uri: 'spotify:artist:ro' });
});
