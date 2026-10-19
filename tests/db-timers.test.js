import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let Db, TimersService;
before(async () => {
  process.env.DASH_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dash-test-'));
  ({ Db } = await import('../server/lib/db.js'));
  ({ TimersService } = await import('../server/services/timers.js'));
});

const favs = (name) => ({ teams: [{ key: 'a', league: 'esp.1', name }], drivers: [], players: [], symbols: ['AAPL'] });

test('config favourites seed the DB; edits persist until config changes; notes survive', () => {
  let db = new Db(favs('Valencia'), { language: 'es' });
  assert.equal(db.favorites().teams[0].name, 'Valencia');
  db.setFavorites({ symbols: ['MSFT'] });
  db.addNote({ text: 'hola' });
  db.setSettings({ userName: 'Alex', language: 'en' });

  db = new Db(favs('Valencia'), { language: 'es' }); // same config: on-screen edits kept
  assert.deepEqual(db.favorites().symbols, ['MSFT']);
  assert.equal(db.settings().userName, 'Alex');

  db = new Db(favs('Valencia'), { language: 'es', features: { uv: true } }); // a new config key: nothing is dropped
  assert.equal(db.settings().language, 'en');

  db = new Db(favs('Arsenal'), { language: 'fr', features: { uv: true } }); // config changed: config wins, per key
  assert.equal(db.favorites().teams[0].name, 'Arsenal');
  assert.deepEqual(db.favorites().symbols, ['AAPL']);
  assert.equal(db.settings().language, undefined, 'the changed key goes back to config');
  assert.equal(db.settings().userName, 'Alex', 'untouched keys keep their on-screen value');
  assert.equal(db.notes().length, 1, 'notes are never reset');
});

test('timers: add, extend, remove, limits', () => {
  const sections = {};
  const store = { get: (k) => sections[k], set: (k, data) => (sections[k] = { data }) };
  const timers = new TimersService(store);
  const tm = timers.add(300, 'Pasta');
  assert.equal(sections.timers.data.timers.length, 1);
  const end = tm.endsAt;
  timers.extend(tm.id, 60);
  assert.equal(sections.timers.data.timers[0].endsAt, end + 60e3);
  assert.throws(() => timers.add(1), /between/);
  for (let i = 0; i < 5; i++) timers.add(60);
  assert.throws(() => timers.add(60), /at most/);
  assert.ok(timers.remove(tm.id));
  assert.equal(timers.remove('nope'), false);
});
