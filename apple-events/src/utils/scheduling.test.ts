/**
 * scheduling.test.ts
 * Covers the busy/free maths that the planning and study-block tools depend on.
 */

import type { CalendarEvent } from '../types/index.js';
import {
  buildAgendaEntries,
  expandWeeklyDates,
  findConflicts,
  findFreeSlots,
  formatDuration,
  isWithinAnyRange,
  mergeIntervals,
  parseClockTime,
  parseEventDate,
  toBusyIntervals,
} from './scheduling.js';

const at = (day: number, hour: number, minute = 0): Date =>
  new Date(2026, 8, day, hour, minute, 0);

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: overrides.id ?? 'id',
  title: overrides.title ?? 'Event',
  calendar: overrides.calendar ?? 'Personal',
  startDate: overrides.startDate ?? '2026-09-08T10:00:00-04:00',
  endDate: overrides.endDate ?? '2026-09-08T11:00:00-04:00',
  isAllDay: overrides.isAllDay ?? false,
  ...overrides,
});

describe('parseEventDate', () => {
  it('parses timed ISO output with an offset', () => {
    const parsed = parseEventDate('2026-09-08T10:00:00-04:00');
    expect(parsed?.toISOString()).toBe('2026-09-08T14:00:00.000Z');
  });

  it('parses the all-day shape the CLI emits (date plus bare offset)', () => {
    // `new Date('2026-09-08-04:00')` is Invalid Date, so this needs special handling.
    const parsed = parseEventDate('2026-09-08-04:00');
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(8);
    expect(parsed?.getDate()).toBe(8);
  });

  it('parses date-only and space-separated forms in local time', () => {
    expect(parseEventDate('2026-09-08')?.getDate()).toBe(8);
    expect(parseEventDate('2026-09-08 14:30:00')?.getHours()).toBe(14);
  });

  it('returns undefined for junk rather than an Invalid Date', () => {
    expect(parseEventDate('nope')).toBeUndefined();
    expect(parseEventDate(undefined)).toBeUndefined();
    expect(parseEventDate(null)).toBeUndefined();
  });
});

describe('parseClockTime', () => {
  it('parses HH:mm and bare hours', () => {
    expect(parseClockTime('09:30')).toBe(570);
    expect(parseClockTime('9')).toBe(540);
    expect(parseClockTime('00:00')).toBe(0);
    expect(parseClockTime('24')).toBe(1440);
  });

  it('rejects malformed values', () => {
    expect(parseClockTime('9:99')).toBeUndefined();
    expect(parseClockTime('noon')).toBeUndefined();
    expect(parseClockTime('25:00')).toBeUndefined();
  });
});

describe('toBusyIntervals', () => {
  it('skips all-day events by default and includes them on request', () => {
    const events = [event({ isAllDay: true, title: 'Reading Day' })];
    expect(toBusyIntervals(events)).toHaveLength(0);
    expect(toBusyIntervals(events, { includeAllDay: true })).toHaveLength(1);
  });

  it('ignores events marked free or cancelled', () => {
    const events = [
      event({ title: 'Optional', availability: 'free' }),
      event({ title: 'Dropped', status: 'canceled' }),
      event({ title: 'Lecture' }),
    ];
    const busy = toBusyIntervals(events);
    expect(busy.map((interval) => interval.title)).toEqual(['Lecture']);
  });

  it('honours availability=free only when asked to', () => {
    const events = [event({ title: 'Optional', availability: 'free' })];
    expect(
      toBusyIntervals(events, { respectAvailability: false }),
    ).toHaveLength(1);
  });

  it('gives an all-day event with equal start/end the whole day', () => {
    const busy = toBusyIntervals(
      [
        event({
          isAllDay: true,
          startDate: '2026-09-08-04:00',
          endDate: '2026-09-08-04:00',
        }),
      ],
      { includeAllDay: true },
    );
    expect(busy[0].end.getDate()).toBe(9);
  });
});

describe('mergeIntervals', () => {
  it('collapses overlapping and touching intervals', () => {
    const merged = mergeIntervals([
      { start: at(8, 9), end: at(8, 11) },
      { start: at(8, 10), end: at(8, 12) },
      { start: at(8, 12), end: at(8, 13) },
      { start: at(8, 15), end: at(8, 16) },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].start.getHours()).toBe(9);
    expect(merged[0].end.getHours()).toBe(13);
    expect(merged[1].start.getHours()).toBe(15);
  });

  it('does not mutate the caller’s intervals', () => {
    const original = { start: at(8, 9), end: at(8, 10) };
    mergeIntervals([original, { start: at(8, 9, 30), end: at(8, 12) }]);
    expect(original.end.getHours()).toBe(10);
  });

  it('handles an empty list', () => {
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe('findFreeSlots', () => {
  const oneDay = {
    rangeStart: at(8, 0),
    rangeEnd: at(8, 23, 59),
    dayStartMinutes: 9 * 60,
    dayEndMinutes: 17 * 60,
    minimumMinutes: 30,
  };

  it('returns the whole window when nothing is booked', () => {
    const slots = findFreeSlots([], oneDay);
    expect(slots).toHaveLength(1);
    expect(slots[0].durationMinutes).toBe(8 * 60);
  });

  it('splits around a booked block', () => {
    const slots = findFreeSlots(
      [{ start: at(8, 11), end: at(8, 12) }],
      oneDay,
    );
    expect(slots).toHaveLength(2);
    expect(slots[0].durationMinutes).toBe(120);
    expect(slots[1].durationMinutes).toBe(300);
  });

  it('drops gaps shorter than the minimum', () => {
    const slots = findFreeSlots(
      [
        { start: at(8, 9, 20), end: at(8, 12) },
        { start: at(8, 12, 15), end: at(8, 17) },
      ],
      oneDay,
    );
    // 9:00–9:20 and 12:00–12:15 are both under 30 minutes.
    expect(slots).toHaveLength(0);
  });

  it('applies the buffer on both sides of a commitment', () => {
    const slots = findFreeSlots([{ start: at(8, 11), end: at(8, 12) }], {
      ...oneDay,
      bufferMinutes: 30,
    });
    expect(slots[0].end.getHours()).toBe(10);
    expect(slots[0].end.getMinutes()).toBe(30);
    expect(slots[1].start.getHours()).toBe(12);
    expect(slots[1].start.getMinutes()).toBe(30);
  });

  it('ignores commitments outside the daily window', () => {
    const slots = findFreeSlots(
      [{ start: at(8, 6), end: at(8, 7) }, { start: at(8, 20), end: at(8, 22) }],
      oneDay,
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].durationMinutes).toBe(8 * 60);
  });

  it('restricts to the requested weekdays', () => {
    // 2026-09-08 is a Tuesday; ask for Mondays only.
    const slots = findFreeSlots([], {
      ...oneDay,
      rangeEnd: at(9, 23, 59),
      daysOfWeek: [1],
    });
    expect(slots).toHaveLength(0);
  });

  it('spans multiple days', () => {
    const slots = findFreeSlots([], { ...oneDay, rangeEnd: at(10, 23, 59) });
    expect(slots).toHaveLength(3);
  });

  it('never returns a slot starting before notBefore', () => {
    const slots = findFreeSlots([], { ...oneDay, notBefore: at(8, 14) });
    expect(slots).toHaveLength(1);
    expect(slots[0].start.getHours()).toBe(14);
  });

  it('returns nothing for an inverted range or window', () => {
    expect(findFreeSlots([], { ...oneDay, rangeEnd: at(7, 0) })).toEqual([]);
    expect(
      findFreeSlots([], { ...oneDay, dayStartMinutes: 18 * 60, dayEndMinutes: 9 * 60 }),
    ).toEqual([]);
  });

  it('caps results at maxResults', () => {
    const slots = findFreeSlots([], {
      ...oneDay,
      rangeEnd: at(20, 23, 59),
      maxResults: 3,
    });
    expect(slots).toHaveLength(3);
  });

  it('handles a fully booked day', () => {
    const slots = findFreeSlots([{ start: at(8, 8), end: at(8, 18) }], oneDay);
    expect(slots).toEqual([]);
  });
});

describe('findConflicts', () => {
  const busy = toBusyIntervals([
    event({ title: 'Lecture', startDate: '2026-09-08 10:00:00', endDate: '2026-09-08 11:00:00' }),
    event({ title: 'Lab', startDate: '2026-09-08 14:00:00', endDate: '2026-09-08 16:00:00' }),
  ]);

  it('finds overlaps', () => {
    const hits = findConflicts({ start: at(8, 10, 30), end: at(8, 12) }, busy);
    expect(hits.map((hit) => hit.title)).toEqual(['Lecture']);
  });

  it('does not count touching edges as a conflict', () => {
    expect(findConflicts({ start: at(8, 11), end: at(8, 12) }, busy)).toEqual([]);
    expect(findConflicts({ start: at(8, 9), end: at(8, 10) }, busy)).toEqual([]);
  });

  it('reports every overlap for a long proposal', () => {
    const hits = findConflicts({ start: at(8, 9), end: at(8, 17) }, busy);
    expect(hits).toHaveLength(2);
  });

  it('returns nothing for free time', () => {
    expect(findConflicts({ start: at(8, 12), end: at(8, 13) }, busy)).toEqual([]);
  });
});

describe('buildAgendaEntries', () => {
  it('interleaves events and dated reminders in time order', () => {
    const entries = buildAgendaEntries(
      [
        event({ title: 'Lecture', startDate: '2026-09-08 10:00:00', endDate: '2026-09-08 11:00:00' }),
      ],
      [
        {
          id: 'r1',
          title: 'Submit lab report',
          list: 'School',
          isCompleted: false,
          priority: 1,
          dueDate: '2026-09-08 09:00:00',
        },
      ],
    );
    expect(entries.map((entry) => entry.title)).toEqual([
      'Submit lab report',
      'Lecture',
    ]);
    expect(entries[0].kind).toBe('reminder');
    expect(entries[0].detail).toContain('high priority');
  });

  it('flags an event buried inside a longer earlier one', () => {
    const entries = buildAgendaEntries(
      [
        event({ title: 'Lab', startDate: '2026-09-08 09:00:00', endDate: '2026-09-08 13:00:00' }),
        event({ title: 'Seminar', startDate: '2026-09-08 11:00:00', endDate: '2026-09-08 12:00:00' }),
        event({ title: 'Office hours', startDate: '2026-09-08 14:00:00', endDate: '2026-09-08 15:00:00' }),
      ],
      [],
    );
    const byTitle = new Map(entries.map((entry) => [entry.title, entry]));
    expect(byTitle.get('Seminar')?.overlapsPrevious).toBe(true);
    expect(byTitle.get('Office hours')?.overlapsPrevious).toBeUndefined();
  });

  it('sorts undated reminders last', () => {
    const entries = buildAgendaEntries(
      [],
      [
        { id: 'a', title: 'Someday task', list: 'School', isCompleted: false, priority: 0 },
        {
          id: 'b',
          title: 'Dated task',
          list: 'School',
          isCompleted: false,
          priority: 0,
          dueDate: '2026-09-08 09:00:00',
        },
      ],
    );
    expect(entries.map((entry) => entry.title)).toEqual([
      'Dated task',
      'Someday task',
    ]);
  });
});

describe('expandWeeklyDates', () => {
  it('lists every matching weekday in range using EventKit numbering', () => {
    // 2026-09-07 is a Monday. [2,4,6] = Mon/Wed/Fri.
    const dates = expandWeeklyDates(
      new Date(2026, 8, 7),
      new Date(2026, 8, 18),
      [2, 4, 6],
    );
    expect(dates.map((date) => date.getDate())).toEqual([
      7, 9, 11, 14, 16, 18,
    ]);
  });

  it('returns nothing when no day matches', () => {
    expect(
      expandWeeklyDates(new Date(2026, 8, 7), new Date(2026, 8, 8), [7]),
    ).toEqual([]);
  });
});

describe('isWithinAnyRange', () => {
  const ranges = [
    { start: new Date(2026, 10, 25), end: new Date(2026, 10, 27) },
  ];

  it('matches inclusively at both ends', () => {
    expect(isWithinAnyRange(new Date(2026, 10, 25, 9), ranges)).toBe(true);
    expect(isWithinAnyRange(new Date(2026, 10, 27, 23), ranges)).toBe(true);
  });

  it('excludes days outside the range', () => {
    expect(isWithinAnyRange(new Date(2026, 10, 24), ranges)).toBe(false);
    expect(isWithinAnyRange(new Date(2026, 10, 28), ranges)).toBe(false);
  });
});

describe('formatDuration', () => {
  it('renders minutes, hours, and mixed values', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(150)).toBe('2h 30m');
  });
});
