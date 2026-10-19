// "What to cook": a few recipe ideas a day with photos. Tap one for its ingredients (tap the ones
// you're missing to put them on the shopping list) and start cooking mode with it.
import type { AppState, RecipeIdea } from '../types';
import { esc } from '../format';
import { t } from '../i18n';

type FullRecipe = { title: string; image: string | null; ingredients: string[]; items: string[]; steps: { text: string; minutes: number | null }[] };

export const recipeIdeas = (s: AppState): RecipeIdea[] => (s.config?.features?.cooking === false ? [] : s.sections.recipeIdeas?.data?.items || []);

const category = (c: string) => {
  const name = t(`recipes.cat.${c}`);
  return name.startsWith('recipes.') ? c : name;
};

export function renderRecipes(el: HTMLElement, s: AppState) {
  const items = recipeIdeas(s);
  el.innerHTML = `
    <div class="panel-pad recipes">
      <h1 class="panel-title">${t('recipes.title')}
        <button class="set-done rx-shuffle" data-rx-shuffle>${t('recipes.shuffle')}</button></h1>
      <div class="rx-grid">
        ${items
          .map(
            (r) => `<button class="rx-card" data-rx="${esc(r.id)}">
              <img src="${esc(r.image)}" alt="" loading="lazy" />
              <span class="rx-info"><b>${esc(r.title)}</b><small>${esc([category(r.category), r.area].filter(Boolean).join(' · '))}</small></span>
            </button>`,
          )
          .join('')}
      </div>
      <p class="rx-credit">${t('recipes.credit')}</p>
    </div>`;
}

export async function shuffleRecipes(btn?: HTMLElement) {
  btn?.classList.add('busy');
  await fetch('/api/recipes/ideas/shuffle', { method: 'POST' }).catch(() => {});
  btn?.classList.remove('busy');
}

// ─── Recipe sheet ───────────────────────────────────────────
let sheet: HTMLElement | null = null;
let recipe: FullRecipe | null = null;
let ideaId = '';
const missing = new Set<number>();
let added = false;
let sheetIdea: RecipeIdea | undefined;

export const isRecipeOpen = () => !!sheet && !sheet.hidden;

export function closeRecipe() {
  if (sheet) sheet.hidden = true;
  recipe = null;
}

function paint(state: 'loading' | 'error' | 'ready', idea?: RecipeIdea) {
  if (!sheet) return;
  if (state !== 'ready' || !recipe) {
    sheet.innerHTML = `<div class="rx-sheet-inner rx-msg"><p>${state === 'loading' ? t('recipes.loading') : t('recipes.failed')}</p>
      <button class="rx-btn" data-rx-close>${t('recipes.close')}</button></div>`;
    return;
  }
  const r = recipe;
  const meta = [idea ? category(idea.category) : '', idea?.area, t('cooking.steps', { n: r.steps.length })].filter(Boolean).join(' · ');
  sheet.innerHTML = `
    <div class="rx-sheet-inner">
      <div class="rx-side">
        ${r.image ? `<img src="${esc(r.image)}" alt="" />` : ''}
        <h2>${esc(r.title)}</h2>
        <p class="rx-meta">${esc(meta)}</p>
        <div class="rx-actions">
          <button class="rx-btn primary" data-rx-start>${t('recipes.start')}</button>
          <button class="rx-btn" data-rx-add ${missing.size ? '' : 'disabled'}>${missing.size ? t('recipes.addMissing', { n: missing.size }) : added ? t('recipes.added') : t('recipes.tapMissing')}</button>
          <button class="rx-btn ghost" data-rx-close>${t('recipes.close')}</button>
        </div>
      </div>
      <div class="rx-ing">
        <h3>${t('cooking.ingredients')}<small>${t('recipes.tapMissing')}</small></h3>
        <ul>${r.ingredients.map((x, i) => `<li class="${missing.has(i) ? 'need' : ''}" data-rx-ing="${i}"><span class="rx-tick"></span>${esc(x)}</li>`).join('')}</ul>
        <h3>${t('cooking.steps', { n: r.steps.length })}</h3>
        <ol class="rx-steps">${r.steps.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ol>
      </div>
    </div>`;
}

export async function openRecipe(id: string, s: AppState) {
  if (!sheet) {
    sheet = Object.assign(document.createElement('section'), { className: 'rx-sheet', hidden: true });
    document.body.appendChild(sheet);
    sheet.addEventListener('click', onClick);
  }
  const idea = recipeIdeas(s).find((x) => x.id === id);
  ideaId = id;
  sheetIdea = idea;
  recipe = null;
  added = false;
  missing.clear();
  sheet.hidden = false;
  paint('loading');
  try {
    const res = await fetch(`/api/recipes/ideas/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(String(res.status));
    if (ideaId !== id) return;
    recipe = await res.json();
    paint('ready', idea);
  } catch {
    if (ideaId === id) paint('error');
  }
}

async function onClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target === sheet || target.closest('[data-rx-close]')) return closeRecipe();
  const ing = target.closest<HTMLElement>('[data-rx-ing]');
  if (ing) {
    const i = Number(ing.dataset.rxIng);
    if (missing.has(i)) missing.delete(i);
    else missing.add(i);
    return paint('ready', sheetIdea);
  }
  const add = target.closest<HTMLButtonElement>('[data-rx-add]');
  if (add && recipe && missing.size) {
    const items = [...missing].map((i) => recipe!.items[i] || recipe!.ingredients[i]);
    add.disabled = true;
    await fetch('/api/shopping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
    added = true;
    missing.clear();
    return paint('ready', sheetIdea);
  }
  const start = target.closest<HTMLButtonElement>('[data-rx-start]');
  if (start) {
    start.disabled = true;
    const res = await fetch('/api/cooking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: ideaId }) }).catch(() => null);
    if (res?.ok) closeRecipe();
    else start.disabled = false;
  }
}
