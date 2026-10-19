import type { AppState, Game, TeamCard, Standing, F1Card, TennisCard, CompetitionBlock } from '../types';
import { esc, matchWhen, seriesLine } from '../format';
import { crest, staleLabel, surfaceColor } from '../ui';
import { t, rank } from '../i18n';

const PER_PAGE = 4;

/** Channels for the viewer's country (EuroLeague lists them per country; ESPN/MLB only for the US). */
export function channelsFor(g: Game, s: { features?: { whereToWatch?: boolean } | null; country?: string }) {
  if (s.features?.whereToWatch === false || !g.broadcasts?.length || !s.country) return '';
  const names = [...new Set(g.broadcasts.filter((b) => b.country === s.country).map((b) => b.name))].slice(0, 3);
  return names.length ? t('tv', { channels: names.join(', ') }) : '';
}
let viewer: { features?: { whereToWatch?: boolean } | null; country?: string } = {};

/** Selected competition per team card (survives re-renders); advanced by main.ts. */
export const compIndex = new Map<string, number>();

function result(teamId: string | null, g: Game) {
  const mineHome = g.home.id === teamId;
  const my = mineHome ? g.home : g.away;
  const opp = mineHome ? g.away : g.home;
  const outcome = my.score == null || opp.score == null ? '' : my.score > opp.score ? 'win' : my.score < opp.score ? 'loss' : 'draw';
  const when = matchWhen(g.start);
  return `
    <div class="row last">
      <div class="row-label">${t('sports.last')}</div>
      <div class="score-line">
        ${crest(g.home, 'sm')}<span class="tn ${g.home.id === teamId ? 'me' : ''}">${esc(g.home.name)}</span>
        <span class="sc">${g.home.score ?? '–'}<i>–</i>${g.away.score ?? '–'}</span>
        <span class="tn ${g.away.id === teamId ? 'me' : ''}">${esc(g.away.name)}</span>${crest(g.away, 'sm')}
      </div>
      <div class="row-meta">${outcome ? `<span class="pill ${outcome}">${t(`sports.${outcome}`)}</span>` : ''}<span>${esc(g.status)} · ${esc(when.label)}</span></div>
      ${seriesLine(g) ? `<div class="series-line">${esc(seriesLine(g))}</div>` : ''}
    </div>`;
}

function upcoming(teamId: string | null, g: Game) {
  const opp = g.home.id === teamId ? g.away : g.home;
  const when = matchWhen(g.start, g.timeTBD);
  const live = g.state === 'live' || g.state === 'break';
  return `
    <div class="row next">
      <div class="row-label">${live ? `<span class="live-dot"></span>${t('common.live')}` : t('sports.next')}</div>
      <div class="next-line">
        ${crest(opp, 'md')}
        <div>
          <div class="opp">${esc(g.home.name)} – ${esc(g.away.name)}</div>
          <div class="row-meta"><span class="when">${live ? esc(g.status) : esc(when.text)}</span></div>
          ${seriesLine(g) ? `<div class="series-line">${esc(seriesLine(g))}</div>` : ''}
          ${channelsFor(g, viewer) ? `<div class="tv-line">${esc(channelsFor(g, viewer))}</div>` : ''}
        </div>
      </div>
    </div>`;
}

const noDotZero = (s?: string) => (s ?? '').replace(/\.0$/, '');

function standing(st: Standing, sport: string) {
  const byRecord = st.format === 'record' || sport === 'baseball';
  const gb = st.gamesBack && st.gamesBack !== '-' && st.gamesBack !== '0' ? ` · ${t('sports.behind', { n: esc(noDotZero(st.gamesBack)) })}` : '';
  const headline = byRecord ? `${rank(st.rank)} · ${esc(st.record || '')}${gb}` : `${rank(st.rank)} · ${t('sports.points', { n: st.points ?? 0 })}`;
  const showGb = st.rows.some((r) => r.gb);
  const rows = st.rows
    .map(
      (r) => `<tr class="${r.me ? 'me' : ''}">
        <td class="rk" ${r.noteColor ? `style="--note:${esc(r.noteColor)}"` : ''}>${r.rank}</td>
        <td class="nm">${esc(r.name)}</td>
        <td class="pt">${byRecord ? esc(r.record) : r.points}</td>
        ${showGb ? `<td class="gb">${esc(noDotZero(r.gb))}</td>` : ''}
      </tr>`,
    )
    .join('');
  const note = st.playoff || st.note;
  return `
    <div class="standing">
      <div class="row-label">${t('sports.standing', { name: esc(st.group || st.title) })}</div>
      <div class="st-head">${headline}</div>
      ${note ? `<div class="st-note">${esc(note)}</div>` : ''}
      <table class="mini">${rows}</table>
    </div>`;
}

/** No upcoming game and the last one is over a week old: the season is done. */
const seasonOver = (c: { last: Game | null; next: Game | null }) => !c.next && !!c.last && Date.now() - Date.parse(c.last.start) > 7 * 864e5;

function compSlide(card: TeamCard, c: CompetitionBlock, i: number, active: number) {
  return `
    <section class="comp-slide ${i === active ? 'on' : ''}" data-slide="${i}">
      <div class="team-body">
        <div class="team-main">
          ${c.last ? result(card.teamId, c.last) : `<div class="row"><div class="row-label">${t('sports.last')}</div><div class="empty-sm">${t('sports.noRecent')}</div></div>`}
          ${c.next ? upcoming(card.teamId, c.next) : `<div class="row"><div class="row-label">${t('sports.next')}</div><div class="empty-sm">${seasonOver(c) ? t(c.key && card.home && c.key !== card.home ? 'sports.compOver' : 'sports.seasonOver') : t('sports.noUpcoming')}</div></div>`}
        </div>
        ${c.standing ? standing(c.standing, card.sport) : ''}
      </div>
    </section>`;
}

function teamCard(card: TeamCard) {
  const accent = surfaceColor(card);
  const comps: CompetitionBlock[] = card.competitions?.length
    ? card.competitions
    : [{ key: '', name: '', last: card.last ?? null, next: card.next ?? null, standing: null }];
  const active = Math.min(compIndex.get(card.key) ?? 0, comps.length - 1);
  const multi = comps.length > 1;
  return `
    <article class="card team ${multi ? 'multi' : ''}" style="--team:${esc(accent)}" data-team="${esc(card.key)}" data-count="${comps.length}">
      <header class="team-head">
        ${crest({ logo: card.logo, name: card.name }, 'lg')}
        <h2>${esc(card.name)}</h2>
        ${multi ? '' : comps[0].name ? `<span class="team-league">${esc(comps[0].name)}</span>` : ''}
      </header>
      ${
        multi
          ? `<nav class="comp-tabs">${comps
              .map((c, i) => `<button class="comp-tab ${i === active ? 'on' : ''}" data-comp="${i}" data-team-key="${esc(card.key)}">${esc(c.name)}</button>`)
              .join('')}</nav>`
          : ''
      }
      <div class="comp-slides">${comps.map((c, i) => compSlide(card, c, i, active)).join('')}</div>
    </article>`;
}

function f1Card(f: F1Card) {
  const race = f.next ? matchWhen(f.next.race) : null;
  const quali = f.next?.sessions.find((x) => (x as { id?: string }).id === 'quali');
  const q = quali ? matchWhen(quali.start) : null;
  const rows = f.standings
    .map((d) => `<tr class="${d.me ? 'me' : ''}"><td class="rk">${d.pos}</td><td class="nm"><i class="f1-bar" style="background:${esc(d.color)}"></i>${esc(d.name)}</td><td class="pt">${d.points}</td></tr>`)
    .join('');
  return `
    <article class="card team f1-card" style="--team:#E10600">
      <header class="team-head"><span class="f1-logo">F1</span><h2>${t('f1.title')}</h2></header>
      <div class="team-body">
        <div class="team-main">
          ${
            f.next
              ? `<div class="row next"><div class="row-label">${t('f1.nextGp', { round: f.next.round })}</div>
                  <div class="opp">${esc(f.next.name)}</div>
                  <div class="row-meta"><span class="when">${t('f1.race', { when: esc(race!.text) })}</span>${q ? `<span>${t('f1.quali', { when: esc(q.text) })}</span>` : ''}</div></div>`
              : `<div class="row"><div class="row-label">${t('f1.nextGp', { round: '–' })}</div><div class="empty-sm">${t('sports.seasonOver')}</div></div>`
          }
          <div class="row">
            <div class="row-label">${t('f1.yourDrivers')}${f.last ? ` · ${esc(f.last.name)}` : ''}</div>
            ${f.favorites
              .map(
                (d) => `<div class="drv"><i class="f1-bar" style="background:${esc(d.color)}"></i><b>${esc(d.name.split(' ').slice(-1)[0])}</b>
                  <span>${d.pos ? `${rank(d.pos)} · ${t('sports.points', { n: d.points })}` : '—'}</span>${d.lastPos ? `<span class="pill soft">${t('f1.lastPos', { pos: d.lastPos })}</span>` : ''}</div>`,
              )
              .join('')}
          </div>
        </div>
        <div class="standing"><div class="row-label">${t('f1.championship')}</div><table class="mini">${rows}</table></div>
      </div>
    </article>`;
}

function tennisLine(row: TennisCard['rows'][number]) {
  const vs = (m: Game) => (m.home.id === row.id ? m.away : m.home);
  const setsText = (m: Game) => {
    const meHome = m.home.id === row.id;
    return (m.tennis?.sets || []).map((s) => (meHome ? `${s.home}-${s.away}` : `${s.away}-${s.home}`)).join(' ');
  };
  if (row.live) return `<span class="live-dot"></span><b>${t('common.live')}</b> ${t('tennis.vs', { name: esc(vs(row.live).name) })} · ${esc(setsText(row.live))}`;
  if (row.next) return `<b>${esc(row.next.tennis?.round || '')}</b> ${t('tennis.vs', { name: esc(vs(row.next).name) })} · ${esc(matchWhen(row.next.start).text)}`;
  if (row.last) {
    const won = (row.last.home.id === row.id ? row.last.home : row.last.away).winner;
    return `<span class="pill ${won ? 'win' : 'loss'}">${t(won ? 'tennis.won' : 'tennis.lost')}</span> ${esc(row.last.tennis?.round || '')} ${t('tennis.vs', { name: esc(vs(row.last).name) })} · ${esc(setsText(row.last))}`;
  }
  return `<span class="empty-sm">${t('tennis.noTournament')}</span>`;
}

function tennisCard(tc: TennisCard) {
  return `
    <article class="card team tennis-card" style="--team:#2E8B57">
      <header class="team-head"><span class="tennis-ball"></span><h2>${t('tennis.title')}</h2></header>
      <div class="tennis-rows">
        ${tc.rows
          .map(
            (r) => `<div class="tennis-row">
              ${crest({ logo: r.flag, name: r.name }, 'md flag')}
              <div class="tr-main">
                <div class="tr-name"><b>${esc(r.name)}</b>${r.rank ? `<span>${rank(r.rank)} ${r.tour.toUpperCase()}</span>` : ''}</div>
                <div class="tr-status">${tennisLine(r)}</div>
                ${r.live || r.next || r.last ? `<div class="tr-tour">${esc((r.live || r.next || r.last)!.tennis?.tournament || '')}</div>` : ''}
              </div>
            </div>`,
          )
          .join('')}
      </div>
    </article>`;
}

function allCards(s: AppState) {
  const d = s.sections.teams?.data;
  const cards = (d?.teams || []).map(teamCard);
  if (d?.f1) cards.push(f1Card(d.f1));
  if (d?.tennis?.rows.length) cards.push(tennisCard(d.tennis));
  return cards;
}

export function sportsPageCount(s: AppState) {
  return Math.max(1, Math.ceil(allCards(s).length / PER_PAGE));
}

/** Spread cards evenly (9 cards → 3+3+3, not 4+4+1). */
function pageSlice<T>(cards: T[], page: number) {
  const pages = Math.max(1, Math.ceil(cards.length / PER_PAGE));
  const size = Math.ceil(cards.length / pages);
  return { pages, list: cards.slice(page * size, page * size + size) };
}

export function renderSports(el: HTMLElement, s: AppState, page = 0) {
  viewer = { features: s.config?.features, country: s.sections.location?.data?.country };
  const cards = allCards(s);
  const { pages, list } = pageSlice(cards, page);
  el.innerHTML = `
    <div class="panel-pad">
      <h1 class="panel-title">${t('sports.title')}${pages > 1 ? `<span class="page-of">${t('common.pageOf', { page: page + 1, pages })}</span>` : ''}</h1>
      ${cards.length ? `<div class="teams-grid n${list.length}">${list.join('')}</div>` : `<div class="empty">${t('sports.empty')}</div>`}
      ${staleLabel(s.sections.teams, s.config?.refresh.teamsMinutes ?? 30)}
    </div>`;
}

/** Show competition `i` of a team card in place (no re-render). */
export function selectCompetition(root: ParentNode, key: string, i: number) {
  const card = root.querySelector<HTMLElement>(`.team[data-team="${CSS.escape(key)}"]`);
  if (!card) return;
  const n = Number(card.dataset.count) || 1;
  const idx = ((i % n) + n) % n;
  compIndex.set(key, idx);
  card.querySelectorAll('.comp-tab').forEach((b, j) => b.classList.toggle('on', j === idx));
  card.querySelectorAll('.comp-slide').forEach((sl, j) => sl.classList.toggle('on', j === idx));
}

/** Advance every multi-competition card on screen. */
export function cycleCompetitions(root: ParentNode, skip: Set<string>) {
  root.querySelectorAll<HTMLElement>('.team.multi').forEach((card) => {
    const key = card.dataset.team!;
    if (!skip.has(key)) selectCompetition(root, key, (compIndex.get(key) ?? 0) + 1);
  });
}
