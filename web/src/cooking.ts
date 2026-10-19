// Cooking mode: a full-screen kitchen view of one recipe. Ingredients on the left (tap to tick),
// the current step big on the right, previous/next, and a timer button when the step has a time.
// The state lives on the server, so the assistant, a phone and the screen all move together.
import type { Cooking } from './types';
import { getState, subscribe } from './store';
import { esc } from './format';
import { t } from './i18n';

let layer: HTMLElement;
let lastKey = '';
const ticked = new Set<string>(); // ingredients ticked off, per recipe (on this screen only)
let tickedFor = '';

export const cookingState = (): Cooking | null => {
  const c = getState().sections.cooking?.data;
  return c && c.steps?.length && getState().config?.features?.cooking !== false ? c : null;
};
export const isCooking = () => !!cookingState();

const api = (method: string, body?: unknown, path = '') =>
  fetch(`/api/cooking${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

export const cookingGo = (go: 'next' | 'previous' | 'first' | number) => api('PATCH', { go });
export const cookingTimer = () => api('POST', {}, '/timer');
export const cookingStop = (by: 'button' | 'voice' = 'button') => api('DELETE', undefined, `?by=${by}`);

/** Reads a step aloud with the browser's own voice (free, offline on most systems). */
export function speakStep(c: Cooking | null = cookingState()) {
  if (!c || !('speechSynthesis' in window)) return;
  const text = `${t('cooking.stepOf', { n: c.step + 1, of: c.steps.length })}. ${c.steps[c.step].text}`;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = getState().config?.locale || document.documentElement.lang;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function render() {
  const c = cookingState();
  document.body.classList.toggle('cooking', !!c);
  layer.hidden = !c;
  if (!c) {
    lastKey = '';
    return;
  }
  if (tickedFor !== c.recipeId) {
    ticked.clear();
    tickedFor = c.recipeId;
  }
  const key = `${c.recipeId}|${c.step}|${c.steps.length}|${[...ticked].join(',')}|${getState().config?.language}`;
  if (key === lastKey) return;
  lastKey = key;
  const s = c.steps[c.step];
  const last = c.step === c.steps.length - 1;
  layer.innerHTML = `
    <div class="ck-wrap">
      <header class="ck-head">
        <div class="ck-title"><span>${t('cooking.title')}</span><h1>${esc(c.title)}</h1>${c.servings ? `<small>${esc(/^\d+$/.test(c.servings) ? t('cooking.serves', { n: c.servings }) : c.servings)}</small>` : ''}</div>
        ${getState().config?.assistant ? `<button class="ck-ask" data-ck="ask" aria-label="${esc(t('assistant.title'))}"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg></button>` : ''}
        <button class="ck-exit" data-ck="exit">${t('cooking.exit')}</button>
      </header>
      <div class="ck-body">
        <aside class="ck-ingr card">
          <h2>${t('cooking.ingredients')}</h2>
          <ul>${c.ingredients.map((x, i) => `<li class="${ticked.has(String(i)) ? 'done' : ''}" data-ck="tick" data-i="${i}">${esc(x)}</li>`).join('')}</ul>
        </aside>
        <section class="ck-step card">
          <div class="ck-count">${t('cooking.stepOf', { n: c.step + 1, of: c.steps.length })}</div>
          <p class="ck-text ${s.text.length > 220 ? 'long' : ''}">${esc(s.text)}</p>
          ${s.minutes ? `<button class="ck-timer" data-ck="timer"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>${t('cooking.timer', { n: s.minutes })}</button>` : ''}
          <div class="ck-progress">${c.steps.map((_, i) => `<i class="${i < c.step ? 'past' : i === c.step ? 'now' : ''}" data-ck="goto" data-i="${i}"></i>`).join('')}</div>
          <nav class="ck-nav">
            <button class="ck-prev" data-ck="prev" ${c.step === 0 ? 'disabled' : ''}>${t('cooking.previous')}</button>
            ${last ? `<button class="ck-next done" data-ck="exit">${t('cooking.finish')}</button>` : `<button class="ck-next" data-ck="next">${t('cooking.next')}</button>`}
          </nav>
          <p class="ck-hint">${t(getState().config?.assistant ? 'cooking.voiceHint' : 'cooking.tapHint')}</p>
        </section>
      </div>
    </div>`;
}

export function initCooking() {
  layer = document.createElement('section');
  layer.className = 'cooking-layer';
  layer.hidden = true;
  document.body.appendChild(layer);
  layer.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-ck]');
    if (!el) return;
    switch (el.dataset.ck) {
      case 'next':
        return void cookingGo('next');
      case 'prev':
        return void cookingGo('previous');
      case 'goto':
        return void cookingGo(Number(el.dataset.i) + 1);
      case 'timer':
        el.classList.add('started');
        return void cookingTimer();
      case 'ask':
        return void window.dispatchEvent(new CustomEvent('dash:ask'));
      case 'exit':
        speechSynthesis?.cancel();
        return void cookingStop();
      case 'tick': {
        const i = el.dataset.i!;
        ticked.has(i) ? ticked.delete(i) : ticked.add(i);
        return render();
      }
    }
  });
  subscribe((_s, changed) => {
    if (changed === 'cooking' || changed === 'config') render();
  });
  render();
}
