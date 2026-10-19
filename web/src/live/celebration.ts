import type { Celebration } from '../types';
import { esc } from '../format';
import { crest, surfaceColor, shade, onColor } from '../ui';
import { t } from '../i18n';

const queue: Celebration[] = [];
let busy = false;

/** Full-screen moment when my team scores; a quieter toast when the rival does. */
export function celebrate(root: HTMLElement, c: Celebration, onStart?: (c: Celebration) => void) {
  queue.push(c);
  if (!busy) next(root, onStart);
}

function next(root: HTMLElement, onStart?: (c: Celebration) => void) {
  const c = queue.shift();
  if (!c) {
    busy = false;
    return;
  }
  busy = true;
  onStart?.(c);
  if (c.forMe) bigMoment(root, c, () => next(root, onStart));
  else toast(root, c, () => next(root, onStart));
}

function bigMoment(root: HTMLElement, c: Celebration, done: () => void) {
  const color = surfaceColor(c.team);
  const alt = c.team.altColor && c.team.altColor !== color ? c.team.altColor : shade(color, 0.35);
  const word =
    c.sport === 'baseball'
      ? /home run/i.test(c.detail || '') ? t('live.homeRun') : c.runs > 1 ? t('live.runs') : t('live.run')
      : c.sport === 'football'
        ? c.runs >= 6 ? t('live.touchdown') : t('live.fieldGoal')
        : c.sport === 'hockey'
          ? t('live.hockeyGoal')
          : t('live.goal');
  const letters = [...word].map((ch, i) => `<span style="animation-delay:${(0.25 + i * 0.06).toFixed(2)}s">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.style.cssText = `--c:${color};--c2:${alt};--cd:${shade(color, -0.5)};--fg:${onColor(color)}`;
  el.innerHTML = `
    <div class="cel-rays"></div>
    <div class="cel-ring r1"></div><div class="cel-ring r2"></div><div class="cel-ring r3"></div>
    <div class="cel-content">
      ${crest({ logo: c.team.logo, name: c.team.name }, 'xl cel-crest')}
      <div class="cel-word" style="font-size:min(12rem, ${Math.floor(125 / [...word].length)}vw)">${letters}</div>
      ${c.player ? `<div class="cel-player">${esc(c.player)}</div>` : ''}
      <div class="cel-detail">${esc(c.detail === 'penalty' ? t('live.penalty') : c.detail === 'own-goal' ? t('live.ownGoal') : c.detail || c.team.name)}</div>
      <div class="cel-score">${scoreText(c)}</div>
    </div>
    ${confetti(color, alt)}`;
  root.appendChild(el);
  setTimeout(() => el.classList.add('out'), 7000);
  setTimeout(() => {
    el.remove();
    done();
  }, 7800);
}

function confetti(a: string, b: string) {
  // 28 pieces, transform-only animation: cheap enough for the Surface's GPU.
  let html = '<div class="confetti">';
  for (let i = 0; i < 28; i++) {
    const left = (i * 37) % 100;
    const delay = ((i * 0.13) % 1.4).toFixed(2);
    const dur = (2.6 + ((i * 7) % 10) / 6).toFixed(2);
    const col = i % 3 === 0 ? '#ffffff' : i % 2 ? a : b;
    html += `<i style="left:${left}%;background:${col};animation-delay:${delay}s;animation-duration:${dur}s"></i>`;
  }
  return html + '</div>';
}

function toast(root: HTMLElement, c: Celebration, done: () => void) {
  const el = document.createElement('div');
  el.className = 'score-toast';
  el.style.setProperty('--c', surfaceColor(c.team));
  const what =
    c.sport === 'baseball'
      ? c.runs > 1 ? t('live.rivalRuns', { n: c.runs, team: c.team.name }) : t('live.rivalRun', { team: c.team.name })
      : c.sport === 'football'
        ? `${t('live.rivalScore', { team: c.team.name })} (+${c.runs})`
        : t('live.rivalGoal', { team: c.team.name });
  el.innerHTML = `${crest({ logo: c.team.logo, name: c.team.name }, 'sm')}<div><b>${esc(what)}</b>${c.player ? `<span>${esc(c.player)}</span>` : ''}</div><div class="toast-score">${scoreText(c)}</div>`;
  root.appendChild(el);
  setTimeout(() => el.classList.add('out'), 4500);
  setTimeout(() => {
    el.remove();
    done();
  }, 5000);
}

/** Baseball reads away–home (like the board), football home–away. */
const scoreText = (c: Celebration) => (c.sport === 'baseball' ? `${c.score.away} – ${c.score.home}` : `${c.score.home} – ${c.score.away}`);
