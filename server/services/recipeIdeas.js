import { fetchJson } from '../lib/http.js';
import { normalizeRecipe } from '../providers/recipe.js';

// "What to cook": a handful of recipe ideas a day from TheMealDB (free, no key: about 300 recipes
// with photos, ingredients and steps). Recipes there are in English; with GEMINI_API_KEY set and
// the screen in another language, titles and full recipes are translated by Gemini.

const API = 'https://www.themealdb.com/api/json/v1/1';
const MAINS = ['Beef', 'Chicken', 'Pasta', 'Seafood', 'Vegetarian', 'Vegan', 'Lamb', 'Pork', 'Goat', 'Miscellaneous', 'Starter', 'Side'];
const CATEGORIES = [...MAINS, 'Dessert', 'Breakfast'];
const IDEAS = 6;
const POOL_MAX_AGE = 7 * 864e5;

/** Small seeded random generator: the same day (and shuffle count) gives the same ideas on every screen. */
export function seeded(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks the day's ideas from the pool: mains from different categories, plus a dessert (or, in the
 * morning, a breakfast).
 */
export function pickIdeas(pool, seed, hour = 12) {
  const rnd = seeded(seed);
  const shuffled = (list) =>
    list
      .map((x) => [rnd(), x])
      .sort((a, b) => a[0] - b[0])
      .map((x) => x[1]);
  const extra = hour < 11 ? 'Breakfast' : 'Dessert';
  const out = [];
  const used = new Set();
  for (const m of shuffled(pool.filter((m) => MAINS.includes(m.category)))) {
    if (out.length >= IDEAS - 1) break;
    if (used.has(m.category)) continue;
    used.add(m.category);
    out.push(m);
  }
  const sweet = shuffled(pool.filter((m) => m.category === extra))[0];
  if (sweet) out.push(sweet);
  return out;
}

/** TheMealDB's instructions: one paragraph per line, sometimes with "STEP 1" headings. */
export function mealSteps(text) {
  return String(text || '')
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(step\s*)?\d+\s*[.:)-]?\s+(?=\S)/i, '').trim())
    .filter((l) => l.length > 2 && !/^(step\s*)?\d+[.:)]?$/i.test(l));
}

function mealIngredients(m) {
  const out = [];
  for (let i = 1; i <= 20; i++) {
    const name = String(m[`strIngredient${i}`] || '').trim();
    if (!name) continue;
    out.push({ name, line: `${String(m[`strMeasure${i}`] || '').trim()} ${name}`.trim() });
  }
  return out;
}

async function gemini(prompt, schema, model) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(40000),
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error?.message || `Gemini HTTP ${res.status}`);
  return JSON.parse(d.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
}

const STRINGS = { type: 'ARRAY', items: { type: 'STRING' } };

export class RecipeIdeas {
  constructor({ config, store }) {
    this.config = config;
    this.store = store;
    this.recipes = new Map(); // id → full recipe (translated), for the preview and cooking mode
  }

  /** Translation only when it's worth it: another language and a Gemini key. */
  translating() {
    return this.config.language !== 'en' && !!process.env.GEMINI_API_KEY;
  }

  /** Every recipe's id, name, photo and category (a dozen requests, kept for a week). */
  async pool() {
    const cached = this.store.getMeta('recipePool');
    if (cached?.meals?.length && Date.now() - cached.at < POOL_MAX_AGE) return cached.meals;
    const meals = [];
    for (const category of CATEGORIES) {
      const d = await fetchJson(`${API}/filter.php?c=${encodeURIComponent(category)}`);
      for (const m of d.meals || []) meals.push({ id: m.idMeal, title: m.strMeal, image: m.strMealThumb, category });
    }
    if (!meals.length) throw new Error('no recipes');
    this.store.setMeta('recipePool', { at: Date.now(), meals });
    return meals;
  }

  async lookup(id) {
    const m = (await fetchJson(`${API}/lookup.php?i=${encodeURIComponent(id)}`)).meals?.[0];
    if (!m) throw new Error('recipe not found');
    return m;
  }

  /**
   * Today's ideas. `shuffle` asks for a new set (every screen follows). Titles are translated in one
   * call when the screen isn't in English.
   */
  async ideas({ shuffle = false, now = new Date() } = {}) {
    const day = now.toLocaleDateString('en-CA', { timeZone: this.config.timezone });
    const hour = Number(now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: this.config.timezone }));
    const prev = this.store.get('recipeIdeas')?.data;
    const sameDay = prev?.day === day && prev?.language === this.config.language;
    const round = sameDay ? (prev.round || 0) + (shuffle ? 1 : 0) : 0;
    if (sameDay && !shuffle && prev.items?.length) return prev;
    const picks = pickIdeas(await this.pool(), `${day}:${round}`, hour);
    const items = [];
    for (const p of picks) {
      try {
        const m = await this.lookup(p.id);
        items.push({ id: p.id, title: m.strMeal, image: `${m.strMealThumb}/medium`, category: p.category, area: m.strArea && m.strArea !== 'Unknown' ? m.strArea : null, ingredients: mealIngredients(m).length, steps: mealSteps(m.strInstructions).length });
      } catch (err) {
        console.warn(`[recipes] ${p.id}:`, err.message);
      }
    }
    if (!items.length) throw new Error('no recipe ideas');
    if (this.translating()) {
      try {
        const tr = await gemini(
          `Translate these recipe names and cuisines into the language with code "${this.config.language}". Keep dish names that are usually left untranslated (e.g. "Lasagne", "Pad Thai"). Return the arrays in the same order.\n\n${JSON.stringify({ titles: items.map((i) => i.title), areas: items.map((i) => i.area || '') })}`,
          { type: 'OBJECT', properties: { titles: STRINGS, areas: STRINGS }, required: ['titles', 'areas'] },
          this.config.cooking.model,
        );
        items.forEach((it, i) => {
          if (tr.titles?.[i]) it.title = tr.titles[i];
          it.area = it.area && tr.areas?.[i] ? tr.areas[i] : it.area;
        });
      } catch (err) {
        console.warn('[recipes] translation failed:', err.message);
      }
    }
    return { day, round, language: this.config.language, translated: this.translating(), items };
  }

  /** The full recipe (for the preview and cooking mode), translated when needed. */
  async recipe(id) {
    const key = `${this.config.language}:${id}`;
    if (this.recipes.has(key)) return this.recipes.get(key);
    const m = await this.lookup(id);
    const ingredients = mealIngredients(m);
    let r = {
      title: m.strMeal,
      image: m.strMealThumb,
      ingredients: ingredients.map((i) => i.line),
      items: ingredients.map((i) => i.name),
      steps: mealSteps(m.strInstructions),
    };
    if (this.translating()) {
      try {
        const tr = await gemini(
          `Translate this recipe into the language with code "${this.config.language}". Convert cups, ounces and °F to metric where it helps a home cook. "items" are the bare ingredient names for a shopping list. Keep every array the same length and order.\n\n${JSON.stringify(r)}`,
          { type: 'OBJECT', properties: { title: { type: 'STRING' }, ingredients: STRINGS, items: STRINGS, steps: STRINGS }, required: ['title', 'ingredients', 'items', 'steps'] },
          this.config.cooking.model,
        );
        if (tr.steps?.length && tr.ingredients?.length === r.ingredients.length) r = { ...r, ...tr, items: tr.items?.length === r.items.length ? tr.items : r.items };
      } catch (err) {
        console.warn('[recipes] translation failed:', err.message);
      }
    }
    const recipe = { ...normalizeRecipe({ name: r.title, image: r.image, ingredients: r.ingredients, steps: r.steps }, `https://www.themealdb.com/meal/${id}`), items: r.items, ideaId: id };
    this.recipes.set(key, recipe);
    if (this.recipes.size > 30) this.recipes.delete(this.recipes.keys().next().value);
    return recipe;
  }
}
