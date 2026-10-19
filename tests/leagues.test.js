import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let Db, MatchdayService, EspnProvider, SportsNewsProvider;
before(async () => {
  process.env.DASH_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dash-leagues-'));
  ({ Db } = await import('../server/lib/db.js'));
  ({ MatchdayService } = await import('../server/services/matchday.js'));
  ({ EspnProvider } = await import('../server/providers/sports/espn.js'));
  ({ SportsNewsProvider } = await import('../server/providers/sportsNews.js'));
});

const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('followed leagues are stored with the favourites', () => {
  const db = new Db({ teams: [], leagues: ['eng.1'] }, {});
  assert.deepEqual(db.favorites().leagues, ['eng.1']);
  db.setFavorites({ leagues: ['esp.1', 'nba'] });
  assert.deepEqual(db.favorites().leagues, ['esp.1', 'nba']);
  db.setFavorites({ symbols: ['AAPL'] });
  assert.deepEqual(db.favorites().leagues, ['esp.1', 'nba'], 'other edits keep them');
});

test('a followed league gets a round panel even without a team in it', () => {
  const store = { get: () => ({ data: { teams: [{ home: 'eng.1' }] } }) };
  const svc = new MatchdayService({ config: {}, store, providers: {}, followed: () => ['esp.1', 'nba'] });
  assert.deepEqual(svc.roundLeagues().sort(), ['eng.1', 'esp.1', 'nba']);
});

test('league table: every group, ranked, points or W-L', async (t) => {
  const entry = (id, name, rank, extra) => ({ team: { id, shortDisplayName: name, logos: [{ href: `${name}.png` }] }, stats: [{ name: 'rank', value: rank }, { name: 'gamesPlayed', value: 9 }, ...extra] });
  t.mock.method(globalThis, 'fetch', async () =>
    json({ name: 'LaLiga', standings: { entries: [entry(2, 'Atlético', 2, [{ name: 'points', value: 22 }]), entry(1, 'Barcelona', 1, [{ name: 'points', value: 27 }])] } }),
  );
  const tb = await new EspnProvider().leagueTable('esp.1');
  assert.equal(tb.format, 'points');
  assert.deepEqual(tb.groups[0].rows.map((r) => [r.rank, r.name, r.points]), [[1, 'Barcelona', 27], [2, 'Atlético', 22]]);
});

test('league stories are tagged with the league when not about one of my teams', async (t) => {
  const now = new Date().toISOString();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('site.api.espn.com')) return json({ articles: [{ id: 1, headline: 'Barcelona beat Betis in a thriller', published: now, images: [] }] });
    return new Response('<rss><channel></channel></rss>');
  });
  const p = new SportsNewsProvider({ language: 'en', locale: 'en-GB', sportsNews: { perTeam: 4 } });
  const { items } = await p.fetch({ teams: [], drivers: [], players: [], leagues: [{ key: 'esp.1', name: 'LaLiga' }] });
  assert.deepEqual(items[0].tags, [{ key: 'league:esp.1', name: 'LaLiga' }]);
});

test("live: every live game of a followed league is published, not just my teams'", async () => {
  const { LiveTracker } = await import('../server/services/live.js');
  const store = { data: {}, set(k, v) { this.data[k] = v; }, get(k) { return { data: this.data[k] }; } };
  const tracker = new LiveTracker({ config: { liveLeagues: [], refresh: { liveActiveSeconds: 20, liveIdleSeconds: 600 } }, store, providers: {}, favorites: {}, leagues: [{ provider: 'espn', league: 'esp.2' }, { provider: 'espn', league: 'eng.1' }], followed: () => ['esp.2'] });
  const live = (id) => ({ id, state: 'live', start: new Date().toISOString(), home: {}, away: {}, mine: null });
  tracker.leagues[0].games = [live('a'), live('b')];
  tracker.leagues[1].games = [live('c')];
  tracker.publish();
  assert.deepEqual(store.data.live.games.map((g) => g.id).sort(), ['a', 'b'], 'followed league shown; a polled-only league is not');
});

test('the same team added twice (config by name + Settings by id) gets one card', async () => {
  const { FavoritesService } = await import('../server/services/favorites.js');
  const teams = [
    { key: 'spain', league: 'uefa.nations', name: 'España', displayName: 'Selección Española' },
    { key: 'fifa.friendly-164', league: 'fifa.friendly', name: 'Spain', id: '164' },
    { key: 'raptors', league: 'nba', name: 'Toronto Raptors' },
    { key: 'other-28', league: 'fiba', name: 'Somebody', id: '28' },
  ];
  const fav = Object.create(FavoritesService.prototype);
  Object.assign(fav, { db: { favorites: () => ({ teams }) }, resolved: { spain: { id: '164' }, raptors: { id: '28' } } });
  fav.sportOf = (t) => (['nba', 'fiba'].includes(t.league) ? 'basketball' : 'soccer');
  fav.providerOf = () => 'espn';
  assert.deepEqual(fav.teams().map((t) => t.key), ['spain', 'raptors', 'other-28'], 'football ids are global; basketball ids only within a league');
});
