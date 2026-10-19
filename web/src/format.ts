import { now, getState } from './store';
import { t, defaultLocale } from './i18n';

/** Formatters follow config (locale, timezone, 24h clock) and are rebuilt when it changes. */
let cacheKey = '';
let F: Record<string, Intl.DateTimeFormat> = {};

function fmt() {
  const c = getState().config;
  const locale = c?.locale || defaultLocale();
  const timeZone = c?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hour12 = c ? !c.clock24h : false;
  const key = `${locale}|${timeZone}|${hour12}`;
  if (key !== cacheKey) {
    cacheKey = key;
    const mk = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone, ...o });
    F = {
      time: mk({ hour: '2-digit', minute: '2-digit', hour12 }),
      clock: mk({ hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit', hour12 }),
      hm24: mk({ hour: '2-digit', minute: '2-digit', hour12: false }),
      longDate: mk({ weekday: 'long', day: 'numeric', month: 'long' }),
      shortDay: mk({ weekday: 'short' }),
      dayMonth: mk({ weekday: 'short', day: 'numeric', month: 'short' }),
      hour: mk({ hour: 'numeric', hour12 }),
      ymd: new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }),
    };
  }
  return F;
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Big clock text ("14:06" or "2:06"). */
export const clock = (d = new Date(now())) => fmt().clock.format(d).replace(/\s?[AP]M$/i, '');
export const ampm = (d = new Date(now())) => (getState().config?.clock24h === false ? (fmt().clock.formatToParts(d).find((p) => p.type === 'dayPeriod')?.value ?? '') : '');
export const timeOf = (d: Date) => fmt().time.format(d);
export const longDate = (d = new Date(now())) => fmt().longDate.format(d);
const ymd = (d: Date) => fmt().ymd.format(d);

/** Wall-clock hours/minutes in the configured timezone. */
export function localHM(d = new Date(now())) {
  const [h, m] = fmt().hm24.format(d).split(':').map(Number);
  return { h: h % 24, m, minutes: (h % 24) * 60 + m };
}

export function greeting(d = new Date(now())) {
  const { h } = localHM(d);
  if (h >= 6 && h < 13) return t('greeting.morning');
  if (h >= 13 && h < 21) return t('greeting.afternoon');
  return t('greeting.evening');
}

/** Open-Meteo returns local times without offset ("2026-10-16T08:12"). */
export function localTime(s: string) {
  if (getState().config?.clock24h === false) {
    const [h, m] = s.slice(11, 16).split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  return s.slice(11, 16);
}
export function hourLabel(s: string) {
  const h = Number(s.slice(11, 13));
  if (getState().config?.clock24h === false) return `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
  return `${String(h).padStart(2, '0')} h`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function dayName(dateStr: string) {
  const today = ymd(new Date(now()));
  const tomorrow = ymd(new Date(now() + 864e5));
  if (dateStr === today) return t('common.today');
  if (dateStr === tomorrow) return t('common.tomorrow');
  return cap(fmt().shortDay.format(new Date(dateStr + 'T12:00:00Z')).replace('.', ''));
}

/** "20 min ago", "3 h ago", "yesterday" (localized). */
export function ago(iso: string | number | null) {
  if (iso == null) return '';
  const ts = typeof iso === 'number' ? iso : Date.parse(iso);
  const mins = Math.max(0, Math.round((now() - ts) / 60e3));
  if (mins < 1) return t('common.now');
  if (mins < 60) return t('common.minutesAgo', { n: mins });
  const h = Math.round(mins / 60);
  if (h < 24) return t('common.hoursAgo', { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? t('common.yesterday').toLowerCase() : t('common.daysAgo', { n: d });
}

/** Match date in the configured timezone: "Today, 21:00", "Sat 24 Oct, 16:30". */
export function matchWhen(iso: string, tbd = false) {
  const d = new Date(iso);
  const day = ymd(d);
  const today = ymd(new Date(now()));
  const tomorrow = ymd(new Date(now() + 864e5));
  const yesterday = ymd(new Date(now() - 864e5));
  const time = tbd ? t('common.tbd') : fmt().time.format(d);
  let label: string;
  if (day === today) label = t('common.today');
  else if (day === tomorrow) label = t('common.tomorrow');
  else if (day === yesterday) label = t('common.yesterday');
  else label = fmt().dayMonth.format(d).replace(/\./g, '');
  return { label, time, text: `${label}, ${time}` };
}

export const capitalize = cap;

/** Minutes since midnight for "HH:MM". */
export const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
};

export function number(n: number, digits = 2) {
  const locale = getState().config?.locale || defaultLocale();
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** Playoff context for a game: "West Finals - Game 2 · Series tied 1-1" (empty in the regular season). */
export const seriesLine = (g: { stage?: string | null; series?: string | null }) => [g.stage, g.series].filter(Boolean).join(' · ');

/** YYYY-MM-DD of an instant in the configured timezone. */
export const ymdIn = (d: Date) => fmt().ymd.format(d);

/** "Today" / "Tomorrow" / "Sat 24 Oct" for a YYYY-MM-DD day. */
export function dayLabel(day: string) {
  const today = ymd(new Date(now()));
  if (day === today) return t('common.today');
  if (day === ymd(new Date(now() + 864e5))) return t('common.tomorrow');
  return cap(fmt().dayMonth.format(new Date(`${day}T12:00:00Z`)).replace(/\./g, ''));
}
