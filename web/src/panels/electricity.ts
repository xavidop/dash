import type { AppState, PowerPrice } from '../types';
import { esc, localHM } from '../format';
import { staleLabel } from '../ui';
import { t, defaultLocale } from '../i18n';

const eur = (v: number, digits = 3) => v.toLocaleString(defaultLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
const hh = (h: number) => String(h % 24).padStart(2, '0');

/** 24 bars, coloured by the day's thirds, with the current hour marked. */
function chart(prices: PowerPrice[], currentHour: number | null, compact = false) {
  if (!prices.length) return '';
  const W = 960;
  const H = compact ? 120 : 300;
  const max = Math.max(...prices.map((p) => p.price)) * 1.08;
  const bw = W / 24;
  const bars = prices
    .map((p) => {
      const h = (p.price / max) * (H - 26);
      const x = p.hour * bw + 3;
      return `<rect class="pw-bar ${p.level} ${p.hour === currentHour ? 'now' : ''}" x="${x.toFixed(1)}" y="${(H - 22 - h).toFixed(1)}" vector-effect="non-scaling-stroke" width="${(bw - 6).toFixed(1)}" height="${h.toFixed(1)}" rx="5"/>`;
    })
    .join('');
  // Hour labels are HTML (the SVG stretches to fit, which would distort text).
  const labels = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => `<span>${hh(h)}</span>`).join('');
  return `<div class="pw-chart-wrap ${compact ? 'compact' : ''}">
    <svg class="pw-chart" viewBox="0 0 ${W} ${H - 22}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>
    <div class="pw-axis-row">${labels}</div>
  </div>`;
}

export function renderElectricity(el: HTMLElement, s: AppState) {
  const p = s.sections.electricity?.data;
  if (!p) {
    el.innerHTML = '';
    return;
  }
  const hour = localHM().h;
  const best = p.cheapest;
  el.innerHTML = `
    <div class="panel-pad power">
      <h1 class="panel-title">${t('power.title')}<span class="page-of">${esc(t('power.subtitle', { region: t(`power.regions.${p.region}`) }))}</span></h1>
      <div class="pw-grid">
        <section class="card pw-main">
          ${chart(p.prices, hour)}
          ${p.tomorrow ? `<div class="pw-tomorrow"><div class="card-title">${t('power.tomorrow')}${p.tomorrow.cheapest ? ` · ${t('power.best')} ${hh(p.tomorrow.cheapest.start)}–${hh(p.tomorrow.cheapest.end)} h` : ''}</div>${chart(p.tomorrow.prices, null, true)}</div>` : ''}
        </section>
        <aside class="pw-side">
          <div class="card pw-stat now ${p.now?.level || ''}">
            <div class="card-title">${t('power.now')} · ${hh(hour)}–${hh(hour + 1)} h</div>
            <div class="pw-big">${p.now ? eur(p.now.price) : '—'}<small>${t('power.unit')}</small></div>
            ${p.now ? `<span class="pill pw-level ${p.now.level}">${t(`power.levels.${p.now.level}`)}</span>` : ''}
          </div>
          ${best ? `<div class="card pw-stat"><div class="card-title">${t('power.best')}</div><div class="pw-mid">${hh(best.start)}–${hh(best.end)} h</div><div class="pw-sub">${eur(best.avg)} ${t('power.unit')}</div></div>` : ''}
          <div class="card pw-stat pw-minmax">
            <div><span>${t('power.min')}</span><b>${eur(p.min)}</b></div>
            <div><span>${t('power.avg')}</span><b>${eur(p.avg)}</b></div>
            <div><span>${t('power.max')}</span><b>${eur(p.max)}</b></div>
          </div>
        </aside>
      </div>
      ${staleLabel(s.sections.electricity, 45)}
    </div>`;
}
