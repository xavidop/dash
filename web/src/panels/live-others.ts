import type { AppState, Game } from '../types';
import { esc } from '../format';
import { crest } from '../ui';
import { t, tn } from '../i18n';

export const otherLive = (s: AppState) => (s.sections.live?.data?.games || []).filter((g) => !g.mine && g.state !== 'final');

function miniCard(g: Game) {
  const bb = g.baseball;
  return `
    <div class="card mini-game">
      <div class="mg-team">${crest(g.home, 'sm')}<span>${esc(g.home.name)}</span><b>${g.home.score ?? 0}</b></div>
      <div class="mg-team">${crest(g.away, 'sm')}<span>${esc(g.away.name)}</span><b>${g.away.score ?? 0}</b></div>
      <div class="mg-status"><span class="live-dot"></span>${esc(g.status)}${bb ? ` · ${tn('mlb.outs', bb.outs)}` : ''}</div>
    </div>`;
}

export function renderLiveOthers(el: HTMLElement, s: AppState) {
  const games = otherLive(s);
  const groups = new Map<string, Game[]>();
  for (const g of games) {
    if (!groups.has(g.league.name)) groups.set(g.league.name, []);
    groups.get(g.league.name)!.push(g);
  }
  el.innerHTML = `
    <div class="panel-pad">
      <h1 class="panel-title"><span class="live-dot big"></span>${t('common.live')}</h1>
      ${
        games.length
          ? `<div class="live-groups">${[...groups]
              .map(([league, list]) => `<section class="league-group"><h3>${esc(league)}</h3><div class="mini-grid">${list.slice(0, 4).map(miniCard).join('')}</div></section>`)
              .join('')}</div>`
          : `<div class="empty">${t('live.otherLive')}</div>`
      }
    </div>`;
}
