import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalendarProvider, CALENDAR_PALETTE } from '../server/providers/calendar.js';

const TZ = 'Europe/Madrid';
const HOUR = 3600e3;
const DAY = 864e5;

/** 20261017T101500Z */
const utc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** YYYY-MM-DD in TZ, `n` days from today. */
const ymd = (n = 0) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  return new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
};
const compact = (d) => d.replace(/-/g, '');
/** UTC offset of TZ on a date, in minutes (e.g. 120 in summer). */
const offsetMin = (date) => {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === 'timeZoneName').value; // "GMT+02:00"
  const m = name.match(/([+-])(\d\d):(\d\d)/);
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
};

const VTIMEZONE_MADRID = `BEGIN:VTIMEZONE
TZID:Europe/Madrid
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`;

// A made-up zone only the file defines (Intl doesn't know it): proves the VTIMEZONE is used.
const VTIMEZONE_CUSTOM = `BEGIN:VTIMEZONE
TZID:Custom Plus Five
BEGIN:STANDARD
TZOFFSETFROM:+0500
TZOFFSETTO:+0500
DTSTART:19700101T000000
END:STANDARD
END:VTIMEZONE`;

const ics = (body, extra = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nX-WR-CALNAME:Family\r\n${extra}${body}\r\nEND:VCALENDAR\r\n`.replace(/\r?\n/g, '\r\n');
const vevent = (lines) => `BEGIN:VEVENT\n${lines.join('\n')}\nEND:VEVENT`;

function buildFixture() {
  const now = Date.now();
  const timedStart = Math.floor((now + HOUR) / 60e3) * 60e3;
  const weeklyStart = timedStart - 14 * DAY;
  const madridDate = ymd(3);
  const customDate = ymd(4);
  const events = [
    vevent(['UID:timed-1', `DTSTART:${utc(timedStart)}`, `DTEND:${utc(timedStart + HOUR)}`, 'SUMMARY:Dentist', 'LOCATION:Calle Mayor 1']),
    vevent(['UID:inprogress', `DTSTART:${utc(now - HOUR)}`, `DTEND:${utc(now + HOUR)}`, 'SUMMARY:Ongoing']),
    vevent(['UID:ended', `DTSTART:${utc(now - 3 * HOUR)}`, `DTEND:${utc(now - 2 * HOUR)}`, 'SUMMARY:Over']),
    vevent(['UID:notitle', `DTSTART:${utc(timedStart + 2 * HOUR)}`, `DTEND:${utc(timedStart + 3 * HOUR)}`]),
    // Weekly from two weeks ago: today's occurrence, +7d excluded, +14d moved two hours later.
    vevent([
      'UID:weekly',
      `DTSTART:${utc(weeklyStart)}`,
      `DTEND:${utc(weeklyStart + HOUR)}`,
      'RRULE:FREQ=WEEKLY;COUNT=10',
      `EXDATE:${utc(timedStart + 7 * DAY)}`,
      'SUMMARY:Swimming',
    ]),
    vevent([
      'UID:weekly',
      `RECURRENCE-ID:${utc(timedStart + 14 * DAY)}`,
      `DTSTART:${utc(timedStart + 14 * DAY + 2 * HOUR)}`,
      `DTEND:${utc(timedStart + 14 * DAY + 3 * HOUR)}`,
      'SUMMARY:Swimming (moved)',
    ]),
    // An unrelated override with another UID must not leak into "weekly".
    vevent(['UID:other', `RECURRENCE-ID:${utc(timedStart)}`, `DTSTART:${utc(timedStart + 5 * HOUR)}`, `DTEND:${utc(timedStart + 6 * HOUR)}`, 'SUMMARY:Orphan override']),
    vevent(['UID:trip', `DTSTART;VALUE=DATE:${compact(ymd(-1))}`, `DTEND;VALUE=DATE:${compact(ymd(2))}`, 'SUMMARY:Trip']),
    vevent(['UID:cancelled', `DTSTART:${utc(timedStart + DAY)}`, `DTEND:${utc(timedStart + DAY + HOUR)}`, 'STATUS:CANCELLED', 'SUMMARY:Called off']),
    vevent(['UID:madrid', `DTSTART;TZID=Europe/Madrid:${compact(madridDate)}T100000`, `DTEND;TZID=Europe/Madrid:${compact(madridDate)}T113000`, 'SUMMARY:Madrid meeting']),
    vevent(['UID:custom', `DTSTART;TZID=Custom Plus Five:${compact(customDate)}T100000`, `DTEND;TZID=Custom Plus Five:${compact(customDate)}T110000`, 'SUMMARY:Custom zone']),
    vevent(['UID:unknown-tz', `DTSTART;TZID=Nowhere Standard Time:${compact(customDate)}T100000`, `DTEND;TZID=Nowhere Standard Time:${compact(customDate)}T110000`, 'SUMMARY:Unknown zone']),
    vevent(['UID:far', `DTSTART:${utc(now + 40 * DAY)}`, `DTEND:${utc(now + 40 * DAY + HOUR)}`, 'SUMMARY:Too far']),
  ];
  return { text: ics(events.join('\n'), `${VTIMEZONE_MADRID}\n${VTIMEZONE_CUSTOM}\n`), timedStart, madridDate, customDate };
}

test('parses timed, recurring, all-day, cancelled and time-zoned events', async (t) => {
  const fx = buildFixture();
  t.mock.method(globalThis, 'fetch', async () => new Response(fx.text));
  const p = new CalendarProvider({ calendars: ['https://example.com/a.ics'], days: 21, timezone: TZ });
  const { events, calendars } = await p.fetch();
  const by = (title) => events.filter((e) => e.title === title);

  assert.deepEqual(calendars, [{ name: 'Family', color: CALENDAR_PALETTE[0], ok: true }]);

  const [dentist] = by('Dentist');
  assert.deepEqual(dentist, {
    id: `timed-1:${new Date(fx.timedStart).toISOString()}`,
    title: 'Dentist',
    start: new Date(fx.timedStart).toISOString(),
    end: new Date(fx.timedStart + HOUR).toISOString(),
    allDay: false,
    location: 'Calle Mayor 1',
    calendar: 'Family',
    color: CALENDAR_PALETTE[0],
  });
  assert.equal(by('Ongoing').length, 1, 'in-progress event kept');
  assert.equal(by('Over').length, 0, 'ended event dropped');
  assert.equal(by('Too far').length, 0);
  assert.equal(events.find((e) => e.id.startsWith('notitle:')).title, null);

  // Weekly: today's occurrence, EXDATE skipped, overridden one moved and renamed.
  const swims = by('Swimming');
  assert.deepEqual(swims.map((e) => e.start), [new Date(fx.timedStart).toISOString()]);
  const [moved] = by('Swimming (moved)');
  assert.equal(moved.start, new Date(fx.timedStart + 14 * DAY + 2 * HOUR).toISOString());
  assert.equal(moved.id, `weekly:${new Date(fx.timedStart + 14 * DAY).toISOString()}`, 'id uses the original occurrence');
  assert.equal(events.filter((e) => e.id.startsWith('weekly:')).length, 2);
  assert.equal(by('Orphan override').length, 1, 'override without master shown on its own');

  const [trip] = by('Trip');
  assert.deepEqual([trip.allDay, trip.start, trip.end], [true, ymd(-1), ymd(2)]);

  assert.equal(by('Called off').length, 0);

  const [madrid] = by('Madrid meeting');
  const off = offsetMin(fx.madridDate);
  assert.equal(madrid.start, new Date(Date.parse(`${fx.madridDate}T10:00:00Z`) - off * 60e3).toISOString());
  assert.equal(madrid.end, new Date(Date.parse(`${fx.madridDate}T11:30:00Z`) - off * 60e3).toISOString());

  assert.equal(by('Custom zone')[0].start, `${fx.customDate}T05:00:00.000Z`, 'VTIMEZONE-only zone');
  const unknownOff = offsetMin(fx.customDate);
  assert.equal(
    by('Unknown zone')[0].start,
    new Date(Date.parse(`${fx.customDate}T10:00:00Z`) - unknownOff * 60e3).toISOString(),
    'unknown TZID falls back to the configured timezone',
  );

  // Sorted by start (all-day trip that began yesterday comes first).
  assert.equal(events[0].title, 'Trip');
  const timed = events.filter((e) => !e.allDay).map((e) => Date.parse(e.start));
  assert.deepEqual(timed, [...timed].sort((a, b) => a - b));
});

test('webcal:// is fetched over https; config name and color win', async (t) => {
  const fx = buildFixture();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(fx.text));
  const p = new CalendarProvider({
    calendars: [{ name: 'Work', url: 'webcal://p01-caldav.icloud.com/published/2/SECRET', color: '#123456' }],
    timezone: TZ,
  });
  const { events, calendars } = await p.fetch();
  assert.equal(fetchMock.mock.calls[0].arguments[0], 'https://p01-caldav.icloud.com/published/2/SECRET');
  assert.deepEqual(calendars, [{ name: 'Work', color: '#123456', ok: true }]);
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.calendar === 'Work' && e.color === '#123456'));
});

test('one failing calendar does not break the others; secrets are not logged; all failing throws', async (t) => {
  const fx = buildFixture();
  t.mock.method(globalThis, 'fetch', async (url) =>
    String(url).includes('broken') ? new Response('nope', { status: 500 }) : new Response(fx.text),
  );
  const warn = t.mock.method(console, 'warn', () => {});
  const p = new CalendarProvider({
    calendars: ['https://calendar.google.com/calendar/ical/broken/private-SECRET123/basic.ics', 'https://example.com/ok.ics'],
    timezone: TZ,
  });
  const { events, calendars } = await p.fetch();
  assert.deepEqual(calendars.map((c) => [c.ok, c.color]), [[false, CALENDAR_PALETTE[0]], [true, CALENDAR_PALETTE[1]]]);
  assert.ok(events.length > 0 && events.every((e) => e.color === CALENDAR_PALETTE[1]));
  const logged = warn.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.ok(logged.includes('calendar.google.com'));
  assert.ok(!logged.includes('SECRET123'), logged);

  const allBad = new CalendarProvider({ calendars: ['https://x.test/broken.ics'], timezone: TZ });
  await assert.rejects(allBad.fetch(), /all calendars failed/);
});
