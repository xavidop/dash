import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '../server/lib/i18n.js';
import { normalizeEvent } from '../server/providers/sports/espn.js';

const team = (id, name) => ({ id, displayName: name, shortDisplayName: name, abbreviation: name.slice(0, 3).toUpperCase(), color: '112233' });
const event = ({ slug, status, period = 0, clock = '', comps, details = [] }) => ({
  id: '1',
  date: '2026-10-16T19:00Z',
  league: { slug },
  status: { type: status, period, displayClock: clock },
  competitions: [{ competitors: comps, details }],
});

test('football: live clock, goals with the scorer, red cards', () => {
  setLanguage('en');
  const g = normalizeEvent(
    event({
      slug: 'esp.1',
      status: { name: 'STATUS_SECOND_HALF', state: 'in' },
      clock: "67'",
      comps: [
        { homeAway: 'home', team: team('94', 'Valencia'), score: '2' },
        { homeAway: 'away', team: team('86', 'Real Madrid'), score: '1' },
      ],
      details: [
        { scoringPlay: true, team: { id: '94' }, clock: { displayValue: "21'" }, athletesInvolved: [{ displayName: 'A. García' }] },
        { redCard: true, team: { id: '86' }, clock: { displayValue: "58'" }, athletesInvolved: [{ displayName: 'B. Smith' }] },
      ],
    }),
    'esp.1',
  );
  assert.equal(g.state, 'live');
  assert.equal(g.status, "67'");
  assert.equal(g.home.score, 2);
  assert.deepEqual(g.events.map((e) => [e.kind, e.side, e.player]), [['goal', 'home', 'A. García'], ['red', 'away', 'B. Smith']]);
});

test('football: half-time and final after penalties are localized', () => {
  setLanguage('es');
  const comps = [
    { homeAway: 'home', team: team('1', 'A'), score: '1' },
    { homeAway: 'away', team: team('2', 'B'), score: '1' },
  ];
  assert.equal(normalizeEvent(event({ slug: 'esp.1', status: { name: 'STATUS_HALFTIME', state: 'in' }, comps }), 'esp.1').status, 'Descanso');
  const fin = normalizeEvent(event({ slug: 'esp.1', status: { name: 'STATUS_FINAL_PEN', state: 'post' }, comps }), 'esp.1');
  assert.equal(fin.state, 'final');
  assert.equal(fin.status, 'Final (penaltis)');
});

test('basketball: quarter and per-period scores', () => {
  setLanguage('en');
  const g = normalizeEvent(
    event({
      slug: 'nba',
      status: { name: 'STATUS_IN_PROGRESS', state: 'in' },
      period: 3,
      clock: '5:23',
      comps: [
        { homeAway: 'home', team: team('28', 'Raptors'), score: '80', linescores: [{ value: 30 }, { value: 25 }, { value: 25 }] },
        { homeAway: 'away', team: team('2', 'Celtics'), score: '75', linescores: [{ value: 20 }, { value: 30 }, { value: 25 }] },
      ],
    }),
    'nba',
  );
  assert.equal(g.sport, 'basketball');
  assert.equal(g.status, '3rd quarter · 5:23');
  assert.deepEqual(g.periods.quarters.home, [30, 25, 25]);
});

test('hockey: overtime and shootout finals', () => {
  setLanguage('en');
  const comps = [
    { homeAway: 'home', team: team('1', 'A'), score: '3' },
    { homeAway: 'away', team: team('2', 'B'), score: '2' },
  ];
  assert.equal(normalizeEvent(event({ slug: 'nhl', status: { name: 'STATUS_FINAL', state: 'post' }, period: 4, comps }), 'nhl').status, 'Final (OT)');
  assert.equal(normalizeEvent(event({ slug: 'nhl', status: { name: 'STATUS_FINAL', state: 'post' }, period: 5, comps }), 'nhl').status, 'Final (SO)');
  assert.equal(normalizeEvent(event({ slug: 'nhl', status: { name: 'STATUS_IN_PROGRESS', state: 'in' }, period: 2, clock: '12:00', comps }), 'nhl').status, '2nd period · 12:00');
});
