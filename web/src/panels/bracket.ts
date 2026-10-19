// Playoff bracket: one column per round, each tie with both sides, series wins (or the score /
// aggregate), the winner highlighted and the loser faded. Conferences (East/West, AL/NL, AFC/NFC)
// are labelled inside each column.
import type { AppState, Bracket } from '../types';
import { esc, matchWhen } from '../format';
import { crest } from '../ui';
import { t } from '../i18n';

export const bracketsOf = (s: AppState): Bracket[] => (s.config?.features?.brackets === false ? [] : s.sections.brackets?.data?.brackets || []);

/** My teams in this sport (ids are only unique within a sport: NHL 21 isn't MLB 21). */
function myIds(s: AppState, sport: string) {
  return new Set((s.sections.teams?.data?.teams || []).filter((c) => c.sport === sport).map((c) => c.teamId).filter(Boolean) as string[]);
}

type Side = Bracket['rounds'][number]['matchups'][number]['a'];

function side(x: Side, won: boolean | null, mine: Set<string>) {
  const value = x.wins ?? x.score;
  return `<div class="bk-side ${won === true ? 'won' : won === false ? 'lost' : ''} ${mine.has(x.id) ? 'me' : ''}">
    ${crest({ logo: x.logo, name: x.name, abbr: x.abbr }, 'xs')}<span class="bk-name">${esc(x.name)}</span><b class="bk-val">${value ?? ''}</b>
  </div>`;
}

export function renderBracket(el: HTMLElement, s: AppState, key: string) {
  const b = bracketsOf(s).find((x) => x.key === key);
  if (!b) {
    el.innerHTML = '';
    return;
  }
  const mine = myIds(s, b.sport);
  const cols = b.rounds
    .map((r) => {
      let lastConf: string | null | undefined;
      const boxes = r.matchups
        .map((m) => {
          const label = m.conf && m.conf !== lastConf ? `<div class="bk-conf">${esc(m.conf)}</div>` : '';
          lastConf = m.conf;
          const decided = m.winner === 'a' || m.winner === 'b';
          const foot = m.live
            ? `<span class="bk-live"><span class="live-dot"></span>${esc(m.summary || t('common.live'))}</span>`
            : m.summary
              ? esc(m.summary)
              : m.next
                ? esc(matchWhen(m.next.start).text)
                : '';
          return `${label}<div class="bk-box ${m.live ? 'live' : ''}">
            ${side(m.a, decided ? m.winner === 'a' : null, mine)}
            ${side(m.b, decided ? m.winner === 'b' : null, mine)}
            ${foot ? `<div class="bk-foot">${foot}</div>` : ''}
          </div>`;
        })
        .join('');
      // Busy rounds (8 ties) get compact boxes: the faded loser already tells the result.
      return `<section class="bk-col"><h2 class="bk-round">${esc(r.name)}</h2><div class="bk-list ${r.matchups.length > 6 ? 'dense' : ''}">${boxes}</div></section>`;
    })
    .join('');
  el.innerHTML = `
    <div class="panel-pad bracket">
      <h1 class="panel-title">${t('brackets.title')}<span class="page-of">${esc(b.name)}</span></h1>
      <div class="bk-grid" style="--cols:${b.rounds.length}">${cols}</div>
    </div>`;
}
