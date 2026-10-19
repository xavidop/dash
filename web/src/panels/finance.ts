import type { AppState, Quote } from '../types';
import { esc, number, ago } from '../format';
import { staleLabel } from '../ui';
import { t } from '../i18n';

/** Intraday sparkline with the previous close as a dashed baseline. */
function spark(q: Quote) {
  const pts = q.spark;
  if (pts.length < 2) return '';
  const lo = Math.min(...pts, q.prevClose);
  const hi = Math.max(...pts, q.prevClose);
  const span = hi - lo || 1;
  const W = 200;
  const H = 56;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / span) * (H - 6) - 3;
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const base = y(q.prevClose).toFixed(1);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="spark-base"/>
    <polygon points="0,${H} ${line} ${W},${H}" class="spark-fill"/>
    <polyline points="${line}" class="spark-line"/>
  </svg>`;
}

const digitsFor = (p: number) => (p >= 1000 ? 0 : p >= 10 ? 2 : 4);

function tile(q: Quote) {
  const dir = q.change > 0 ? 'up' : q.change < 0 ? 'down' : 'flat';
  const sign = q.change > 0 ? '+' : '';
  return `
    <article class="card quote-tile ${dir}">
      <header>
        <div class="qt-name">${esc(q.name)}</div>
        <div class="qt-sym"><span class="mkt ${q.open ? 'open' : ''}"></span>${esc(q.symbol)} · ${t(q.open ? 'finance.open' : 'finance.closed')}</div>
      </header>
      <div class="qt-price">${number(q.price, digitsFor(q.price))}<small>${esc(q.currency)}</small></div>
      <div class="qt-change">${sign}${number(q.changePct, 2)}%<span>${sign}${number(q.change, digitsFor(Math.abs(q.change) || 1))}</span></div>
      ${spark(q)}
    </article>`;
}

function newsColumn(s: AppState) {
  const items = (s.sections.marketNews?.data?.items || []).slice(0, 6);
  if (!items.length) return '';
  const lead = items.find((i) => i.image);
  return `
    <aside class="card market-news">
      <h2 class="card-title">${t('finance.news')}</h2>
      ${lead ? `<div class="mn-lead"><img src="${esc(lead.image)}" alt="" decoding="async" onerror="this.parentElement.remove()"></div>` : ''}
      <ol>
        ${items
          .map(
            (i) => `<li>
              <div class="src"><b>${esc(i.source)}</b> · ${esc(ago(i.publishedAt))}</div>
              <div class="hl">${esc(i.title)}</div>
            </li>`,
          )
          .join('')}
      </ol>
    </aside>`;
}

export function renderFinance(el: HTMLElement, s: AppState) {
  const quotes = (s.sections.finance?.data?.quotes || []).slice(0, 9);
  const side = newsColumn(s);
  el.innerHTML = `
    <div class="panel-pad">
      <h1 class="panel-title">${t('finance.title')}</h1>
      ${
        quotes.length
          ? `<div class="markets ${side ? 'with-news' : ''}">
              <div class="quotes-grid n${quotes.length} ${side ? 'compact' : ''}">${quotes.map(tile).join('')}</div>
              ${side}
            </div>`
          : `<div class="empty">${t('finance.empty')}</div>`
      }
      ${staleLabel(s.sections.finance, s.config?.refresh.financeMinutes ?? 5)}
    </div>`;
}
