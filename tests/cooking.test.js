import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stepMinutes, recipeFromHtml, normalizeRecipe } from '../server/providers/recipe.js';

let Db, TimersService, CookingService, AssistantService;
before(async () => {
  process.env.DASH_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dash-test-'));
  ({ Db } = await import('../server/lib/db.js'));
  ({ TimersService } = await import('../server/services/timers.js'));
  ({ CookingService } = await import('../server/services/cooking.js'));
  ({ AssistantService } = await import('../server/services/assistant.js'));
});

const fakeStore = () => {
  const data = {};
  return { get: (k) => data[k], set: (k, v) => (data[k] = { data: v, updatedAt: Date.now(), error: null }) };
};

test('step times in several languages; temperatures and plain steps have none', () => {
  assert.deepEqual(
    ['Simmer for 10-12 minutes', 'Cocer 8 minutos', 'Bake for 1 hour 15 min', 'Lasciate riposare 20 minuti', 'Cuire 15 mn', '1 Stunde ruhen lassen', 'Leave for half an hour', 'Preheat the oven to 180C', 'Add salt'].map(stepMinutes),
    [10, 8, 75, 20, 15, 60, 30, null, null],
  );
});

test('schema.org Recipe cards: HowToStep, HowToSection, plain strings, @graph', () => {
  const page = (obj) => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head></html>`;
  const a = recipeFromHtml(
    page({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'x' },
        {
          '@type': ['Recipe'],
          name: 'Carbonara &amp; co',
          recipeYield: ['4', '4 servings'],
          totalTime: 'PT25M',
          image: { url: 'https://img/x.jpg' },
          recipeIngredient: ['200 g spaghetti', ' 2 eggs '],
          recipeInstructions: [
            { '@type': 'HowToSection', name: 'Pasta', itemListElement: [{ '@type': 'HowToStep', text: 'Boil the pasta for 10 minutes.' }] },
            { '@type': 'HowToStep', text: '<p>Mix the eggs.</p>' },
          ],
        },
      ],
    }),
    'https://example.com/r',
  );
  assert.equal(a.title, 'Carbonara & co');
  assert.equal(a.servings, '4');
  assert.equal(a.totalMinutes, 25);
  assert.equal(a.image, 'https://img/x.jpg');
  assert.deepEqual(a.ingredients, ['200 g spaghetti', '2 eggs']);
  assert.deepEqual(a.steps, [
    { text: 'Boil the pasta for 10 minutes.', minutes: 10 },
    { text: 'Mix the eggs.', minutes: null },
  ]);
  const b = recipeFromHtml(page({ '@type': 'Recipe', name: 'Tortilla', recipeInstructions: ['Pelar las patatas.', 'Freír 20 minutos.'] }), null);
  assert.deepEqual(b.steps.map((s) => s.minutes), [null, 20]);
  assert.equal(recipeFromHtml('<html>no card</html>', null), null);
  assert.throws(() => normalizeRecipe({ name: 'Empty' }), /no recipe/);
});

function make() {
  const store = fakeStore();
  const db = new Db({ teams: [] }, {});
  db.data.recipes = [];
  db.data.memories = [];
  const timers = new TimersService(store);
  const config = { features: { assistant: true }, timezone: 'Europe/Madrid', language: 'en', userName: '', bins: [{ name: 'Recycling', weekdays: [0, 1, 2, 3, 4, 5, 6], evening: true }], cooking: { model: 'x' }, assistant: { model: 'm', voice: 'v', idleSeconds: 8 } };
  const cooking = new CookingService({ config, store, db, timers });
  const a = new AssistantService({ config, store, db, timers, cooking, languageName: () => 'English', onChange: () => {} });
  return { a, db, store, cooking };
}

test('cooking: start from the assistant, move through steps, step timer, history, stop', () => {
  const { a, db, store, cooking } = make();
  const r = a.tool('start_recipe', { title: 'Carbonara', servings: '2', ingredients: ['pasta', 'eggs'], steps: ['Boil water.', 'Cook the pasta for 9 minutes.', 'Mix with the eggs.'] });
  assert.deepEqual([r.step, r.of, r.minutes], [1, 3, null]);
  assert.equal(a.tool('recipe_step', { go: 'next' }).minutes, 9);
  const tm = a.tool('start_step_timer', {});
  assert.equal(tm.minutes, 9);
  assert.match(tm.label, /^Carbonara · step 2$/);
  assert.equal(a.tool('recipe_step', { go: 'next' }).step, 3);
  assert.equal(a.tool('recipe_step', { go: 'next' }).step, 3, 'stays on the last step');
  assert.equal(a.tool('recipe_step', { go: '1' }).step, 1);
  assert.ok(a.tool('start_step_timer', {}).error, 'step 1 has no time');
  assert.match(a.context(), /COOKING MODE is open: "Carbonara"/);
  a.tool('stop_cooking', {});
  assert.equal(store.get('cooking').data, null);
  assert.equal(db.recipes().length, 1);
  assert.equal(a.tool('open_saved_recipe', { name: 'carbo' }).title, 'Carbonara');
  assert.equal(cooking.current().step, 0);
  assert.ok(a.tool('open_saved_recipe', { name: 'paella' }).error);
});

test('memory: remember, recall in context, forget by words', () => {
  const { a, db } = make();
  assert.equal(a.tool('remember', { fact: 'The plumber is Juan, phone 600 123 456' }).saved, 'The plumber is Juan, phone 600 123 456');
  a.tool('remember', { fact: "Grandma's Wi-Fi password is PATATA2024" });
  const ctx = a.context();
  assert.match(ctx, /plumber is Juan, phone 600 123 456/);
  assert.match(ctx, /PATATA2024/);
  assert.deepEqual(a.tool('forget', { about: 'plumber' }).forgotten, ['The plumber is Juan, phone 600 123 456']);
  assert.ok(a.tool('forget', { about: 'dentist' }).error);
  assert.equal(db.memories().length, 1);
});

test('briefing context: bins the evening before', () => {
  const { a } = make();
  assert.match(a.context(), /Recycling goes out tonight/);
});
