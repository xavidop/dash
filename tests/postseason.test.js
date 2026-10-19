import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../server/providers/sports/espn.js';
import { normalizeGame } from '../server/providers/sports/mlb.js';
import { setLanguage } from '../server/lib/i18n.js';

test('ESPN playoff games carry the stage and the series', () => {
  const ev = (seasonType, extra = {}) => ({
    id: '1',
    date: '2026-05-20T01:30Z',
    season: { type: seasonType },
    status: { type: { state: 'pre' } },
    competitions: [{ competitors: [{ homeAway: 'home', team: { id: '25', displayName: 'Thunder' } }, { homeAway: 'away', team: { id: '24', displayName: 'Spurs' } }], ...extra }],
  });
  const g = normalizeEvent(ev(3, { notes: [{ headline: 'West Finals - Game 2' }], series: { type: 'playoff', summary: 'Series tied 1-1' } }), 'nba');
  assert.deepEqual([g.postseason, g.stage, g.series], [true, 'West Finals - Game 2', 'Series tied 1-1']);
  const r = normalizeEvent(ev(2, { notes: [{ headline: 'NBA Cup' }] }), 'nba');
  assert.deepEqual([r.postseason, r.stage, r.series], [false, null, null]);
});

test('MLB postseason games: series name, game number and status', () => {
  setLanguage('en');
  const g = normalizeGame({
    gamePk: 9,
    gameType: 'L',
    gameDate: '2026-10-18T21:00:00Z',
    seriesDescription: 'AL Championship Series',
    seriesGameNumber: 5,
    seriesStatus: { result: 'Series tied 2-2' },
    status: { abstractGameState: 'Preview', detailedState: 'Scheduled' },
    teams: { home: { team: { id: 114, name: 'Cleveland Guardians', teamName: 'Guardians' } }, away: { team: { id: 139, name: 'Tampa Bay Rays', teamName: 'Rays' } } },
  });
  assert.deepEqual([g.postseason, g.stage, g.series], [true, 'AL Championship Series · Game 5', 'Series tied 2-2']);
});
