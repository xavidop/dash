import { normalizeRecipe, recipeFromUrl } from '../providers/recipe.js';
import { t } from '../lib/i18n.js';

const STALE_MS = 8 * 3600e3; // a forgotten cooking session closes itself

/**
 * Cooking mode: one recipe on screen at a time, shared by the display, the voice assistant and
 * phones (it lives in the store, so every screen follows the same step). Recipes are kept in a
 * short history in the DB so "let's make the lasagna again" works.
 */
export class CookingService {
  constructor({ config, store, db, timers }) {
    this.config = config;
    this.store = store;
    this.db = db;
    this.timers = timers;
  }

  current() {
    const c = this.store.get('cooking')?.data;
    return c?.steps?.length ? c : null;
  }

  publish(state) {
    this.store.set('cooking', state);
    return state;
  }

  start(recipe, by = 'api') {
    const saved = this.db.saveRecipe(recipe);
    console.log(`[cooking] start "${saved.title}" (${by})`);
    return this.publish({ ...saved, recipeId: saved.id, step: 0, startedAt: Date.now(), updatedAt: Date.now() });
  }

  /** From the assistant: a recipe it wrote ({ title, ingredients, steps: [string] }). */
  startFrom(data, by = 'assistant') {
    return this.start(normalizeRecipe({ ...data, steps: [].concat(data.steps || []) }, null), by);
  }

  async startFromUrl(url, by = 'link') {
    return this.start(await recipeFromUrl(url, { language: this.config.language, model: this.config.cooking.model }), by);
  }

  /** A recipe from the history, by id or by (part of) its title. */
  open({ id, name } = {}, by = 'history') {
    const want = String(name || '').toLocaleLowerCase();
    const r = this.db.recipes().find((x) => x.id === id) || (want && this.db.recipes().find((x) => x.title.toLocaleLowerCase().includes(want) || want.includes(x.title.toLocaleLowerCase())));
    if (!r) throw new Error('recipe not found');
    return this.start(r, by);
  }

  /** next | previous | first | a step number (1-based). */
  go(where) {
    const c = this.current();
    if (!c) throw new Error('not cooking');
    const n = where === 'next' ? c.step + 1 : where === 'previous' ? c.step - 1 : where === 'first' ? 0 : Number(where) - 1;
    const step = Math.max(0, Math.min(c.steps.length - 1, Number.isFinite(n) ? n : c.step));
    return this.publish({ ...c, step, updatedAt: Date.now() });
  }

  /** Starts a kitchen timer for the current step (or `minutes`), labelled "Carbonara · step 3". */
  timer(minutes) {
    const c = this.current();
    if (!c) throw new Error('not cooking');
    const m = Number(minutes) || c.steps[c.step]?.minutes;
    if (!m) throw new Error('this step has no time');
    const title = c.title.length > 22 ? `${c.title.slice(0, 21)}…` : c.title;
    return this.timers.add(Math.round(m * 60), `${title} · ${t('cooking.stepShort', { n: c.step + 1 })}`);
  }

  /** `by` says who closed it (button, voice, assistant, expired + the device), for the log. */
  stop(by = 'api') {
    const c = this.current();
    if (c) console.log(`[cooking] stop "${c.title}" (${by})`);
    this.publish(null);
  }

  /** Closes a session nobody touched for hours (called periodically). */
  expire() {
    const c = this.current();
    if (c && Date.now() - (c.updatedAt || c.startedAt) > STALE_MS) this.stop('idle for 8 h');
  }
}
