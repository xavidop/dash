import type { AppState } from '../types';
import { esc } from '../format';
import { t } from '../i18n';

export function renderQuote(el: HTMLElement, s: AppState) {
  const q = s.sections.quote?.data;
  el.innerHTML = q
    ? `<div class="quote-panel">
        <div class="quote-label">${t('quote.title')}</div>
        <blockquote>
          <span class="qmark" aria-hidden="true">“</span>
          <p class="${q.text.length > 140 ? 'long' : ''}">${esc(q.text)}</p>
          <footer>${esc(q.author)}</footer>
        </blockquote>
      </div>`
    : '';
}
