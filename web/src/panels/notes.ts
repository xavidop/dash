import type { AppState, Note } from '../types';
import { esc, ago } from '../format';
import { t } from '../i18n';

export const visibleNotes = (s: AppState): Note[] =>
  [...(s.sections.notes?.data || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(a.done) - Number(b.done) || b.createdAt - a.createdAt);

export function renderNotes(el: HTMLElement, s: AppState) {
  const notes = visibleNotes(s).slice(0, 8);
  el.innerHTML = `
    <div class="panel-pad">
      <h1 class="panel-title">${t('notes.title')}</h1>
      <div class="notes-grid n${Math.min(notes.length, 8)}">
        ${notes
          .map(
            (n) => `<article class="sticky ${esc(n.color)} ${n.done ? 'done' : ''}" data-note="${esc(n.id)}">
              ${n.pinned ? '<span class="pin"></span>' : ''}
              <p>${esc(n.text)}</p>
              <footer>${esc(ago(n.updatedAt))}${n.done ? ` · ${t('notes.done')}` : ''}</footer>
            </article>`,
          )
          .join('')}
      </div>
    </div>`;
}
