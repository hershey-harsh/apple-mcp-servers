/**
 * scheduling.ts
 * Pure scheduling maths shared by the planning tools: parsing the CLI's date output,
 * collapsing events into busy intervals, finding open gaps, detecting conflicts, and
 * expanding weekly meeting patterns into concrete dates.
 *
 * Everything here is deliberately side-effect free so it can be unit tested without
 * touching EventKit.
 */

import type { CalendarEvent, Reminder } from '../types/index.js';

export interface Interval {
  start: Date;
  end: Date;
}

export interface BusyInterval extends Interval {
  title: string;
  calendar?: string;
  isAllDay?: boolean;
}

export interface FreeSlot extends Interval {
  durationMinutes: number;
}

/** All-day events come back as `YYYY-MM-DD±HH:MM`, which `new Date()` rejects. */
const ALL_DAY_WITH_OFFSET = /^(\d{4}-\d{2}-\d{2})(?:[+-]\d{2}:\d{2}|Z)$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SPACE_SEPARATED = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)$/;

/**
 * Parses any date shape EventKitCLI emits or accepts. Returns undefined rather than
 * an Invalid Date so callers must handle unparseable input explicitly.
 */
export const parseEventDate = (value?: string | null): Date | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();

  const allDay = trimmed.match(ALL_DAY_WITH_OFFSET);
  if (allDay) {
    const [year, month, day] = allDay[1].split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  if (DATE_ONLY.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  const spaced = trimmed.match(SPACE_SEPARATED);
  if (spaced) {
    const parsed = new Date(`${spaced[1]}T${spaced[2]}`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const MINUTES_PER_DAY = 24 * 60;

/** Parses "HH:mm" (or "H") into minutes from midnight. */
export const parseClockTime = (value: string): number | undefined => {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 24 || minutes > 59) return undefined;
  const total = hours * 60 + minutes;
  return total > MINUTES_PER_DAY ? undefined : total;
};

export const startOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

export const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

export const addMinutes = (date: Date, minutes: number): Date => {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() + minutes);
  return copy;
};

const atMinutes = (day: Date, minutesFromMidnight: number): Date =>
  addMinutes(startOfDay(day), minutesFromMidnight);

export const minutesBetween = (start: Date, end: Date): number =>
  Math.round((end.getTime() - start.getTime()) / 60000);

export const formatDateTime = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const formatDay = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const weekdayLabel = (date: Date): string => WEEKDAY_LABELS[date.getDay()];

export const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

/**
 * Turns events into busy intervals. Events explicitly marked free (and, unless asked
 * for, all-day ones) do not block time — an all-day "Reading Day" should not make a
 * whole day unbookable.
 */
export const toBusyIntervals = (
  events: CalendarEvent[],
  options: { includeAllDay?: boolean; respectAvailability?: boolean } = {},
): BusyInterval[] => {
  const { includeAllDay = false, respectAvailability = true } = options;
  const intervals: BusyInterval[] = [];

  for (const event of events) {
    if (event.isAllDay && !includeAllDay) continue;
    if (
      respectAvailability &&
      (event.availability === 'free' || event.status === 'canceled')
    ) {
      continue;
    }
    const start = parseEventDate(event.startDate);
    const end = parseEventDate(event.endDate);
    if (!start || !end) continue;
    // All-day events report identical start/end in some calendars; give them the day.
    const resolvedEnd =
      end.getTime() > start.getTime()
        ? end
        : event.isAllDay
          ? addDays(start, 1)
          : addMinutes(start, 1);
    intervals.push({
      start,
      end: resolvedEnd,
      title: event.title,
      calendar: event.calendar,
      isAllDay: event.isAllDay,
    });
  }

  return intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
};

/** Collapses overlapping/adjacent intervals into a minimal covering set. */
export const mergeIntervals = (intervals: Interval[]): Interval[] => {
  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const merged: Interval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start.getTime() <= last.end.getTime()) {
      if (interval.end.getTime() > last.end.getTime()) {
        last.end = new Date(interval.end);
      }
      continue;
    }
    merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
  }

  return merged;
};

export interface FreeSlotOptions {
  rangeStart: Date;
  rangeEnd: Date;
  /** Earliest bookable minute-of-day (default 09:00). */
  dayStartMinutes?: number;
  /** Latest bookable minute-of-day (default 18:00). */
  dayEndMinutes?: number;
  /** Discard gaps shorter than this (default 30). */
  minimumMinutes?: number;
  /** Padding kept clear either side of an existing commitment (default 0). */
  bufferMinutes?: number;
  /** JS weekdays (0 = Sunday) to consider; defaults to all. */
  daysOfWeek?: number[];
  /** Never suggest a slot that starts before this instant (default: no floor). */
  notBefore?: Date;
  maxResults?: number;
}

/**
 * Returns the open gaps inside each day's bookable window, after removing every busy
 * interval expanded by `bufferMinutes` on both sides.
 */
export const findFreeSlots = (
  busy: Interval[],
  options: FreeSlotOptions,
): FreeSlot[] => {
  const {
    rangeStart,
    rangeEnd,
    dayStartMinutes = 9 * 60,
    dayEndMinutes = 18 * 60,
    minimumMinutes = 30,
    bufferMinutes = 0,
    daysOfWeek,
    notBefore,
    maxResults = 50,
  } = options;

  if (rangeEnd.getTime() <= rangeStart.getTime()) return [];
  if (dayEndMinutes <= dayStartMinutes) return [];

  const padded = mergeIntervals(
    busy.map((interval) => ({
      start: addMinutes(interval.start, -bufferMinutes),
      end: addMinutes(interval.end, bufferMinutes),
    })),
  );

  const slots: FreeSlot[] = [];
  const lastDay = startOfDay(rangeEnd);

  for (let day = startOfDay(rangeStart); day <= lastDay; day = addDays(day, 1)) {
    if (daysOfWeek && !daysOfWeek.includes(day.getDay())) continue;

    // Clip the day's window to the requested range and to `notBefore`.
    let cursor = atMinutes(day, dayStartMinutes);
    const windowEnd = atMinutes(day, dayEndMinutes);
    if (cursor < rangeStart) cursor = new Date(rangeStart);
    if (notBefore && cursor < notBefore) cursor = new Date(notBefore);
    const limit = windowEnd < rangeEnd ? windowEnd : new Date(rangeEnd);
    if (cursor >= limit) continue;

    for (const interval of padded) {
      if (interval.end <= cursor) continue;
      if (interval.start >= limit) break;
      if (interval.start > cursor) {
        const gapEnd = interval.start < limit ? interval.start : limit;
        const duration = minutesBetween(cursor, gapEnd);
        if (duration >= minimumMinutes) {
          slots.push({ start: new Date(cursor), end: new Date(gapEnd), durationMinutes: duration });
        }
      }
      if (interval.end > cursor) cursor = new Date(interval.end);
      if (cursor >= limit) break;
    }

    if (cursor < limit) {
      const duration = minutesBetween(cursor, limit);
      if (duration >= minimumMinutes) {
        slots.push({ start: new Date(cursor), end: new Date(limit), durationMinutes: duration });
      }
    }

    if (slots.length >= maxResults) break;
  }

  return slots.slice(0, maxResults);
};

export interface ConflictReport {
  proposed: Interval;
  conflicts: BusyInterval[];
}

/** Finds every busy interval that overlaps a proposed slot. Touching edges do not count. */
export const findConflicts = (
  proposed: Interval,
  busy: BusyInterval[],
): BusyInterval[] =>
  busy.filter(
    (interval) =>
      interval.start.getTime() < proposed.end.getTime() &&
      interval.end.getTime() > proposed.start.getTime(),
  );

export interface AgendaEntry {
  start?: Date;
  end?: Date;
  title: string;
  kind: 'event' | 'reminder';
  detail?: string;
  isAllDay?: boolean;
  overlapsPrevious?: boolean;
}

/**
 * Merges events and dated reminders into one chronological list, flagging entries
 * that overlap an earlier one so double-bookings are visible at a glance.
 */
export const buildAgendaEntries = (
  events: CalendarEvent[],
  reminders: Reminder[],
): AgendaEntry[] => {
  const entries: AgendaEntry[] = [];

  for (const event of events) {
    const start = parseEventDate(event.startDate);
    const end = parseEventDate(event.endDate);
    const details: string[] = [event.calendar];
    if (event.location) details.push(event.location);
    entries.push({
      start,
      end,
      title: event.title,
      kind: 'event',
      detail: details.filter(Boolean).join(' · '),
      isAllDay: event.isAllDay,
    });
  }

  for (const reminder of reminders) {
    const due = parseEventDate(reminder.dueDate);
    const details = [reminder.list];
    if (reminder.priority === 1) details.push('high priority');
    entries.push({
      start: due,
      title: reminder.title,
      kind: 'reminder',
      detail: details.filter(Boolean).join(' · '),
    });
  }

  entries.sort((a, b) => {
    if (!a.start && !b.start) return a.title.localeCompare(b.title);
    if (!a.start) return 1;
    if (!b.start) return -1;
    return a.start.getTime() - b.start.getTime();
  });

  // Flag overlaps against the furthest end seen so far, so a long morning lab still
  // marks the seminar buried inside it.
  let furthestEnd: Date | undefined;
  for (const entry of entries) {
    if (entry.kind !== 'event' || !entry.start || !entry.end || entry.isAllDay) {
      continue;
    }
    if (furthestEnd && entry.start.getTime() < furthestEnd.getTime()) {
      entry.overlapsPrevious = true;
    }
    if (!furthestEnd || entry.end.getTime() > furthestEnd.getTime()) {
      furthestEnd = entry.end;
    }
  }

  return entries;
};

/**
 * Every date in [rangeStart, rangeEnd] falling on one of `daysOfWeek`
 * (1 = Sunday … 7 = Saturday, matching EventKit's numbering).
 */
export const expandWeeklyDates = (
  rangeStart: Date,
  rangeEnd: Date,
  daysOfWeek: number[],
): Date[] => {
  const wanted = new Set(daysOfWeek.map((day) => day - 1));
  const dates: Date[] = [];
  const last = startOfDay(rangeEnd);
  for (let day = startOfDay(rangeStart); day <= last; day = addDays(day, 1)) {
    if (wanted.has(day.getDay())) dates.push(new Date(day));
  }
  return dates;
};

/** True when `date` falls inside any of the given inclusive day ranges. */
export const isWithinAnyRange = (
  date: Date,
  ranges: Array<{ start: Date; end: Date }>,
): boolean => {
  const day = startOfDay(date).getTime();
  return ranges.some(
    (range) =>
      day >= startOfDay(range.start).getTime() &&
      day <= startOfDay(range.end).getTime(),
  );
};
