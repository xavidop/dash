import type { AppState, SportsNewsItem } from '../types';
import { ago, esc } from '../format';
import { staleLabel } from '../ui';
import { t } from '../i18n';

const chips = (it: SportsNewsItem) => it.tags.slice(0, 2).map((tag) => `<span class="tag">${esc(tag.name)}</span>`).join('');

export function renderSportsNews(el: HTMLElement, s: AppState) {
  const items = s.sections.sportsNews?.data?.items || [];
  if (!items.length) {
    el.innerHTML = `<div class="panel-pad"><h1 class="panel-title">${t('sportsNews.title')}</h1><div class="empty">${t('sportsNews.empty')}</div></div>`;
    return;
  }
  // Hero: the first story with an image, preferring one about my teams.
  const hero = items.find((i) => i.image && i.tags.length) || items.find((i) => i.image) || items[0];
  const rest = items.filter((i) => i !== hero).slice(0, 5);
  el.innerHTML = `
    <div class="panel-pad news">
      <h1 class="panel-title">${t('sportsNews.title')}</h1>
      <div class="news-grid">
        <article class="card hero ${hero.image ? '' : 'noimg'}">
          ${hero.image ? `<div class="hero-img"><img src="${esc(hero.image)}" alt="" decoding="async" onerror="this.closest('.hero').classList.add('noimg');this.remove()"></div>` : ''}
          <div class="hero-text">
            <div class="src">${chips(hero)}<b>${esc(hero.source)}</b> · ${esc(ago(hero.publishedAt))}</div>
            <h2>${esc(hero.title)}</h2>
            ${hero.summary ? `<p>${esc(hero.summary)}</p>` : ''}
          </div>
        </article>
        <ol class="card headlines">
          ${rest
            .map(
              (i) => `<li>
                <div class="src">${chips(i)}<b>${esc(i.source)}</b> · ${esc(ago(i.publishedAt))}</div>
                <div class="hl">${esc(i.title)}</div>
              </li>`,
            )
            .join('')}
        </ol>
      </div>
      ${staleLabel(s.sections.sportsNews, s.config?.refresh.newsMinutes ?? 15)}
    </div>`;
}
