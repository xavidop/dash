import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let Db, TimersService, AssistantService, localToEpoch;
before(async () => {
  process.env.DASH_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dash-test-'));
  ({ Db } = await import('../server/lib/db.js'));
  ({ TimersService } = await import('../server/services/timers.js'));
  ({ AssistantService, localToEpoch } = await import('../server/services/assistant.js'));
});

const fakeStore = () => {
  const data = {};
  return { get: (k) => data[k], set: (k, v) => (data[k] = { data: v, updatedAt: Date.now(), error: null }) };
};

function make(features = { assistant: true }) {
  const store = fakeStore();
  const db = new Db({ teams: [] }, {});
  db.data.shopping = []; // tests share one data dir
  db.data.notes = [];
  const changed = [];
  const config = { features, timezone: 'Europe/Madrid', userName: '', assistant: { model: 'gemini-3.8-live', voice: 'Kore', idleSeconds: 8 } };
  const a = new AssistantService({ config, store, db, timers: new TimersService(store), languageName: () => 'Español', onChange: (s) => changed.push(s) });
  return { a, db, store, changed };
}

test('shopping list: dedupes case-insensitively, revives ticked items, removes by name', () => {
  const { db } = make();
  db.addShopping(['Leche', 'huevos']);
  assert.deepEqual(db.addShopping(['leche', 'Pan']).map((x) => x.text), ['Pan']);
  db.updateShopping(db.shopping().find((x) => x.text === 'Pan').id, { done: true });
  db.addShopping('pan');
  assert.equal(db.shopping().find((x) => x.text === 'Pan').done, false);
  assert.equal(db.removeShopping({ names: ['HUEVOS'] }), 1);
  assert.deepEqual(db.shopping().map((x) => x.text), ['Leche', 'Pan']);
});

test('assistant tools change the DB and report back', () => {
  const { a, db, store, changed } = make();
  assert.deepEqual(a.tool('add_to_shopping_list', { items: ['leche', 'huevos'] }).list, ['leche', 'huevos']);
  assert.deepEqual(a.tool('remove_from_shopping_list', { items: ['leche'] }).list, ['huevos']);
  assert.equal(a.tool('add_note', { text: 'Llamar al fontanero', remind_at: '2026-12-01T10:30' }).saved, true);
  assert.equal(db.notes()[0].remindAt, Date.parse('2026-12-01T09:30:00Z')); // Madrid is UTC+1 in December
  assert.equal(a.tool('start_timer', { minutes: 7, label: 'pasta' }).started, true);
  assert.equal(store.get('timers').data.timers[0].label, 'pasta');
  assert.ok(a.tool('start_timer', { minutes: -1 }).error);
  assert.ok(a.tool('nope').error);
  assert.deepEqual(changed, ['shopping', 'shopping', 'notes']);
});

test('local reminder times follow the display time zone, DST included', () => {
  assert.equal(localToEpoch('2026-07-01T10:00', 'Europe/Madrid'), Date.parse('2026-07-01T08:00:00Z'));
  assert.equal(localToEpoch('2026-01-15 18:45', 'America/New_York'), Date.parse('2026-01-15T23:45:00Z'));
  assert.equal(localToEpoch('mañana', 'Europe/Madrid'), null);
});

test('session: needs the key and the toggle; the setup is locked into the token', async (t) => {
  const prev = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    assert.equal(make().a.enabled, false);
    process.env.GEMINI_API_KEY = 'test-key';
    assert.equal(make({ assistant: false }).a.enabled, false);
    const { a, db } = make();
    db.addShopping(['café']);
    let sent;
    t.mock.method(globalThis, 'fetch', async (url, opts) => {
      sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
      return new Response(JSON.stringify({ name: 'auth_tokens/abc' }), { headers: { 'content-type': 'application/json' } });
    });
    const s = await a.session();
    assert.match(s.url, /BidiGenerateContentConstrained\?access_token=auth_tokens%2Fabc$/);
    assert.equal(sent.headers['x-goog-api-key'], 'test-key');
    assert.equal(sent.body.uses, 1);
    const setup = sent.body.bidiGenerateContentSetup;
    assert.equal(setup.model, 'models/gemini-3.8-live');
    assert.ok(setup.tools.some((x) => x.googleSearch));
    assert.ok(setup.tools.find((x) => x.functionDeclarations).functionDeclarations.some((f) => f.name === 'add_to_shopping_list'));
    assert.match(setup.systemInstruction.parts[0].text, /Español/);
    assert.match(setup.systemInstruction.parts[0].text, /café/);
    await assert.rejects(() => a.session(), /too many/); // back-to-back sessions are refused
    assert.ok(!JSON.stringify(s).includes('test-key'), 'the key never reaches the browser');
  } finally {
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  }
});

test('timer tools: alarms at a clock time, add time, cancel by label', () => {
  const { a, store } = make();
  const timers = () => store.get('timers').data.timers;
  a.tool('start_timer', { minutes: 10, label: 'pasta' });
  a.tool('start_timer', { minutes: 25, label: 'horno' });
  // An alarm "at HH:MM" rings at the next such time, within 24 h.
  const r = a.tool('start_timer', { at: '07:30', label: 'despertar' });
  assert.equal(r.started, true);
  const left = r.endsAt - Date.now();
  assert.ok(left > 0 && left <= 864e5);
  assert.equal(new Date(r.endsAt).toLocaleTimeString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }), '07:30');
  assert.equal(a.tool('list_timers').timers.length, 3);
  assert.ok(a.tool('add_time_to_timer', { minutes: 5 }).error, 'ambiguous without a label');
  assert.equal(a.tool('add_time_to_timer', { minutes: 5, label: 'Pasta' }).minutes_left, 15);
  assert.deepEqual(a.tool('cancel_timer', { label: 'horno' }).cancelled, ['horno']);
  assert.deepEqual(a.tool('cancel_timer', { all: true }).cancelled.sort(), ['despertar', 'pasta']);
  assert.equal(timers().length, 0);
  assert.ok(a.tool('cancel_timer', {}).error);
});
