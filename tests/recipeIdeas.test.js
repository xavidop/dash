import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickIdeas, mealSteps, RecipeIdeas } from '../server/services/recipeIdeas.js';

const pool = ['Beef', 'Chicken', 'Pasta', 'Seafood', 'Vegan', 'Pork', 'Dessert', 'Breakfast'].flatMap((category) =>
  Array.from({ length: 5 }, (_, i) => ({ id: `${category}${i}`, title: `${category} ${i}`, category })),
);

test('ideas: five mains from different categories plus a dessert (a breakfast in the morning)', () => {
  const ideas = pickIdeas(pool, '2026-10-18:0', 19);
  assert.equal(ideas.length, 6);
  const mains = ideas.slice(0, 5).map((m) => m.category);
  assert.equal(new Set(mains).size, 5);
  assert.ok(!mains.includes('Dessert') && !mains.includes('Breakfast'));
  assert.equal(ideas[5].category, 'Dessert');
  assert.equal(pickIdeas(pool, '2026-10-18:0', 8)[5].category, 'Breakfast');
});

test('ideas: the same day gives the same set on every screen; a shuffle or a new day changes it', () => {
  const ids = (seed) => pickIdeas(pool, seed).map((m) => m.id).join();
  assert.equal(ids('2026-10-18:0'), ids('2026-10-18:0'));
  assert.notEqual(ids('2026-10-18:0'), ids('2026-10-18:1'));
  assert.notEqual(ids('2026-10-18:0'), ids('2026-10-19:0'));
});

test('TheMealDB steps: one per line, without "STEP 1" headings or numbering', () => {
  assert.deepEqual(mealSteps('STEP 1\r\nHeat the oil.\r\n\r\nstep 2\r\nAdd the onion and cook 5 minutes.\r\n3. Serve.'), ['Heat the oil.', 'Add the onion and cook 5 minutes.', 'Serve.']);
  assert.deepEqual(mealSteps('1) Boil water\n2 Add pasta for 10 minutes'), ['Boil water', 'Add pasta for 10 minutes']);
});

test('ideas are kept for the day and only redone on shuffle', async () => {
  const sections = {};
  const store = { get: (k) => sections[k], set: (k, data) => (sections[k] = { data }), getMeta: () => ({ at: Date.now(), meals: pool }), setMeta() {} };
  const svc = new RecipeIdeas({ config: { language: 'en', timezone: 'UTC', cooking: {} }, store });
  let lookups = 0;
  svc.lookup = async (id) => (lookups++, { idMeal: id, strMeal: id, strMealThumb: 'x', strArea: 'Italian', strInstructions: 'Cook.' });
  const now = new Date('2026-10-18T18:00Z');
  const first = await svc.ideas({ now });
  store.set('recipeIdeas', first);
  assert.equal(lookups, 6);
  assert.equal(await svc.ideas({ now }), first);
  assert.equal(lookups, 6);
  const next = await svc.ideas({ now, shuffle: true });
  assert.equal(next.round, 1);
  assert.notEqual(next.items.map((i) => i.id).join(), first.items.map((i) => i.id).join());
});
