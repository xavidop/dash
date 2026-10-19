import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cheapestWindow, tagLevels } from '../server/providers/electricity.js';
import { HolidaysProvider, countryLanguage } from '../server/providers/holidays.js';

let Db;
before(async () => {
  process.env.DASH_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dash-extras-'));
  ({ Db } = await import('../server/lib/db.js'));
});

const day = [0.2, 0.18, 0.15, 0.12, 0.1, 0.11, 0.14, 0.2, 0.25, 0.22, 0.16, 0.09, 0.08, 0.1, 0.12, 0.15, 0.18, 0.24, 0.3, 0.32, 0.28, 0.24, 0.21, 0.2].map((price, hour) => ({ hour, price }));

test('electricity: cheapest 2-hour window, optionally from the current hour', () => {
  assert.deepEqual(cheapestWindow(day, 2), { start: 11, end: 13, avg: 0.085 });
  assert.equal(cheapestWindow(day, 2, 14).start, 14);
  assert.equal(cheapestWindow(day, 2, 23), null, 'no full window left today');
});

test('electricity: hours tagged by the day’s thirds', () => {
  const levels = tagLevels(day).map((p) => p.level);
  assert.equal(levels.filter((l) => l === 'cheap').length, 8);
  assert.equal(levels[19], 'expensive');
  assert.equal(levels[12], 'cheap');
});

test('holidays: national ones plus only my region’s', async (t) => {
  const year = new Date().getFullYear();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  const list = [
    { date: today, localName: 'Fiesta de otra comunidad', global: false, counties: ['ES-AN'] },
    { date: tomorrow, localName: 'Fiesta valenciana', global: false, counties: ['ES-VC'] },
    { date: `${year + 1}-01-01`, localName: 'Año Nuevo', global: true, counties: null },
  ];
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json' } }));
  const h = await new HolidaysProvider().fetch({ country: 'ES', region: 'ES-VC', timezone: 'Europe/Madrid' });
  assert.equal(h.today, null, 'another region’s holiday is ignored');
  assert.equal(h.tomorrow.name, 'Fiesta valenciana');
});

test('holiday names: local name only in the country’s own language', async (t) => {
  assert.deepEqual(['ES', 'BR', 'CH', 'IT'].map(countryLanguage), ['es', 'pt', 'de', 'it']);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{ date: today, localName: 'Día de la Hispanidad', name: 'National Day', global: true }]), { headers: { 'content-type': 'application/json' } }));
  const name = async (language) => (await new HolidaysProvider().fetch({ country: 'ES', timezone: 'Europe/Madrid', language })).today.name;
  assert.equal(await name('es'), 'Día de la Hispanidad');
  assert.equal(await name('de'), 'National Day');
});

test('countdowns and note reminders are stored in the DB', () => {
  const db = new Db({ teams: [] }, {});
  const c = db.addCountdown({ title: 'Viaje a Japón', date: '2026-12-01' });
  assert.equal(db.countdowns().length, 1);
  assert.throws(() => db.addCountdown({ title: 'x', date: '1/12/2026' }), /YYYY-MM-DD/);
  assert.ok(db.deleteCountdown(c.id));

  const n = db.addNote({ text: 'Llamar al fontanero', remindAt: '2026-10-19T10:00:00+02:00' });
  assert.equal(n.remindAt, Date.parse('2026-10-19T08:00:00Z'));
  db.updateNote(n.id, { reminded: true });
  assert.equal(db.notes()[0].reminded, true);
  db.updateNote(n.id, { remindAt: '2026-10-20T10:00:00+02:00' });
  assert.equal(db.notes()[0].reminded, false, 'a new time re-arms the reminder');
});

test('holidays: Spanish provinces map to their autonomous community', async () => {
  const { normalizeRegion } = await import('../server/providers/holidays.js');
  assert.equal(normalizeRegion('ES', 'ES-M'), 'ES-MD');
  assert.equal(normalizeRegion('ES', 'ES-V'), 'ES-VC');
  assert.equal(normalizeRegion('ES', 'ES-VC'), 'ES-VC', 'already a community');
  assert.equal(normalizeRegion('DE', 'DE-BY'), 'DE-BY');
});
