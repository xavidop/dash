import type { AppState, Countdown, Game } from '../types';
import { esc, matchWhen, localTime, timeOf, localHM } from '../format';
import { visibleNotes } from './notes';
import { upcomingEvents } from './calendar';
import { t, defaultLocale } from '../i18n';
import { now } from '../store';

interface Chip {
  cls: string;
  text: string;
  sub?: string;
}

const isToday = (iso: string) => matchWhen(iso).label === t('common.today');
const scoreOf = (g: Game) => `${g.home.score ?? 0}–${g.away.score ?? 0}`;

/** Days from today to `ymd` in the configured timezone (0 = today). */
function daysUntil(ymd: string, s: AppState) {
  const tz = s.config?.timezone;
  const today = new Date(now()).toLocaleDateString('en-CA', { timeZone: tz });
  return Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
}

/** Next occurrence of a countdown (yearly ones roll over to next year). */
export function nextOccurrence(c: Countdown, s: AppState) {
  if (!c.yearly) return { date: c.date, days: daysUntil(c.date, s) };
  const year = Number(new Date(now()).toLocaleDateString('en-CA', { timeZone: s.config?.timezone }).slice(0, 4));
  let date = `${year}${c.date.slice(4)}`;
  if (daysUntil(date, s) < 0) date = `${year + 1}${c.date.slice(4)}`;
  return { date, days: daysUntil(date, s) };
}

/** Moon age in days since a known new moon (2000-01-06 18:14 UTC), mean synodic month. */
export function moonPhase(ts = now()) {
  const SYNODIC = 29.530588853;
  const age = ((((ts - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % SYNODIC) + SYNODIC) % SYNODIC;
  // Only the four principal phases are worth a chip (±1 day around each).
  const near = (x: number) => Math.abs(age - x) <= 1 || Math.abs(age - x - SYNODIC) <= 1;
  if (near(0)) return 'new';
  if (near(SYNODIC / 4)) return 'firstQuarter';
  if (near(SYNODIC / 2)) return 'full';
  if (near((SYNODIC * 3) / 4)) return 'lastQuarter';
  return null;
}

/** Warnings can list dozens of zones ("San Luis Obispo County Beaches; …"): show the one that
 *  names this city if any, else the first, and how many more. */
function shortArea(area: string, s: AppState) {
  const parts = area.split(/\s*;\s*/).filter(Boolean);
  if (parts.length <= 1) return area;
  const city = (s.sections.location?.data?.city || '').toLowerCase();
  const pick = parts.find((p) => city && p.toLowerCase().includes(city)) || parts[0];
  return `${pick} +${parts.length - 1}`;
}

const price = (v: number) => v.toLocaleString(defaultLocale(), { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** "Today" chips for the home screen: what matters today, at a glance. */
export function todayChips(s: AppState): Chip[] {
  const f = s.config?.features;
  const on = (k: keyof NonNullable<typeof f>) => f?.[k] !== false;
  const chips: Chip[] = [];

  if (on('alerts')) {
    for (const a of s.sections.alerts?.data?.alerts || []) {
      chips.push({ cls: `alert ${a.level}`, text: a.event, sub: `${shortArea(a.area, s)} · ${t('today.until', { time: timeOf(new Date(a.expires)) })}` });
    }
  }

  // Bin collection: "Recycling goes out tonight" the evening before, or "Recycling today".
  const tz = s.config?.timezone;
  const dowOf = (offset: number) => new Date(`${new Date(now() + offset * 864e5).toLocaleDateString('en-CA', { timeZone: tz })}T12:00:00Z`).getUTCDay();
  for (const b of s.config?.bins || []) {
    if (b.evening && b.weekdays.includes(dowOf(1)) && localHM().h >= 12) chips.push({ cls: 'bins', text: t('today.binsTonight', { name: b.name }) });
    else if (!b.evening && b.weekdays.includes(dowOf(0))) chips.push({ cls: 'bins', text: t('today.binsToday', { name: b.name }) });
  }

  const hol = s.sections.holidays?.data;
  if (on('holidays') && hol?.today) chips.push({ cls: 'holiday', text: t('today.holidayToday', { name: hol.today.name }) });
  else if (on('holidays') && hol?.tomorrow) chips.push({ cls: 'holiday', text: t('today.holidayTomorrow', { name: hol.tomorrow.name }) });

  const d = s.sections.teams?.data;
  const live = (s.sections.live?.data?.games || []).filter((g) => g.mine && (g.state === 'live' || g.state === 'break'));
  for (const card of d?.teams || []) {
    const g = live.find((x) => x.home.id === card.teamId || x.away.id === card.teamId);
    if (g) chips.push({ cls: 'sport live', text: t('today.playsLive', { team: card.name, score: scoreOf(g) }), sub: g.status });
    else if (card.next && card.next.state === 'pre' && isToday(card.next.start) && !card.next.timeTBD) {
      const opp = card.next.home.id === card.teamId ? card.next.away : card.next.home;
      chips.push({ cls: 'sport', text: t('today.playsToday', { team: card.name, time: matchWhen(card.next.start).time }), sub: `vs ${opp.name}` });
    }
  }
  // Calendar: what's left today, then the first thing tomorrow morning if today is clear.
  const todayYmd = new Date(now()).toLocaleDateString('en-CA', { timeZone: s.config?.timezone });
  const events = upcomingEvents(s);
  const evToday = events.filter((e) => (e.allDay ? e.start <= todayYmd : isToday(e.start)));
  for (const e of evToday.slice(0, 3)) {
    const when = e.allDay ? t('calendar.allDay') : Date.parse(e.start) <= now() ? t('calendar.now') : timeOf(new Date(e.start));
    chips.push({ cls: 'event', text: `${when} · ${e.title || t('calendar.untitled')}`, sub: e.location || undefined });
  }
  if (!evToday.length && events[0] && !events[0].allDay && matchWhen(events[0].start).label === t('common.tomorrow')) {
    chips.push({ cls: 'event', text: t('calendar.tomorrowAt', { time: timeOf(new Date(events[0].start)), title: events[0].title || t('calendar.untitled') }) });
  }

  const f1Today = d?.f1?.next?.sessions.find((x) => isToday(x.start));
  if (f1Today) chips.push({ cls: 'sport', text: t('today.f1Today', { session: f1Today.name, time: matchWhen(f1Today.start).time }), sub: d!.f1!.next!.name });
  for (const r of d?.tennis?.rows || []) {
    if (r.next && isToday(r.next.start)) chips.push({ cls: 'sport', text: t('today.tennisToday', { player: r.name, time: matchWhen(r.next.start).time }) });
  }

  if (on('reminders')) {
    for (const n of visibleNotes(s)) {
      if (n.remindAt && !n.reminded && !n.done && n.remindAt > now() && isToday(new Date(n.remindAt).toISOString())) {
        chips.push({ cls: 'reminder', text: t('today.reminder', { time: timeOf(new Date(n.remindAt)), text: n.text.length > 40 ? `${n.text.slice(0, 38)}…` : n.text }) });
      }
    }
  }

  if (on('countdowns')) {
    const within = s.config?.countdownDays ?? 30;
    const upcoming = (s.sections.countdowns?.data || [])
      .map((c) => ({ c, ...nextOccurrence(c, s) }))
      .filter((x) => x.days >= 0 && x.days <= within)
      .sort((a, b) => a.days - b.days)
      .slice(0, 2);
    for (const x of upcoming) {
      const text = x.days === 0 ? t('today.countdownToday', { title: x.c.title }) : x.days === 1 ? t('today.countdownTomorrow', { title: x.c.title }) : t('today.countdownDays', { n: x.days, title: x.c.title });
      chips.push({ cls: `countdown ${x.days <= 1 ? 'soon' : ''}`, text });
    }
  }

  const w = s.sections.weather?.data;
  const rain = w?.rainSoon;
  if (rain) chips.push({ cls: 'rain', text: rain.now ? t('today.rainNow', { p: rain.prob }) : t('today.rainAt', { time: localTime(rain.time), p: rain.prob }) });

  // UV: worth a chip from "high" (6+) and only while the sun is still up.
  const uv = w?.uvMax;
  if (on('uv') && uv != null && uv >= 6 && localHM().h < 17) chips.push({ cls: `uv ${uv >= 8 ? 'veryHigh' : 'high'}`, text: t(uv >= 8 ? 'today.uvVeryHigh' : 'today.uv', { n: uv }) });

  const power = s.sections.electricity?.data;
  if (on('electricity') && power) {
    const hour = localHM().h;
    if (power.cheapest && power.cheapest.end > hour) {
      chips.push({ cls: 'power cheap', text: t('today.powerCheapest', { start: String(power.cheapest.start).padStart(2, '0'), end: String(power.cheapest.end).padStart(2, '0') }), sub: `${price(power.cheapest.avg)} ${t('power.unit')}` });
    }
    if (power.now && power.now.level !== 'mid') {
      chips.push({ cls: `power ${power.now.level}`, text: t('today.powerNow', { price: price(power.now.price), level: t(`power.levels.${power.now.level}`) }) });
    }
  }

  const air = s.sections.airQuality?.data;
  if (on('airQuality')) {
    if (air?.level) chips.push({ cls: `air ${air.level}`, text: t('air.aqi', { level: t(`air.levels.${air.level}`), aqi: air.aqi ?? '' }) });
    const pollen = air?.pollen?.[0];
    if (pollen && pollen.level !== 'low') {
      chips.push({ cls: `pollen ${pollen.level}`, text: t('air.pollen', { type: t(`air.pollenTypes.${pollen.type}`), level: t(`air.pollenLevels.${pollen.level}`) }) });
    } else if (pollen) chips.push({ cls: 'pollen low', text: t('air.pollenLow') });
  }

  const moon = on('moon') ? moonPhase() : null;
  if (moon) chips.push({ cls: 'moon', text: t(`today.moon.${moon}`) });

  const pinned = visibleNotes(s).find((n) => n.pinned && !n.done);
  if (pinned) chips.push({ cls: 'note', text: t('today.pinned', { text: pinned.text.length > 48 ? `${pinned.text.slice(0, 46)}…` : pinned.text }) });

  return chips.slice(0, 9);
}

export function renderTodayStrip(s: AppState) {
  const chips = todayChips(s);
  if (!chips.length) return '';
  return `<section class="today-strip" aria-label="${esc(t('today.title'))}">
    ${chips.map((c) => `<div class="today-chip ${esc(c.cls)}"><span class="tc-dot"></span><div><b>${esc(c.text)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</div></div>`).join('')}
  </section>`;
}
