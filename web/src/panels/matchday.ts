import type { AppState, Game, Round } from '../types';
import { esc, matchWhen, seriesLine, ymdIn } from '../format';
import { now } from '../store';
import { crest, staleLabel } from '../ui';
import { t } from '../i18n';

const MAX_ROWS = 9;

/** Round panels for leagues that play today (in the display's time zone), whatever the cache says. */
export const roundsOf = (s: AppState): Round[] => {
  if (s.config?.features?.matchday === false) return [];
  const today = ymdIn(new Date(now()));
  return (s.sections.rounds?.data?.rounds || []).filter((r) => [...r.live, ...r.results, ...r.upcoming].some((g) => ymdIn(new Date(g.start)) === today));
};

/** My teams in this sport (team ids are only unique within a sport). */
function myTeamIds(s: AppState, sport: string) {
  return new Set((s.sections.teams?.data?.teams || []).filter((c) => c.sport === sport).map((c) => c.teamId).filter(Boolean) as string[]);
}

function row(g: Game, mine: Set<string>, kind: 'result' | 'upcoming' | 'live') {
  const me = mine.has(g.home.id) || mine.has(g.away.id);
  const when = matchWhen(g.start, g.timeTBD);
  const mid =
    kind === 'upcoming'
      ? `<span class="rd-time">${esc(when.time)}</span>`
      : `<span class="rd-score">${g.home.score ?? 0}<i>–</i>${g.away.score ?? 0}</span>`;
  const meta = kind === 'live' ? `<span class="rd-live"><span class="live-dot"></span>${esc(g.status)}</span>` : kind === 'upcoming' ? esc(when.label) : esc(g.status === 'Final' || g.status === t('status.final') ? when.label : g.status);
  const win = (side: 'home' | 'away') => kind === 'result' && g[side].winner;
  return `<li class="rd-row ${me ? 'me' : ''}">
    <span class="rd-team home ${win('home') ? 'won' : ''}">${esc(g.home.name)}${crest(g.home, 'xs')}</span>
    ${mid}
    <span class="rd-team away ${win('away') ? 'won' : ''}">${crest(g.away, 'xs')}${esc(g.away.name)}</span>
    <span class="rd-meta">${meta}${seriesLine(g) ? `<small class="rd-series">${esc(seriesLine(g))}</small>` : ''}</span>
  </li>`;
}

/** The league table (followed leagues): the whole thing, or the first group(s) that fit. */
function tableHtml(tb: NonNullable<Round['table']>, mine: Set<string>) {
  const groups = tb.groups.length > 2 ? tb.groups.slice(0, 2) : tb.groups;
  const perGroup = groups.length > 1 ? 8 : 20;
  return `<section class="card rd-col rd-table"><h2 class="card-title">${t('matchday.table')}</h2>${groups
    .map(
      (g) => `${g.group ? `<h3 class="rd-group">${esc(g.group)}</h3>` : ''}<ol>${g.rows
        .slice(0, perGroup)
        .map(
          (r) => `<li class="${mine.has(r.id) ? 'me' : ''}"${r.noteColor ? ` style="--zone:#${esc(r.noteColor.replace('#', ''))}"` : ''}>
            <span class="rt-rank">${r.rank}</span>${crest({ logo: r.logo, name: r.name }, 'xs')}<span class="rt-name">${esc(r.name)}</span>
            <span class="rt-val">${tb.format === 'record' ? esc(r.record || '') : r.points ?? ''}</span></li>`,
        )
        .join('')}</ol>`,
    )
    .join('')}</section>`;
}

export function renderRound(el: HTMLElement, s: AppState, key: string) {
  const r = roundsOf(s).find((x) => x.key === key);
  if (!r) {
    el.innerHTML = '';
    return;
  }
  const mine = myTeamIds(s, r.sport);
  const done = [...r.live.map((g) => row(g, mine, 'live')), ...r.results.map((g) => row(g, mine, 'result'))].slice(0, MAX_ROWS);
  const next = r.upcoming.slice(0, MAX_ROWS).map((g) => row(g, mine, 'upcoming'));
  const table = r.table?.groups?.length ? tableHtml(r.table, mine) : '';
  el.innerHTML = `
    <div class="panel-pad">
      <h1 class="panel-title">${t('matchday.title')}<span class="page-of">${esc(r.name)}</span></h1>
      <div class="rd-grid ${table ? 'with-table' : ''}">
        <section class="card rd-col"><h2 class="card-title">${t('matchday.results')}</h2>${done.length ? `<ul>${done.join('')}</ul>` : `<p class="empty-sm">${t('matchday.none')}</p>`}</section>
        <section class="card rd-col"><h2 class="card-title">${t('matchday.upcoming')}</h2>${next.length ? `<ul>${next.join('')}</ul>` : `<p class="empty-sm">${t('matchday.none')}</p>`}</section>
        ${table}
      </div>
      ${staleLabel(s.sections.rounds, 15)}
    </div>`;
}
