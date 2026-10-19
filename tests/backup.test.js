import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let Db, dir;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'dash-backup-'));
  process.env.DASH_DATA_DIR = dir;
  ({ Db } = await import('../server/lib/db.js'));
});

const favs = { teams: [{ key: 'a', league: 'esp.1', name: 'Valencia' }], drivers: [], players: [], symbols: [] };

test('export → import round trip; this install keeps its config.json bookkeeping', () => {
  const db = new Db(favs, { language: 'es' });
  db.addNote({ text: 'Llamar al fontanero' });
  db.addShopping(['leche', 'huevos']);
  db.remember('The plumber is Juan, 600 123 456');
  db.saveRecipe({ title: 'Tortilla', source: null, ingredients: ['huevos'], steps: [{ text: 'Batir', minutes: null }] });
  db.setSettings({ userName: 'Alex' });
  const backup = db.exportData();
  assert.equal(backup.app, 'dash');
  assert.ok(!('seedHash' in backup.data) && !('settingsBase' in backup.data), 'no bookkeeping in the file');
  assert.deepEqual(Db.inspect(backup).counts, { favorites: 1, notes: 1, countdowns: 0, settings: 1, shopping: 2, recipes: 1, memories: 1 });

  // Wipe, then restore.
  const seedHash = db.data.seedHash;
  db.data.notes = [];
  db.data.shopping = [];
  db.data.memories = [];
  db.setSettings({ userName: 'Someone else' });
  const r = db.importData(JSON.parse(JSON.stringify(backup)));
  assert.match(r.savedCurrentAs, /^db-\d{8}-\d{9}-before-restore\.json$/);
  assert.equal(db.notes()[0].text, 'Llamar al fontanero');
  assert.deepEqual(db.shopping().map((x) => x.text), ['leche', 'huevos']);
  assert.equal(db.memories()[0].text, 'The plumber is Juan, 600 123 456');
  assert.equal(db.settings().userName, 'Alex');
  assert.equal(db.data.seedHash, seedHash);

  // The copy taken before the restore holds what was replaced, and can be restored by name.
  const saved = db.readBackup(r.savedCurrentAs);
  assert.equal(saved.data.settings.userName, 'Someone else');
  db.importData(saved);
  assert.equal(db.settings().userName, 'Someone else');

  // A fresh Db (next start) with the same config keeps the restored data.
  const again = new Db(favs, { language: 'es' });
  assert.equal(again.settings().userName, 'Someone else');
});

test('rejects files that are not Dash backups, or malformed ones', () => {
  assert.throws(() => Db.inspect({ hello: 1 }), /not a Dash backup/);
  assert.throws(() => Db.inspect({ app: 'dash', format: 9, data: {} }), /newer/);
  assert.throws(() => Db.inspect({ app: 'dash', format: 1, data: { notes: 'oops' } }), /invalid "notes"/);
  const db = new Db(favs, {});
  assert.throws(() => db.readBackup('../db.json'), /unknown backup/);
});

test('one automatic copy a day, pruned to the last 14', async () => {
  const db = new Db(favs, {});
  assert.ok(db.autoBackup());
  assert.equal(db.autoBackup(), null, 'not twice in a day');
  for (let i = 0; i < 20; i++) {
    db.snapshot('auto');
    await new Promise((r) => setTimeout(r, 3)); // distinct millisecond stamps
  }
  assert.equal(db.backups().filter((b) => b.kind === 'auto').length, 14);
  assert.ok(readdirSync(path.join(dir, 'backups')).every((n) => /^db-\d{8}-\d{9}-(auto|before-restore)\.json$/.test(n)));
});
