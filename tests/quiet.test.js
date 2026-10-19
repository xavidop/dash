import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FavoritesService } from '../server/services/favorites.js';
import { EspnProvider } from '../server/providers/sports/espn.js';
import { LiveTracker } from '../server/services/live.js';

const H = 3600e3;
const game = (state, startOffset) => ({ state, start: new Date(Date.now() + startOffset).toISOString() });

test('team cards are reused on quiet days, refreshed around games', () => {
  const now = Date.now();
  const card = (o) => ({ refreshedAt: now - 30 * 60e3, next: game('pre', 3 * 24 * H), last: game('final', -2 * 24 * H), ...o });
  assert.equal(FavoritesService.quiet(card()), true, 'next game in 3 days, refreshed 30 min ago');
  assert.equal(FavoritesService.quiet(card({ next: game('pre', 5 * H) })), false, 'game within 24 h');
  assert.equal(FavoritesService.quiet(card({ next: game('live', -H) })), false, 'live now');
  assert.equal(FavoritesService.quiet(card({ refreshedAt: now - 3 * H })), false, 'older than 2 h');
  assert.equal(FavoritesService.quiet(card({ last: game('final', -4 * H), refreshedAt: now - 1.5 * H })), false, 'a game ended after the last refresh');
  assert.equal(FavoritesService.quiet({}), false, 'never refreshed');
});

test('ESPN calendar: next match day; days without games need no request', async (t) => {
  const espn = new EspnProvider();
  const day = (offset) => new Date(Date.now() + offset * 24 * H).toISOString().slice(0, 10);
  espn.rememberCalendar('esp.1', { leagues: [{ calendar: [`${day(-2)}T07:00Z`, `${day(3)}T07:00Z`] }] });
  const next = espn.nextMatchDay('esp.1');
  assert.equal(new Date(next).toISOString().slice(0, 10), day(3));
  assert.equal(espn.nextMatchDay('eng.1'), undefined, 'unknown calendar');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => (calls++, new Response('{}')));
  assert.deepEqual(await espn.scoreboardForDay('esp.1', day(1).replaceAll('-', '')), []);
  assert.equal(calls, 0);
});

test('a finished past day is fetched once', async (t) => {
  const espn = new EspnProvider();
  espn.localize = async (_s, g) => g;
  const ymd = new Date(Date.now() - 2 * 24 * H).toISOString().slice(0, 10).replaceAll('-', '');
  let calls = 0;
  const ev = { id: '1', date: new Date(Date.now() - 2 * 24 * H).toISOString(), status: { type: { state: 'post', completed: true } }, competitions: [{ competitors: [{ homeAway: 'home', team: { id: 'a', displayName: 'A' }, score: '1' }, { homeAway: 'away', team: { id: 'b', displayName: 'B' }, score: '0' }] }] };
  t.mock.method(globalThis, 'fetch', async () => (calls++, new Response(JSON.stringify({ events: [ev] }))));
  const a = await espn.scoreboardForDay('esp.1', ymd);
  const b = await espn.scoreboardForDay('esp.1', ymd);
  assert.equal(calls, 1);
  assert.equal(a.length, b.length);
});

test('live poller: a quiet competition sleeps until its next game or match day (max 6 h)', () => {
  const tracker = Object.create(LiveTracker.prototype);
  const idle = 10 * 60e3;
  const provider = { nextMatchDay: () => Date.now() + 2 * 24 * H };
  assert.equal(tracker.quietFor(provider, 'x', [], idle), 6 * H, 'next match day in 2 days → capped at 6 h');
  const soon = tracker.quietFor(provider, 'x', [game('pre', 3 * H)], idle);
  assert.ok(Math.abs(soon - (3 * H - 10 * 60e3)) < 1000, 'wakes 10 min before kickoff');
  assert.equal(tracker.quietFor({}, 'x', [], idle), idle, 'no information → normal interval');
  assert.equal(tracker.quietFor({ nextMatchDay: () => null }, 'x', [], idle), 6 * H, 'nothing scheduled → every 6 h');
});

test('an empty card is never reused as "quiet"', () => {
  assert.equal(FavoritesService.quiet({ refreshedAt: Date.now() - 60e3, competitions: [] }), false);
});

test('live poller: a game past its kickoff but not live yet keeps the league awake', () => {
  const tracker = Object.create(LiveTracker.prototype);
  const idle = 60e3;
  const provider = { nextMatchDay: () => Date.now() + 6 * 24 * H };
  // Sevilla–Madrid at 21:00; at 21:01 the source still says "scheduled": don't sleep until next week.
  assert.equal(tracker.quietFor(provider, 'esp.1', [game('final', -5 * H), game('pre', -60e3)], idle), idle);
  // A game "scheduled" from a day ago (postponed, never updated) doesn't keep it awake forever.
  assert.equal(tracker.quietFor(provider, 'esp.1', [game('pre', -24 * H)], idle), 6 * H);
});
