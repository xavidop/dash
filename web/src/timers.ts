import type { Timer } from './types';
import { getState, subscribe, now } from './store';
import { esc } from './format';
import { t } from './i18n';

const PRESETS = [1, 3, 5, 10, 15, 20, 30, 45, 60];

let open = false;
let custom = 8; // minutes for the custom stepper
let label = '';
let btn: HTMLButtonElement;
let panel: HTMLElement;
let pills: HTMLElement;
let ring: HTMLElement;

export const isTimersOpen = () => open;

const timers = (): Timer[] => getState().sections.timers?.data?.timers || [];
const remaining = (tm: Timer) => Math.max(0, Math.ceil((tm.endsAt - now()) / 1000));

function fmt(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const api = (url: string, method: string, body?: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

// ─── Sound (Web Audio: no files; unlocked by the first touch) ──
let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
  } catch {}
}
function chime() {
  if (!audio || audio.state !== 'running') return;
  const t0 = audio.currentTime;
  [0, 0.22, 0.44].forEach((dt, i) => {
    const o = audio!.createOscillator();
    const g = audio!.createGain();
    o.type = 'sine';
    o.frequency.value = i === 2 ? 1175 : 880;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.2);
    o.connect(g).connect(audio!.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.22);
  });
}

// ─── Rendering ──────────────────────────────────────────────
function renderPanel() {
  const list = timers();
  panel.innerHTML = `
    <div class="tm-card">
      <header class="tm-head"><h1>${t('timers.title')}</h1><button class="set-done" data-tm="close">${t('timers.close')}</button></header>
      <section>
        <h2>${t('timers.add')}</h2>
        <div class="tm-presets">${PRESETS.map((m) => `<button class="tm-preset" data-tm="start" data-min="${m}">${t('timers.minutes', { n: m })}</button>`).join('')}</div>
        <div class="tm-custom">
          <span>${t('timers.custom')}</span>
          <button class="icon-btn" data-tm="minus">−</button>
          <b data-custom>${t('timers.minutes', { n: custom })}</b>
          <button class="icon-btn" data-tm="plus">+</button>
          <input class="set-input" maxlength="40" placeholder="${esc(t('timers.labelPlaceholder'))}" value="${esc(label)}" data-tm-label aria-label="${esc(t('timers.label'))}">
          <button class="btn-primary" data-tm="start" data-min="${custom}">${t('timers.start')}</button>
        </div>
      </section>
      <section>
        <ul class="tm-list">${
          list.length
            ? list
                .map(
                  (tm) => `<li data-id="${esc(tm.id)}">
                    <span class="tm-left" data-left="${esc(tm.id)}">${fmt(remaining(tm))}</span>
                    <span class="tm-label">${esc(tm.label || t('timers.timer'))}</span>
                    <button class="icon-btn wide" data-tm="extend" data-id="${esc(tm.id)}">${t('timers.plus1')}</button>
                    <button class="icon-btn danger" data-tm="stop" data-id="${esc(tm.id)}" aria-label="${esc(t('timers.stop'))}">✕</button>
                  </li>`,
                )
                .join('')
            : `<p class="set-hint">${t('timers.none')}</p>`
        }</ul>
      </section>
    </div>`;
}

function renderPills() {
  const running = timers().filter((tm) => remaining(tm) > 0);
  pills.innerHTML = running
    .map((tm) => `<button class="timer-pill" data-tm="open"><i></i><b data-left="${esc(tm.id)}">${fmt(remaining(tm))}</b>${tm.label ? `<span>${esc(tm.label)}</span>` : ''}</button>`)
    .join('');
}

let lastChime = 0;
function renderRing() {
  const done = timers().filter((tm) => remaining(tm) === 0);
  ring.hidden = !done.length;
  if (!done.length) return;
  const labels = done.map((tm) => tm.label || t('timers.timer')).join(' · ');
  if (ring.dataset.labels !== labels) {
    ring.dataset.labels = labels;
    ring.innerHTML = `<div class="tr-pulse"></div><div class="tr-content"><div class="tr-word">${t('timers.done')}</div><div class="tr-label">${esc(labels)}</div><div class="tr-hint">${t('timers.dismiss')}</div></div>`;
  }
  if (Date.now() - lastChime > 1600) {
    lastChime = Date.now();
    chime();
  }
}

function tick() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-left]')) {
    const tm = timers().find((x) => x.id === el.dataset.left);
    if (tm) el.textContent = fmt(remaining(tm));
  }
  if (timers().some((tm) => remaining(tm) === 0) === ring.hidden) {
    renderPills();
    if (open) renderPanel();
  }
  renderRing();
}

// ─── Actions ────────────────────────────────────────────────
function show(v: boolean) {
  open = v;
  panel.hidden = !v;
  document.body.classList.toggle('timers-open', v);
  if (v) renderPanel();
}

async function onClick(e: Event) {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tm]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.tm) {
    case 'open':
      return show(true);
    case 'close':
      return show(false);
    case 'minus':
    case 'plus':
      custom = Math.min(180, Math.max(1, custom + (el.dataset.tm === 'plus' ? (custom >= 10 ? 5 : 1) : custom > 10 ? -5 : -1)));
      return renderPanel();
    case 'start': {
      const res = await api('/api/timers', 'POST', { seconds: Number(el.dataset.min) * 60, label });
      if (!res.ok) alertMax();
      label = '';
      return;
    }
    case 'extend':
      return void api(`/api/timers/${id}`, 'PATCH', { addSeconds: 60 });
    case 'stop':
      return void api(`/api/timers/${id}`, 'DELETE');
  }
}

function alertMax() {
  const b = panel.querySelector('h2');
  if (b) b.textContent = t('timers.max');
}

export function initTimers() {
  btn = document.createElement('button');
  btn.className = 'timer-btn';
  btn.dataset.tm = 'open';
  btn.setAttribute('aria-label', t('timers.title'));
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 2h10v2h-1v3.2a4 4 0 0 1-1.6 3.2L12.6 12l1.8 1.6A4 4 0 0 1 16 16.8V20h1v2H7v-2h1v-3.2a4 4 0 0 1 1.6-3.2l1.8-1.6-1.8-1.6A4 4 0 0 1 8 7.2V4H7zm3 2v3.2c0 .6.3 1.2.8 1.6l1.2 1 1.2-1c.5-.4.8-1 .8-1.6V4zm2 10.2-1.2 1c-.5.4-.8 1-.8 1.6V20h4v-3.2c0-.6-.3-1.2-.8-1.6z" fill="currentColor"/></svg>`;
  panel = document.createElement('section');
  panel.className = 'timers';
  panel.hidden = true;
  pills = document.createElement('div');
  pills.className = 'timer-pills';
  ring = document.createElement('div');
  ring.className = 'timer-ring';
  ring.hidden = true;
  document.body.append(btn, panel, pills, ring);

  for (const el of [btn, panel, pills]) el.addEventListener('click', onClick);
  panel.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches('[data-tm-label]')) label = el.value;
  });
  // Tap the alarm anywhere to stop every finished timer.
  ring.addEventListener('click', () => {
    for (const tm of timers().filter((x) => remaining(x) === 0)) api(`/api/timers/${tm.id}`, 'DELETE');
  });
  document.addEventListener('pointerdown', unlockAudio, { capture: true });

  subscribe((_s, changed) => {
    if (changed === 'timers' || changed === 'config') {
      btn.setAttribute('aria-label', t('timers.title'));
      renderPills();
      ring.dataset.labels = '';
      if (open) renderPanel();
    }
  });
  renderPills();
  setInterval(tick, 500);
}
