import { getState, subscribe, now } from './store';
import { esc, timeOf } from './format';
import { t } from './i18n';

/**
 * Small always-on extras that sit on top of every screen:
 *  - note reminders: a full-screen card at the reminder time, until tapped
 *  - guest Wi-Fi: a button that shows the network QR code
 */

let reminderEl: HTMLElement;
let wifiBtn: HTMLButtonElement;
let wifiEl: HTMLElement;
let wifiOpen = false;

export const isExtrasOpen = () => wifiOpen || !reminderEl.hidden;

const patchNote = (id: string, body: unknown) =>
  fetch(`/api/notes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ─── Reminders ──────────────────────────────────────────────
function dueReminders() {
  const s = getState();
  if (s.config?.features?.reminders === false) return [];
  return (s.sections.notes?.data || []).filter((n) => n.remindAt && !n.reminded && !n.done && n.remindAt <= now());
}

let shownIds = '';
function checkReminders() {
  const due = dueReminders();
  const ids = due.map((n) => n.id).join(',');
  reminderEl.hidden = !due.length;
  document.body.classList.toggle('reminder-open', !!due.length);
  if (!due.length || ids === shownIds) return;
  shownIds = ids;
  reminderEl.innerHTML = `
    <div class="rm-card">
      <div class="rm-label">${t('reminder.title')}</div>
      ${due.map((n) => `<p class="rm-text">${esc(n.text)}</p><div class="rm-time">${esc(timeOf(new Date(n.remindAt!)))}</div>`).join('')}
      <div class="rm-hint">${t('reminder.dismiss')}</div>
    </div>`;
}

// ─── Guest Wi-Fi ────────────────────────────────────────────
function renderWifiButton() {
  const c = getState().config;
  wifiBtn.hidden = !(c?.features?.wifiQr && c.wifi?.ssid);
  wifiBtn.setAttribute('aria-label', t('wifi.title'));
}

function showWifi(open: boolean) {
  wifiOpen = open;
  wifiEl.hidden = !open;
  if (!open) return;
  const w = getState().config?.wifi;
  if (!w) return showWifi(false);
  wifiEl.innerHTML = `
    <div class="wf-card">
      <h1>${t('wifi.title')}</h1>
      <img class="wf-qr" src="/api/wifi/qr.svg?v=${encodeURIComponent(w.ssid + w.password + w.security)}" alt="">
      <p class="set-hint">${t('wifi.scan')}</p>
      <dl>
        <div><dt>${t('wifi.network')}</dt><dd>${esc(w.ssid)}</dd></div>
        ${w.security !== 'nopass' ? `<div><dt>${t('wifi.password')}</dt><dd class="wf-pass">${esc(w.password)}</dd></div>` : ''}
      </dl>
      <button class="set-done" data-wifi-close>${t('wifi.close')}</button>
    </div>`;
}

export function initExtras() {
  reminderEl = document.createElement('div');
  reminderEl.className = 'reminder-ring';
  reminderEl.hidden = true;
  reminderEl.addEventListener('click', () => {
    for (const n of dueReminders()) patchNote(n.id, { reminded: true });
    reminderEl.hidden = true;
    shownIds = '';
    document.body.classList.remove('reminder-open');
  });

  wifiBtn = document.createElement('button');
  wifiBtn.className = 'wifi-btn';
  wifiBtn.hidden = true;
  wifiBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 20.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM4.9 12.3l1.6 1.6a7.8 7.8 0 0 1 11 0l1.6-1.6a10 10 0 0 0-14.2 0zm-3.2-3.2 1.6 1.6a12.3 12.3 0 0 1 17.4 0l1.6-1.6a14.6 14.6 0 0 0-20.6 0zm6.4 6.4 1.6 1.6a3.3 3.3 0 0 1 4.6 0l1.6-1.6a5.6 5.6 0 0 0-7.8 0z" fill="currentColor"/></svg>`;
  wifiBtn.addEventListener('click', () => showWifi(true));

  wifiEl = document.createElement('section');
  wifiEl.className = 'wifi-sheet';
  wifiEl.hidden = true;
  wifiEl.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-wifi-close]') || e.target === wifiEl) showWifi(false);
  });

  document.body.append(reminderEl, wifiBtn, wifiEl);
  subscribe((_s, changed) => {
    if (changed === 'config') {
      renderWifiButton();
      if (wifiOpen) showWifi(true);
    }
    if (changed === 'notes' || changed === 'config') checkReminders();
  });
  renderWifiButton();
  setInterval(checkReminders, 5000);
}
