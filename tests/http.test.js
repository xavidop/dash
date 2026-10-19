import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchText, pausedHosts, resetPauses } from '../server/lib/http.js';

beforeEach(() => resetPauses());

test('403/429 pauses the whole host instead of hammering it, then recovers', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => (calls++, new Response('no', { status: 403 })));
  await assert.rejects(() => fetchText('https://api.example.com/a'), /HTTP 403/);
  assert.equal(pausedHosts()[0].host, 'api.example.com');
  // Other URLs on the same host don't even go out while paused.
  await assert.rejects(() => fetchText('https://api.example.com/b'), /paused until/);
  assert.equal(calls, 1);
  assert.equal(warn.mock.callCount(), 1, 'logged once');
  // Another host is unaffected.
  t.mock.method(globalThis, 'fetch', async () => new Response('ok'));
  assert.equal(await fetchText('https://other.example.com/x'), 'ok');
});

test('Retry-After is respected', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('slow down', { status: 429, headers: { 'retry-after': '300' } }));
  await assert.rejects(() => fetchText('https://api.example.com/a'));
  const p = pausedHosts()[0];
  assert.ok(Math.abs(p.until - Date.now() - 300e3) < 2000);
});

test('network errors are retried once and explained', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  });
  await assert.rejects(() => fetchText('https://flaky.example.com/x'), /network error: ECONNRESET \(flaky\.example\.com\)/);
  assert.equal(calls, 2);
});

test('the same URL asked twice at the same moment is fetched once', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => (calls++, new Response('ok')));
  const [a, b] = await Promise.all([fetchText('https://api.example.com/s'), fetchText('https://api.example.com/s')]);
  assert.equal(a + b, 'okok');
  assert.equal(calls, 1);
  await fetchText('https://api.example.com/s'); // once finished, a new request goes out
  assert.equal(calls, 2);
});

test('refusals arriving together count once: the pause only doubles after it ran out', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('no', { status: 403 }));
  await Promise.allSettled(['a', 'b', 'c', 'd'].map((p) => fetchText(`https://burst.example.com/${p}`)));
  const p = pausedHosts().find((x) => x.host === 'burst.example.com');
  assert.ok(p.until - Date.now() <= 61e3, 'one minute, not doubled four times');
});

test('ESPN requests are spaced out instead of sent in a burst', async (t) => {
  const starts = [];
  t.mock.method(globalThis, 'fetch', async () => (starts.push(Date.now()), new Response('{}')));
  await Promise.all([1, 2, 3].map((i) => fetchText(`https://site.api.espn.com/x/${i}`)));
  assert.ok(starts[2] - starts[0] >= 1300, `3 requests took ${starts[2] - starts[0]} ms`);
});
