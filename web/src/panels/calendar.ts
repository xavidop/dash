import type { AppState, CalendarEvent } from '../types';
import { esc, timeOf, ymdIn, dayLabel } from '../format';
import { staleLabel } from '../ui';
import { t } from '../i18n';
import { now } from '../store';

/** Calendar panel only when a link is configured and the feature is on. */
export const calendarOn = (s: AppState) => !!s.config?.calendar && s.config?.features?.calendar !== false;

/** Events still to come (or in progress), in time order. */
export function upcomingEvents(s: AppState): CalendarEvent[] {
  if (!calendarOn(s)) return [];
  const today = ymdIn(new Date(now()));
  return (s.sections.calendar?.data?.events || []).filter((e) => (e.allDay ? e.end > today : Date.parse(e.end) > now()));
}

/** The day an event is listed under: its start, or today if it's already running. Multi-day
 *  events are listed once, with "until …". */
function dayOf(e: CalendarEvent, today: string) {
  const d = e.allDay ? e.start : ymdIn(new Date(e.start));
  return d < today ? today : d;
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

const title = (e: CalendarEvent) => e.title || t('calendar.untitled');

function row(e: CalendarEvent, day: string) {
  const running = !e.allDay && Date.parse(e.start) <= now();
  const when = e.allDay
    ? `<span class="ev-allday">${t('calendar.allDay')}</span>`
    : running
      ? `<span class="ev-now">${t('calendar.now')}</span><small>${t('calendar.until', { time: timeOf(new Date(e.end)) })}</small>`
      : `<b>${timeOf(new Date(e.start))}</b><small>${timeOf(new Date(e.end))}</small>`;
  const lastDay = e.allDay ? addDays(e.end, -1) : ymdIn(new Date(e.end));
  const multi = lastDay > day ? t('calendar.multiDay', { day: dayLabel(lastDay) }) : '';
  return `<li class="cal-ev ${running ? 'running' : ''}" style="--ev:${esc(e.color)}">
    <div class="ev-when">${when}</div>
    <div class="ev-body"><b>${esc(title(e))}</b>${e.location || multi ? `<small>${esc([e.location, multi].filter(Boolean).join(' · '))}</small>` : ''}</div>
  </li>`;
}

export function renderCalendar(el: HTMLElement, s: AppState) {
  const today = ymdIn(new Date(now()));
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of upcomingEvents(s)) {
    const d = dayOf(e, today);
    byDay.set(d, [...(byDay.get(d) || []), e]);
  }
  const days = [...byDay.keys()].sort();
  const sortDay = (list: CalendarEvent[]) => [...list].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
  const todayList = sortDay(byDay.get(today) || []);
  const rest = days.filter((d) => d !== today);
  const failing = (s.sections.calendar?.data?.calendars || []).filter((c) => !c.ok).map((c) => c.name);

  el.innerHTML = `
    <div class="panel-pad agenda">
      <h1 class="panel-title">${t('calendar.title')}${staleLabel(s.sections.calendar, 15)}</h1>
      <div class="agenda-grid ${todayList.length ? '' : 'free'}">
        <section class="card agenda-today">
          <h2>${t('common.today')}</h2>
          ${todayList.length ? `<ul class="cal-list">${todayList.map((e) => row(e, today)).join('')}</ul>` : `<p class="agenda-free">${t('calendar.freeToday')}</p>`}
        </section>
        <section class="card agenda-next">
          ${
            rest.length
              ? rest
                  .slice(0, 6)
                  .map((d) => `<div class="cal-day"><h2>${esc(dayLabel(d))}</h2><ul class="cal-list">${sortDay(byDay.get(d)!).slice(0, 4).map((e) => row(e, d)).join('')}</ul></div>`)
                  .join('')
              : `<p class="agenda-free">${t('calendar.nothingAhead')}</p>`
          }
        </section>
      </div>
      ${failing.length ? `<p class="agenda-warn">${esc(t('calendar.failing', { names: failing.join(', ') }))}</p>` : ''}
    </div>`;
}
