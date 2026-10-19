import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLastNext, windowRows, norm } from '../server/providers/sports/provider.js';

const g = (id, start, state) => ({ id, start, state });

test('last = most recent final, next = live first, then the soonest upcoming', () => {
  const now = Date.parse('2026-10-16T12:00Z');
  const games = [g('a', '2026-10-01T12:00Z', 'final'), g('b', '2026-10-10T12:00Z', 'final'), g('c', '2026-10-20T12:00Z', 'pre'), g('d', '2026-10-18T12:00Z', 'pre')];
  const r = pickLastNext(games, now);
  assert.equal(r.last.id, 'b');
  assert.equal(r.next.id, 'd');
  assert.equal(pickLastNext([...games, g('e', '2026-10-16T11:00Z', 'live')], now).next.id, 'e');
});

test('standings window is centred on my team', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, me: i === 18 }));
  assert.deepEqual(windowRows(rows, 5).map((r) => r.rank), [16, 17, 18, 19, 20]);
  rows[18].me = false;
  rows[0].me = true;
  assert.deepEqual(windowRows(rows, 5).map((r) => r.rank), [1, 2, 3, 4, 5]);
});

test('names are normalized for matching (accents, punctuation, case)', () => {
  assert.equal(norm('Atlético  de Madrid!'), 'atletico de madrid');
  assert.equal(norm('España'), 'espana');
});
