import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BracketService } from '../server/services/brackets.js';
import { setLanguage } from '../server/lib/i18n.js';

setLanguage('en');
const comp = (id, name, extra = {}) => ({ team: { id, shortDisplayName: name, abbreviation: name.slice(0, 3).toUpperCase() }, ...extra });

test('NBA/NHL/NFL: playoff games become series, rounds from the notes, exhibitions dropped', async () => {
  const game = (date, headline, a, b, series, state = 'post') => ({
    date,
    season: { type: 3 },
    status: { type: { state } },
    competitions: [{ notes: [{ headline }], competitors: [comp(a.id, a.name), comp(b.id, b.name)], series }],
  });
  const tor = { id: '28', name: 'Raptors' };
  const cle = { id: '5', name: 'Cavaliers' };
  const nyk = { id: '18', name: 'Knicks' };
  const sr = (wa, wb, done) => ({ type: 'playoff', summary: `series ${wa}-${wb}`, completed: done, competitors: [{ id: '28', wins: wa }, { id: '5', wins: wb }] });
  const svc = new BracketService({});
  svc.espnEvents = async () => [
    game('2026-04-18T23:00Z', 'East 1st Round - Game 1', tor, cle, sr(1, 0, false)),
    game('2026-05-02T23:00Z', 'East 1st Round - Game 7', tor, cle, { ...sr(3, 4, true), competitors: [{ id: '28', wins: 3 }, { id: '5', wins: 4, winner: true }] }),
    game('2026-05-10T23:00Z', 'East Semifinals - Game 1', cle, nyk, { type: 'playoff', summary: 'NY leads 1-0', competitors: [{ id: '5', wins: 0 }, { id: '18', wins: 1 }] }),
    { ...game('2026-02-01T23:00Z', 'Pro Bowl Games', tor, nyk), season: { type: 3 } },
  ];
  const b = await svc.espnSeries('nba');
  assert.deepEqual(b.rounds.map((r) => r.name), ['1st Round', 'Semifinals']);
  const first = b.rounds[0].matchups[0];
  assert.equal(first.conf, 'East');
  assert.deepEqual([first.a.name, first.a.wins, first.b.name, first.b.wins], ['Raptors', 3, 'Cavaliers', 4]);
  assert.equal(first.winner, 'b');
  assert.equal(b.rounds[1].matchups[0].winner, null, 'series still on');
});

test('Champions League: two legs add up to an aggregate; the side that goes through is marked', async () => {
  const leg = (date, slug, home, away, hs, as, series) => ({
    date,
    season: { slug },
    status: { type: { state: 'post' } },
    competitions: [{ competitors: [comp(home.id, home.name, { score: String(hs) }), comp(away.id, away.name, { score: String(as) })], series }],
  });
  const liv = { id: '364', name: 'Liverpool' };
  const gal = { id: '432', name: 'Galatasaray' };
  const svc = new BracketService({});
  svc.espnEvents = async () => [
    leg('2026-03-10T20:00Z', 'round-of-16', gal, liv, 1, 0, { competitors: [{ id: '432' }, { id: '364' }] }),
    leg('2026-03-17T20:00Z', 'round-of-16', liv, gal, 4, 0, { competitors: [{ id: '364', winner: true }, { id: '432' }] }),
    { ...leg('2026-03-01T20:00Z', 'league-phase', liv, gal, 2, 2), season: { slug: 'league-phase' } },
  ];
  const b = await svc.knockouts('uefa.champions');
  assert.deepEqual(b.rounds.map((r) => r.name), ['Round of 16']);
  const tie = b.rounds[0].matchups[0];
  const lv = tie.a.name === 'Liverpool' ? tie.a : tie.b;
  const gs = lv === tie.a ? tie.b : tie.a;
  assert.deepEqual([lv.score, gs.score], [4, 1]);
  assert.equal(tie.winner === 'a' ? tie.a.name : tie.b.name, 'Liverpool');
  assert.equal(tie.summary, 'Liverpool through');
});

test('which competitions can have a bracket, and when', () => {
  const svc = new BracketService({ followed: () => ['nba', 'mlb', 'esp.1', 'fifa.friendly'], homes: () => ['uefa.champions', 'esp.copa_del_rey'] });
  // October: MLB postseason; cups are always candidates (their calendar decides); leagues and friendlies never.
  assert.deepEqual(svc.leagues(new Date('2026-10-18T12:00Z')).sort(), ['esp.copa_del_rey', 'mlb', 'uefa.champions']);
  assert.deepEqual(svc.leagues(new Date('2026-05-10T12:00Z')).sort(), ['esp.copa_del_rey', 'nba', 'uefa.champions']);
});

test('brackets fit the screen: no huge or leftover leading rounds, at most 5 columns', async () => {
  const { trim } = await import('../server/services/brackets.js');
  const r = (name, n) => ({ name, matchups: Array.from({ length: n }, (_, i) => ({ id: `${name}${i}` })) });
  const names = (b) => trim({ rounds: b }).rounds.map((x) => x.name);
  assert.deepEqual(names([r('R32', 1), r('R16', 8), r('QF', 4), r('SF', 2), r('F', 1)]), ['R16', 'QF', 'SF', 'F']);
  assert.deepEqual(names([r('3rd', 32), r('4th', 16), r('5th', 8), r('QF', 4), r('SF', 2), r('F', 1)]), ['5th', 'QF', 'SF', 'F']);
  assert.deepEqual(names([r('a', 8), r('b', 8), r('c', 4), r('d', 2), r('e', 1), r('f', 1)]), ['b', 'c', 'd', 'e', 'f']);
});

test('cups: a bracket is checked only when a match day is within 3 days', async () => {
  const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10).replaceAll('-', '');
  const svc = new BracketService({ providers: { espn: { matchDays: () => new Set([day(-12), day(2)]) } } });
  assert.equal(await svc.cupIsOn('esp.copa_del_rey'), true);
  const off = new BracketService({ providers: { espn: { matchDays: () => new Set([day(-12), day(9)]) } } });
  assert.equal(await off.cupIsOn('esp.copa_del_rey'), false);
});
