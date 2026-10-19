import type { AppState, Lineup, Preview } from '../types';
import { esc, matchWhen } from '../format';
import { crest, surfaceColor, shade } from '../ui';
import { channelsFor } from './sports';
import { t, rank } from '../i18n';
import { now } from '../store';

export const previewsOf = (s: AppState): Preview[] =>
  s.config?.features?.preMatch === false
    ? []
    : (s.sections.previews?.data?.previews || []).filter((p) => Date.parse(p.game.start) > now() - 10 * 60e3 && p.game.state === 'pre');

function lineupList(l: Lineup | undefined, teamName: string) {
  if (!l) return '';
  return `<div class="pv-lineup">
    <div class="pv-lh"><b>${esc(teamName)}</b>${l.formation ? `<span>${esc(l.formation)}</span>` : ''}</div>
    <ol>${l.starters.map((p) => `<li><span class="pv-num">${esc(p.number)}</span>${esc(p.name)}<small>${esc(p.pos)}</small></li>`).join('')}</ol>
  </div>`;
}

export function renderPreview(el: HTMLElement, s: AppState) {
  const p = previewsOf(s)[0];
  if (!p) {
    el.innerHTML = '';
    return;
  }
  const g = p.game;
  const mins = Math.max(0, Math.round((Date.parse(g.start) - now()) / 60e3));
  const when = matchWhen(g.start);
  const tv = channelsFor(g, { features: s.config?.features, country: s.sections.location?.data?.country });
  const rowFor = (name: string) => p.standing?.rows.find((r) => r.name === name);
  const posLabel = (name: string) => {
    const r = rowFor(name);
    return r ? `<small class="pv-pos">${rank(r.rank)}${r.points != null ? ` · ${t('sports.points', { n: r.points })}` : r.record ? ` · ${esc(r.record)}` : ''}</small>` : '';
  };
  const home = surfaceColor(g.home);
  const away = surfaceColor(g.away);
  const lineups = p.lineups;
  const homeL = lineups?.find((l) => l.teamId === g.home.id);
  const awayL = lineups?.find((l) => l.teamId === g.away.id);
  const pitchers = p.pitchers;
  el.innerHTML = `
    <div class="panel-pad preview" style="--home:${home};--home-d:${shade(home, -0.45)};--away:${away};--away-d:${shade(away, -0.45)}">
      <div class="pv-bg"></div>
      <header class="pv-head">
        <span class="badge soft">${t('preview.title')}</span>
        <span>${esc(g.league.name)} · ${esc(when.text)}${g.venue ? ` · ${esc(g.venue)}` : ''}</span>
      </header>
      <div class="pv-match">
        <div class="pv-side">${crest(g.home, 'xl')}<div class="pv-name">${esc(g.home.name)}</div>${posLabel(g.home.name)}</div>
        <div class="pv-center">
          <div class="pv-count">${mins > 0 ? t('preview.startsIn', { n: mins }) : t('preview.startsNow')}</div>
          <div class="pv-time">${esc(when.time)}</div>
          ${tv ? `<div class="pv-tv">${esc(tv)}</div>` : ''}
        </div>
        <div class="pv-side">${crest(g.away, 'xl')}<div class="pv-name">${esc(g.away.name)}</div>${posLabel(g.away.name)}</div>
      </div>
      ${
        pitchers && (pitchers.home || pitchers.away)
          ? `<div class="pv-pitchers">${(['away', 'home'] as const)
              .map((side) => {
                const pp = pitchers[side];
                return pp ? `<div class="person">${pp.headshot ? `<img src="${esc(pp.headshot)}" alt="" onerror="this.style.visibility='hidden'">` : ''}<div><div class="role">${t('preview.probable')} · ${esc(g[side].name)}</div><div class="pname">${esc(pp.name)}</div></div></div>` : '';
              })
              .join('')}</div>`
          : ''
      }
      ${
        homeL || awayL
          ? `<div class="pv-lineups"><h2>${g.sport === 'baseball' ? t('preview.battingOrder') : t('preview.lineups')}</h2><div class="pv-cols">${lineupList(homeL, g.home.name)}${lineupList(awayL, g.away.name)}</div></div>`
          : g.sport === 'soccer'
            ? `<p class="pv-pending">${t('preview.lineupsPending')}</p>`
            : ''
      }
    </div>`;
}
