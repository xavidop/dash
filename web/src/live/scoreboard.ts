import type { Game, GameEvent, Baseball } from '../types';
import { esc, seriesLine } from '../format';
import { crest, surfaceColor, shade } from '../ui';
import { ICON } from '../icons';
import { t, tv, ord } from '../i18n';
import { getState } from '../store';
import { channelsFor } from '../panels/sports';

const badge = (g: Game) =>
  g.state === 'final'
    ? `<span class="badge final">${t('common.final')}</span>`
    : g.state === 'break'
      ? `<span class="badge live">${t('common.liveBadge')}</span><span class="badge soft">${esc(g.status)}</span>`
      : `<span class="badge live"><i></i>${t('common.liveBadge')}</span>`;

function header(g: Game) {
  const st = getState();
  const tv = channelsFor(g, { features: st.config?.features, country: st.sections.location?.data?.country });
  return `<header class="lsb-top">
    <div class="lsb-badges">${badge(g)}</div>
    <div class="lsb-league">${esc(g.league.name)}${g.venue ? ` · ${esc(g.venue)}` : ''}${seriesLine(g) ? `<small class="lsb-series">${esc(seriesLine(g))}</small>` : ''}${tv ? `<small class="lsb-tv">${esc(tv)}</small>` : ''}</div>
  </header>`;
}

function bg(g: Game) {
  const h = surfaceColor(g.home);
  const a = surfaceColor(g.away);
  return `style="--home:${h};--home-d:${shade(h, -0.45)};--away:${a};--away-d:${shade(a, -0.45)}"`;
}

// ───────────── Football ─────────────

const EVENT_ICON: Record<string, string> = {
  goal: ICON.ball,
  penalty: ICON.ball,
  'own-goal': ICON.ball,
  red: '<span class="card-ico red"></span>',
  yellow: '<span class="card-ico yellow"></span>',
};

function eventLine(e: GameEvent) {
  const suffix = e.kind === 'penalty' ? ` ${t('live.penaltyShort')}` : e.kind === 'own-goal' ? ` ${t('live.ownGoalShort')}` : '';
  return `<li class="ev ${e.kind}">${EVENT_ICON[e.kind] || ''}<span class="ev-p">${esc(e.player)}${suffix}</span><span class="ev-m">${esc(e.minute)}</span></li>`;
}

const minuteNum = (m: string) => {
  const [base, extra] = m.replace(/'/g, '').split('+').map(Number);
  return (base || 0) + (extra || 0) * 0.2;
};

function timeline(g: Game) {
  const clockMin = g.state === 'final' ? 90 : g.state === 'break' && /descanso/i.test(g.status) ? 45 : Math.min(90, minuteNum(g.status));
  const marks = g.events
    .map((e) => {
      const pct = Math.min(100, (minuteNum(e.minute) / 90) * 100);
      return `<span class="tl-mark ${e.side} ${e.kind}" style="left:${pct.toFixed(1)}%"></span>`;
    })
    .join('');
  return `<div class="timeline">
    <div class="tl-track"><div class="tl-fill" style="transform:scaleX(${(clockMin / 90).toFixed(3)})"></div><span class="tl-ht"></span>${marks}</div>
    <div class="tl-labels"><span>0'</span><span>${t('live.halfLabel')}</span><span>90'</span></div>
  </div>`;
}

export function soccerBoard(g: Game) {
  const notable = (side: 'home' | 'away') => g.events.filter((e) => e.side === side && e.kind !== 'yellow');
  return `
  <div class="lsb soccer ${g.state}" ${bg(g)}>
    <div class="lsb-bg"></div>
    ${header(g)}
    <div class="lsb-main">
      <div class="side home">${crest(g.home, 'xl')}<div class="side-name">${esc(g.home.name)}</div></div>
      <div class="scorebox">
        <div class="score"><span data-score="home">${g.home.score ?? 0}</span><span class="sep">–</span><span data-score="away">${g.away.score ?? 0}</span></div>
        <div class="clock-pill">${g.state === 'final' ? esc(g.status) : esc(g.status)}</div>
      </div>
      <div class="side away">${crest(g.away, 'xl')}<div class="side-name">${esc(g.away.name)}</div></div>
    </div>
    <div class="lsb-events">
      <ul class="evs home">${notable('home').map(eventLine).join('')}</ul>
      <ul class="evs away">${notable('away').map(eventLine).join('')}</ul>
    </div>
    ${timeline(g)}
  </div>`;
}

// ───────────── Baseball ─────────────

function diamond(b: Baseball) {
  const base = (on: boolean, x: number, y: number, label: string) =>
    `<rect class="base ${on ? 'on' : ''}" x="${x - 13}" y="${y - 13}" width="26" height="26" rx="4" transform="rotate(45 ${x} ${y})"><title>${label}</title></rect>`;
  return `<svg class="diamond" viewBox="0 0 160 140" aria-label="Bases">
    <path d="M80 122 L138 64 L80 8 L22 64 Z" class="infield"/>
    ${base(b.bases.second, 80, 18, 'Segunda')}
    ${base(b.bases.third, 30, 64, 'Tercera')}
    ${base(b.bases.first, 130, 64, 'Primera')}
    <path d="M70 116 h20 v8 l-10 9 l-10 -9z" class="plate"/>
  </svg>`;
}

const dots = (n: number, max: number, cls: string) =>
  Array.from({ length: max }, (_, i) => `<i class="${i < n ? `on ${cls}` : ''}"></i>`).join('');

function linescore(g: Game) {
  const ls = g.baseball?.linescore;
  if (!ls) return '';
  const n = Math.max(9, ls.innings.length);
  const cols = Array.from({ length: n }, (_, i) => ls.innings[i] || { n: i + 1, away: null, home: null });
  const cur = g.baseball!.inning;
  const cell = (v: number | null, i: number, half: 'away' | 'home') => {
    const active = g.state !== 'final' && i + 1 === cur && ((half === 'away') === (g.baseball!.half === 'top'));
    return `<td class="${active ? 'cur' : ''}">${v ?? ''}</td>`;
  };
  return `<table class="linescore">
    <thead><tr><th></th>${cols.map((c) => `<th>${c.n}</th>`).join('')}${(tv<string[]>('mlb.rhe') || ['R', 'H', 'E']).map((x) => `<th class="tot">${x}</th>`).join('')}</tr></thead>
    <tbody>
      <tr><th>${esc(g.away.abbr || g.away.name)}</th>${cols.map((c, i) => cell(c.away, i, 'away')).join('')}<td class="tot">${ls.away.r}</td><td class="tot">${ls.away.h}</td><td class="tot">${ls.away.e}</td></tr>
      <tr><th>${esc(g.home.abbr || g.home.name)}</th>${cols.map((c, i) => cell(c.home, i, 'home')).join('')}<td class="tot">${ls.home.r}</td><td class="tot">${ls.home.h}</td><td class="tot">${ls.home.e}</td></tr>
    </tbody>
  </table>`;
}

function person(p: { name: string; headshot: string | null } | null | undefined, role: string) {
  if (!p) return '';
  const pic = p.headshot
    ? `<img src="${esc(p.headshot)}" alt="" onerror="this.style.visibility='hidden'">`
    : `<span class="initials">${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>`;
  return `<div class="person">${pic}<div><div class="role">${role}</div><div class="pname">${esc(p.name)}</div></div></div>`;
}

export function baseballBoard(g: Game) {
  const b = g.baseball;
  const teamRow = (t: Game['home'], side: 'home' | 'away') => {
    const batting = b && g.state !== 'final' && ((side === 'away') === (b.half === 'top'));
    return `<div class="bb-team ${side} ${batting ? 'batting' : ''}" style="--c:${surfaceColor(t)}">
      ${crest(t, 'lg')}<span class="bb-name">${esc(t.name)}</span><span class="bb-score" data-score="${side}">${t.score ?? 0}</span>
    </div>`;
  };
  const inning = b
    ? g.state === 'final'
      ? esc(g.status)
      : `<span class="arrow">${b.half === 'top' ? '▲' : '▼'}</span> ${ord(b.inning, t('grammar.inning') === 'f' ? 'f' : 'm')}${b.inningState === 'Middle' || b.inningState === 'End' ? ` <small>${esc(g.status)}</small>` : ''}`
    : esc(g.status);
  return `
  <div class="lsb baseball ${g.state}" ${bg(g)}>
    <div class="lsb-bg"></div>
    ${header(g)}
    <div class="bb-main">
      <div class="bb-teams">${teamRow(g.away, 'away')}${teamRow(g.home, 'home')}</div>
      <div class="bb-situation">
        <div class="bb-inning">${inning}</div>
        ${b && g.state !== 'final' ? diamond(b) : ''}
        ${
          b && g.state !== 'final'
            ? `<div class="bso">
                <div><b>B</b>${dots(b.balls, 4, 'ball')}</div>
                <div><b>S</b>${dots(b.strikes, 3, 'strike')}</div>
                <div><b>O</b>${dots(b.outs, 3, 'out')}</div>
              </div>`
            : ''
        }
      </div>
    </div>
    <div class="bb-bottom">
      ${linescore(g)}
      <div class="matchup">
        ${g.state !== 'final' ? `${person(b?.pitcher, t('mlb.pitching'))}<span class="vs">vs</span>${person(b?.batter, t('mlb.batting'))}` : ''}
        ${b?.lastPlay ? `<div class="lastplay">${esc(b.lastPlay)}</div>` : ''}
      </div>
    </div>
  </div>`;
}

// ───────────── Basketball, American football, hockey ─────────────

function quartersTable(g: Game) {
  const q = g.periods?.quarters;
  if (!q || (!q.home.length && !q.away.length)) return '';
  // Hockey has 3 periods (+ OT, shootout); basketball and American football 4 quarters (+ OT).
  const regular = g.sport === 'hockey' ? 3 : 4;
  const n = Math.max(regular, q.home.length, q.away.length);
  const label = (i: number) => (i < regular ? ord(i + 1) : g.sport === 'hockey' && i > regular ? 'SO' : i > regular ? `OT${i - regular + 1}` : 'OT');
  const cur = g.state === 'final' ? -1 : (g.periods?.period || 0) - 1;
  const row = (t: Game['home'], vals: number[]) =>
    `<tr><th>${esc(t.abbr || t.name)}</th>${Array.from({ length: n }, (_, i) => `<td class="${i === cur ? 'cur' : ''}">${vals[i] ?? ''}</td>`).join('')}<td class="tot">${t.score ?? 0}</td></tr>`;
  return `<table class="linescore quarters">
    <thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${label(i)}</th>`).join('')}<th class="tot">T</th></tr></thead>
    <tbody>${row(g.home, q.home)}${row(g.away, q.away)}</tbody>
  </table>`;
}

export function periodBoard(g: Game) {
  return `
  <div class="lsb periods ${g.sport} ${g.state}" ${bg(g)}>
    <div class="lsb-bg"></div>
    ${header(g)}
    <div class="lsb-main">
      <div class="side home">${crest(g.home, 'xl')}<div class="side-name">${esc(g.home.name)}</div></div>
      <div class="scorebox">
        <div class="score hoops"><span data-score="home">${g.home.score ?? 0}</span><span class="sep">–</span><span data-score="away">${g.away.score ?? 0}</span></div>
        <div class="clock-pill">${esc(g.status)}</div>
      </div>
      <div class="side away">${crest(g.away, 'xl')}<div class="side-name">${esc(g.away.name)}</div></div>
    </div>
    <div class="bk-bottom">${quartersTable(g)}</div>
  </div>`;
}

// ───────────── Tennis ─────────────

export function tennisBoard(g: Game) {
  const tns = g.tennis;
  const sets = tns?.sets || [];
  const cols = Math.max(3, sets.length);
  const curSet = g.state === 'final' ? -1 : sets.length - 1;
  const row = (p: Game['home'], side: 'home' | 'away') => `
    <div class="tn-row ${p.winner ? 'won' : ''}">
      ${crest({ logo: p.logo, name: p.name, abbr: p.abbr }, 'lg flag')}
      <span class="tn-name">${esc(p.name)}</span>
      <span class="tn-sets">${Array.from({ length: cols }, (_, i) => {
        const v = sets[i]?.[side];
        const other = sets[i]?.[side === 'home' ? 'away' : 'home'];
        const won = v != null && other != null && i !== curSet && v > other;
        return `<b class="${i === curSet ? 'cur' : ''} ${won ? 'won' : ''}">${v ?? ''}</b>`;
      }).join('')}</span>
      <span class="tn-total" data-score="${side}">${p.score ?? 0}</span>
    </div>`;
  return `
  <div class="lsb tennis ${g.state}">
    <div class="lsb-bg court"></div>
    <header class="lsb-top">
      <div class="lsb-badges">${badge(g)}</div>
      <div class="lsb-league">${esc(tns?.tournament || g.league.name)} · ${esc(tns?.round || '')}</div>
    </header>
    <div class="tn-board">
      <div class="tn-head"><span></span><span class="tn-sets">${Array.from({ length: cols }, (_, i) => `<i>${ord(i + 1)}</i>`).join('')}</span><span class="tn-total-h">${t('tennis.sets')}</span></div>
      ${row(g.home, 'home')}
      ${row(g.away, 'away')}
    </div>
    <div class="clock-pill tn-status">${esc(g.status)}</div>
  </div>`;
}

// ───────────── F1 ─────────────

export function f1Board(g: Game) {
  const f = g.f1!;
  const order = f.order.slice(0, 20);
  const mid = Math.ceil(order.length / 2);
  const col = (list: typeof order) =>
    `<ol class="f1-col">${list
      .map((d) => `<li class="${d.me ? 'me' : ''}"><span class="f1-pos">${d.pos}</span>${d.flag ? `<img src="${esc(d.flag)}" alt="">` : ''}<span class="f1-name">${esc(d.name)}</span></li>`)
      .join('')}</ol>`;
  return `
  <div class="lsb f1 ${g.state}">
    <div class="lsb-bg carbon"></div>
    <header class="lsb-top">
      <div class="lsb-badges">${badge(g)}<span class="badge soft">${esc(f.session)}</span></div>
      <div class="lsb-league">${t('f1.title')} · ${esc(f.gp)}${f.lap ? ` · ${t('f1.lap', { n: f.lap })}` : ''}</div>
    </header>
    <div class="f1-board">${col(order.slice(0, mid))}${col(order.slice(mid))}</div>
  </div>`;
}

export function scoreboard(g: Game) {
  switch (g.sport) {
    case 'baseball':
      return baseballBoard(g);
    case 'basketball':
    case 'football':
    case 'hockey':
      return periodBoard(g);
    case 'tennis':
      return tennisBoard(g);
    case 'f1':
      return f1Board(g);
    default:
      return soccerBoard(g);
  }
}
