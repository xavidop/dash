import ICAL from 'ical.js';
import { fetchText } from '../lib/http.js';

/** Default colors by calendar index (when config gives none). */
export const CALENDAR_PALETTE = ['#4f8ef7', '#f2994a', '#27ae60', '#eb5757', '#9b51e0', '#2bb5b8'];

const MAX_OCCURRENCES = 500; // per calendar, emitted into the window
const MAX_ITERATIONS = 20000; // per recurring series (a daily event since ~1970 still reaches today)

// The few Windows zone names Outlook may use without a VTIMEZONE block.
const WINDOWS_ZONES = {
  'Romance Standard Time': 'Europe/Paris',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

/** IANA zone for a TZID string, or null when Intl doesn't know it. */
function ianaZone(tzid) {
  if (!tzid) return null;
  // e.g. "Europe/Madrid", "Romance Standard Time", "/mozilla.org/20050126_1/Europe/Madrid"
  const candidates = [WINDOWS_ZONES[tzid], tzid, tzid.match(/([A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/)?.[1]];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: c }).resolvedOptions().timeZone;
    } catch {
      // not a zone Intl knows
    }
  }
  return null;
}

/** Offset (ms) of `zone` from UTC at instant `ms`. */
function zoneOffset(ms, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC ms for a wall-clock time in `zone`. */
function wallToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, zone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let t = guess - zoneOffset(guess, zone);
  t = guess - zoneOffset(t, zone);
  return t;
}

/** YYYY-MM-DD of instant `ms` in `zone`. */
function ymdIn(ms, zone) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: zone });
}

function addDays(ymd, n) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

function dateStr(t) {
  return `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function isFloating(t) {
  return !t.zone || t.zone === ICAL.Timezone.localTimezone || t.zone.tzid === 'floating';
}

/**
 * UTC ms of an ICAL.Time. Times whose TZID ical.js couldn't resolve (no VTIMEZONE, not registered)
 * come back floating: interpret them in the TZID's IANA zone if Intl knows it, else in `fallbackZone`.
 */
function toUtcMs(t, tzid, fallbackZone) {
  if (!isFloating(t)) return t.toUnixTime() * 1000;
  return wallToUtc(t, ianaZone(tzid) || fallbackZone);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '?';
  }
}

/** Normalize one config entry to { name, url, color }. */
function normalize(entry, i) {
  const c = typeof entry === 'string' ? { url: entry } : { ...entry };
  c.url = String(c.url || '').trim().replace(/^webcals?:\/\//i, 'https://');
  c.color = c.color || CALENDAR_PALETTE[i % CALENDAR_PALETTE.length];
  return c;
}

/**
 * Calendar events from private iCal (ICS) links: Google "secret address", iCloud, Outlook, webcal://.
 * Recurrences (RRULE/RDATE/EXDATE/RECURRENCE-ID) are expanded with ical.js.
 */
export class CalendarProvider {
  constructor({ calendars = [], days = 14, timezone } = {}) {
    this.calendars = (Array.isArray(calendars) ? calendars : [calendars]).filter(Boolean).map(normalize);
    this.days = days;
    this.timezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  async fetch() {
    const now = Date.now();
    const today = ymdIn(now, this.timezone);
    const lastDay = addDays(today, this.days); // exclusive
    const win = {
      now,
      today,
      lastDay,
      endMs: wallToUtc({ year: +lastDay.slice(0, 4), month: +lastDay.slice(5, 7), day: +lastDay.slice(8, 10) }, this.timezone),
    };

    const results = await Promise.allSettled(
      this.calendars.map(async (cal) => {
        const text = await fetchText(cal.url, { timeoutMs: 15000, headers: { Accept: 'text/calendar, */*' } });
        return this.parse(text, cal, win);
      }),
    );

    const events = [];
    const calendars = results.map((r, i) => {
      const cal = this.calendars[i];
      if (r.status === 'fulfilled') {
        events.push(...r.value.events);
        return { name: r.value.name, color: cal.color, ok: true };
      }
      const label = cal.name || hostOf(cal.url);
      const msg = String(r.reason?.message || r.reason).split(cal.url).join(hostOf(cal.url));
      console.warn(`[calendar] ${label} failed:`, msg);
      return { name: cal.name || 'Calendar', color: cal.color, ok: false };
    });
    if (calendars.length && calendars.every((c) => !c.ok)) throw new Error('all calendars failed');

    events.sort((a, b) => sortKey(a, this.timezone) - sortKey(b, this.timezone) || (b.allDay - a.allDay));
    return { events, calendars };
  }

  /** Parse one ICS document into the events inside the window. */
  parse(text, cal, win) {
    const root = new ICAL.Component(ICAL.parse(text));
    const vcal = root.name === 'vcalendar' ? root : root.getFirstSubcomponent('vcalendar') || root;
    for (const vtz of vcal.getAllSubcomponents('vtimezone')) {
      const tzid = vtz.getFirstPropertyValue('tzid');
      if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(vtz);
    }
    const name = cal.name || vcal.getFirstPropertyValue('x-wr-calname') || 'Calendar';
    const out = [];
    const ctx = { cal, name, win, zone: this.timezone, out };

    // Group by UID: masters and their RECURRENCE-ID overrides.
    const byUid = new Map();
    for (const comp of vcal.getAllSubcomponents('vevent')) {
      const uid = comp.getFirstPropertyValue('uid') || `nouid-${byUid.size}`;
      if (!byUid.has(uid)) byUid.set(uid, { master: null, exceptions: [] });
      const g = byUid.get(uid);
      if (comp.hasProperty('recurrence-id')) g.exceptions.push(comp);
      else if (!g.master) g.master = comp;
    }

    for (const [uid, g] of byUid) {
      if (out.length >= MAX_OCCURRENCES) break;
      try {
        if (!g.master) {
          // Orphan overrides (master not in this feed): show them as plain events.
          for (const ex of g.exceptions) {
            const ev = new ICAL.Event(ex, { exceptions: [] });
            this.emit(ctx, uid, ev, ev.recurrenceId, ev.startDate, ev.endDate);
          }
          continue;
        }
        // Pass exceptions explicitly: by default ical.js relates EVERY RECURRENCE-ID event in the
        // calendar to each master, regardless of UID.
        const event = new ICAL.Event(g.master, { exceptions: g.exceptions, strictExceptions: true });
        if (!event.isRecurring()) {
          this.emit(ctx, uid, event, event.startDate, event.startDate, event.endDate);
          continue;
        }
        const seen = new Set();
        const it = event.iterator();
        for (let n = 0, next; n < MAX_ITERATIONS && out.length < MAX_OCCURRENCES && (next = it.next()); n++) {
          const startMs = next.isDate ? Date.parse(`${dateStr(next)}T00:00:00Z`) : toUtcMs(next, tzidOf(g.master, 'dtstart'), ctx.zone);
          // Iterate on the original occurrence time; stop a day past the window (overrides may move a bit).
          if (startMs > win.endMs + 864e5) break;
          const d = event.getOccurrenceDetails(next);
          seen.add(next.toString());
          this.emit(ctx, uid, d.item, d.recurrenceId, d.startDate, d.endDate);
        }
        // Overrides moved into the window from an original time we didn't reach.
        for (const ex of g.exceptions) {
          const exEv = new ICAL.Event(ex, { exceptions: [] });
          const key = exEv.recurrenceId.toString();
          if (!seen.has(key) && event.exceptions[key]) this.emit(ctx, uid, exEv, exEv.recurrenceId, exEv.startDate, exEv.endDate);
        }
      } catch (err) {
        if (process.env.DASH_DEBUG) console.warn(`[calendar] ${name}: skipped event`, err.message);
      }
    }
    return { name, events: out };
  }

  /** Push one occurrence if it's in the window and not cancelled. */
  emit({ cal, name, win, zone, out }, uid, item, recurrenceId, startDate, endDate) {
    if (out.length >= MAX_OCCURRENCES || !startDate) return;
    const comp = item.component;
    if (String(comp.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    const allDay = startDate.isDate;
    let start, end, idStart;
    if (allDay) {
      start = dateStr(startDate);
      end = endDate ? dateStr(endDate) : addDays(start, 1);
      if (end <= start) end = addDays(start, 1);
      if (end <= win.today || start >= win.lastDay) return;
      idStart = recurrenceId?.isDate ? dateStr(recurrenceId) : start;
    } else {
      const startMs = toUtcMs(startDate, tzidOf(comp, 'dtstart'), zone);
      let endMs = endDate ? toUtcMs(endDate, tzidOf(comp, comp.hasProperty('dtend') ? 'dtend' : 'dtstart'), zone) : startMs;
      if (endMs < startMs) endMs = startMs;
      // Drop what already ended (zero-length events stay until their start time passes).
      if ((endMs <= win.now && startMs < win.now) || startMs >= win.endMs) return;
      start = new Date(startMs).toISOString();
      end = new Date(endMs).toISOString();
      idStart = recurrenceId && recurrenceId !== startDate
        ? (recurrenceId.isDate ? dateStr(recurrenceId) : new Date(toUtcMs(recurrenceId, tzidOf(comp, 'recurrence-id') || tzidOf(comp, 'dtstart'), zone)).toISOString())
        : start;
    }
    const summary = comp.getFirstPropertyValue('summary');
    const location = comp.getFirstPropertyValue('location');
    out.push({
      id: `${uid}:${idStart}`,
      title: summary ? String(summary) : null,
      start,
      end,
      allDay,
      location: location ? String(location) : null,
      calendar: name,
      color: cal.color,
    });
  }
}

function tzidOf(comp, propName) {
  return comp.getFirstProperty(propName)?.getParameter('tzid') || null;
}

/** Sort key (ms): all-day events at local midnight of their start date. */
function sortKey(e, zone) {
  if (!e.allDay) return Date.parse(e.start);
  return wallToUtc({ year: +e.start.slice(0, 4), month: +e.start.slice(5, 7), day: +e.start.slice(8, 10) }, zone);
}
