import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '../server/lib/i18n.js';
import { candidateCompetitions, homeLeagueFromEspn, leagueName, leagueByKey } from '../server/catalog.js';

test('a club is checked in its league, domestic cups and its region’s competitions', () => {
  const c = candidateCompetitions('esp.1');
  assert.equal(c[0], 'esp.1');
  for (const k of ['esp.copa_del_rey', 'uefa.champions', 'uefa.europa', 'fifa.cwc']) assert.ok(c.includes(k), k);
  assert.ok(!c.includes('conmebol.libertadores'));
  assert.ok(candidateCompetitions('bra.1').includes('conmebol.libertadores'));
});

test('a national team is checked in national-team competitions only', () => {
  const c = candidateCompetitions('uefa.nations');
  assert.ok(c.includes('fifa.world') && c.includes('fifa.friendly'));
  assert.ok(!c.includes('esp.1'));
});

test('non-football leagues have a single competition', () => {
  assert.deepEqual(candidateCompetitions('nba'), ['nba']);
  assert.deepEqual(candidateCompetitions('mlb'), ['mlb']);
});

test('ESPN defaultLeague link → catalog key', () => {
  assert.equal(homeLeagueFromEspn({ links: [{ href: 'https://www.espn.com/soccer/league/_/name/esp.1' }] }), 'esp.1');
  assert.equal(homeLeagueFromEspn({ links: [{ href: 'https://www.espn.com/soccer/league/_/name/xyz.9' }] }), null);
});

test('competition names are localized where they translate', () => {
  setLanguage('es');
  assert.equal(leagueName('fifa.world'), 'Mundial');
  assert.equal(leagueName('esp.1'), 'LaLiga');
  setLanguage('en');
  assert.equal(leagueName('fifa.world'), 'World Cup');
});

test('NFL and NHL are in the catalog', () => {
  assert.equal(leagueByKey('nfl').sport, 'football');
  assert.equal(leagueByKey('nhl').sport, 'hockey');
});
