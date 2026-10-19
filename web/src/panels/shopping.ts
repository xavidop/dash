import type { AppState, ShoppingItem } from '../types';
import { esc } from '../format';
import { t } from '../i18n';

export const shoppingItems = (s: AppState): ShoppingItem[] =>
  [...(s.sections.shopping?.data || [])].sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt);

/** Tap an item to tick it off; "Clear ticked" removes the bought ones. */
export function renderShopping(el: HTMLElement, s: AppState) {
  const items = shoppingItems(s);
  const left = items.filter((x) => !x.done).length;
  const done = items.length - left;
  el.innerHTML = `
    <div class="panel-pad shopping">
      <h1 class="panel-title">${t('shopping.title')}<span class="page-of">${left ? t('shopping.left', { n: left }) : t('shopping.allDone')}</span>
        ${done ? `<button class="set-done shop-clear" data-shop-clear>${t('shopping.clearDone')}</button>` : ''}</h1>
      <ul class="card shop-list ${items.length > 10 ? 'two' : ''}">
        ${items
          .slice(0, 24)
          .map((x) => `<li class="${x.done ? 'done' : ''}" data-shop="${esc(x.id)}" data-done="${x.done ? 1 : 0}"><span class="shop-tick"></span><span>${esc(x.text)}</span></li>`)
          .join('')}
      </ul>
      <p class="shop-hint">${t('shopping.hint')}</p>
    </div>`;
}
