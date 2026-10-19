import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchdayService } from '../server/services/matchday.js';
import { EspnProvider } from '../server/providers/sports/espn.js';
import { RadarProvider } from '../server/providers/radar.js';

const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const game = (id, startIn, extra = {}) => ({
  id: `espn:${id}`,
  provider: 'espn',
  sport: 'soccer',
  league: { key: 'esp.1', name: 'LaLiga' },
  start: new Date(Date.now() + startIn).toISOString(),
  state: 'pre',
  home: { id: '1' },
  away: { id: '2' },
  ...extra,
});

test('previews only cover my games kicking off within 90 minutes', () => {
  const teams = [
    { key: 'soon', next: game('a', 30 * 60e3) },
    { key: 'later', next: game('b', 3 * 3600e3) },
    { key: 'tbd', next: game('c', 20 * 60e3, { timeTBD: true }) },
    { key: 'live', next: game('d', -5 * 60e3, { state: 'live' }) },
    { key: 'none', next: null },
  ];
  const svc = new MatchdayService({ config: {}, store: { get: () => ({ data: { teams } }) }, providers: {} });
  assert.deepEqual(svc.upcomingMine().map((x) => x.card.key), ['soon']);
});

test('round leagues: home leagues (ESPN, MLB, EuroLeague), no national teams, no duplicates', () => {
  const teams = [{ home: 'esp.1' }, { home: 'esp.1' }, { home: 'nba' }, { home: 'fifa.world' }, { home: 'mlb' }, { home: 'euroleague' }];
  const svc = new MatchdayService({ config: {}, store: { get: () => ({ data: { teams } }) }, providers: {} });
  const keys = svc.roundLeagues();
  assert.ok(['esp.1', 'nba', 'mlb', 'euroleague'].every((k) => keys.includes(k)));
  assert.equal(keys.filter((k) => k === 'esp.1').length, 1);
  assert.ok(!keys.includes('fifa.world'));
});

test('a round panel only on a day the competition plays', async () => {
  const tz = 'Europe/Madrid';
  const at = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const game = (id, start, state) => ({ id, start, state, home: {}, away: {} });
  const providers = {
    espn: {
      matchDays: () => null,
      recentBoard: () => null,
      scoreboardForDay: async (key) => (key === 'esp.1' ? [game('a', at(0), 'live')] : [game('b', at(-50), 'final')]),
      leagueTable: async () => null,
    },
  };
  const svc = new MatchdayService({ config: { timezone: tz }, store: { get: () => ({ data: { teams: [] } }) }, providers, followed: () => ['esp.1', 'eng.1'] });
  const { rounds } = await svc.rounds();
  assert.deepEqual(rounds.map((r) => r.key), ['esp.1'], 'eng.1 only had a game two days ago');
});

test('ESPN line-ups: starters in formation order, "SUB" position dropped', async (t) => {
  const p = (name, place, pos, starter = true) => ({ starter, formationPlace: place, jersey: String(place), position: { abbreviation: pos }, athlete: { shortName: name } });
  t.mock.method(globalThis, 'fetch', async () =>
    json({
      rosters: [
        { team: { id: 10 }, formation: '4-3-3', roster: [p('B', 2, 'CB'), p('A', 1, 'G'), p('Bench', 12, 'SUB', false)] },
        { team: { id: 20 }, formation: '4-4-2', roster: [p('C', 1, 'SUB')] },
      ],
    }),
  );
  const lu = await new EspnProvider().lineups('esp.1', '123');
  assert.equal(lu[0].teamId, '10');
  assert.equal(lu[0].formation, '4-3-3');
  assert.deepEqual(lu[0].starters.map((s) => s.name), ['A', 'B']);
  assert.equal(lu[1].starters[0].pos, '');
});

test('ESPN line-ups: null until both teams are published', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ rosters: [{ team: { id: 10 }, roster: [] }] }));
  assert.equal(await new EspnProvider().lineups('esp.1', '123'), null);
});

test('RainViewer frames: past + nowcast in ms, error when empty', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ host: 'https://tilecache.rainviewer.com', radar: { past: [{ time: 100, path: '/a' }, { time: 200, path: '/b' }], nowcast: [{ time: 300, path: '/c' }] } }));
  const r = await new RadarProvider().fetch();
  assert.deepEqual(r.frames.map((f) => f.time), [100e3, 200e3, 300e3]);
  assert.equal(r.nowcastFrom, 2);
  t.mock.method(globalThis, 'fetch', async () => json({ host: 'x', radar: { past: [] } }));
  await assert.rejects(() => new RadarProvider().fetch());
});
