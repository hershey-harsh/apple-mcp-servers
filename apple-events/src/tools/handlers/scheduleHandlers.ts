/**
 * handlers/scheduleHandlers.ts
 * Read-only planning views over existing calendar + reminder data: a merged agenda,
 * an open-slot finder, and a conflict checker.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ScheduleToolArgs } from '../../types/index.js';
import { calendarRepository } from '../../utils/calendarRepository.js';
import { handleAsyncOperation } from '../../utils/errorHandling.js';
import { reminderRepository } from '../../utils/reminderRepository.js';
import {
  addDays,
  buildAgendaEntries,
  findConflicts,
  findFreeSlots,
  formatDateTime,
  formatDay,
  formatDuration,
  minutesBetween,
  parseClockTime,
  parseEventDate,
  startOfDay,
  toBusyIntervals,
  weekdayLabel,
} from '../../utils/scheduling.js';
import {
  AgendaSchema,
  ConflictCheckSchema,
  FreeSlotsSchema,
} from '../../validation/schemas.js';
import { extractAndValidateArgs } from './shared.js';

const DEFAULT_DAY_START = 9 * 60;
const DEFAULT_DAY_END = 18 * 60;
const DEFAULT_AGENDA_DAYS = 7;

/** Resolves a clock-time string, falling back when absent or unparseable. */
const resolveClock = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  return parseClockTime(value) ?? fallback;
};

/**
 * Turns optional start/end text into a concrete window. Defaults to a week from
 * today so "what does my week look like" needs no arguments at all.
 */
const resolveWindow = (
  startDate: string | undefined,
  endDate: string | undefined,
  defaultDays: number,
): { start: Date; end: Date } => {
  const start = startDate ? parseEventDate(startDate) : undefined;
  const end = endDate ? parseEventDate(endDate) : undefined;

  if (start && end) return { start, end };
  if (start) return { start, end: addDays(start, defaultDays) };
  if (end) return { start: startOfDay(new Date()), end };

  const today = startOfDay(new Date());
  return { start: today, end: addDays(today, defaultDays) };
};

/** EventKit weekdays (1 = Sunday) → JS weekdays (0 = Sunday). */
const toJsWeekdays = (days: number[] | undefined): number[] | undefined =>
  days?.map((day) => day - 1);

export const handleAgenda = async (
  args: ScheduleToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, AgendaSchema);
    const window = resolveWindow(
      validated.startDate,
      validated.endDate,
      DEFAULT_AGENDA_DAYS,
    );

    const events = await calendarRepository.findEvents({
      startDate: formatDay(window.start),
      endDate: formatDay(window.end),
      calendarName: validated.filterCalendar,
      search: validated.search,
      accountName: validated.filterAccount,
    });

    const reminders = validated.includeReminders
      ? (
          await reminderRepository.findReminders({
            showCompleted: validated.includeCompletedReminders,
            search: validated.search,
          })
        ).filter((reminder) => {
          const due = parseEventDate(reminder.dueDate);
          if (!due) return false;
          return due >= window.start && due <= addDays(window.end, 1);
        })
      : [];

    const entries = buildAgendaEntries(events, reminders);

    const lines = [
      `### Agenda ${formatDay(window.start)} → ${formatDay(window.end)}`,
      `${events.length} event(s), ${reminders.length} dated reminder(s)`,
      '',
    ];

    if (entries.length === 0) {
      lines.push('Nothing scheduled in this window.');
      return lines.join('\n');
    }

    const dayStart = resolveClock(validated.dayStart, DEFAULT_DAY_START);
    const dayEnd = resolveClock(validated.dayEnd, DEFAULT_DAY_END);

    // Group by calendar day; undated entries land in a trailing bucket.
    const byDay = new Map<string, typeof entries>();
    const undated: typeof entries = [];
    for (const entry of entries) {
      if (!entry.start) {
        undated.push(entry);
        continue;
      }
      const key = formatDay(entry.start);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(entry);
      else byDay.set(key, [entry]);
    }

    for (const [day, dayEntries] of [...byDay.entries()].sort()) {
      const dayDate = parseEventDate(day);
      lines.push(
        `**${day}${dayDate ? ` (${weekdayLabel(dayDate)})` : ''}**`,
      );
      for (const entry of dayEntries) {
        const time = entry.isAllDay
          ? 'all day'
          : entry.end && entry.start
            ? `${formatDateTime(entry.start).slice(11)}–${formatDateTime(entry.end).slice(11)}`
            : entry.start
              ? `due ${formatDateTime(entry.start).slice(11)}`
              : '';
        const marker = entry.kind === 'reminder' ? '☐' : '•';
        const clash = entry.overlapsPrevious ? '  ⚠️ overlaps earlier event' : '';
        lines.push(
          `- ${marker} ${time ? `${time}  ` : ''}${entry.title}${entry.detail ? ` _(${entry.detail})_` : ''}${clash}`,
        );
      }

      if (validated.includeFreeGaps && dayDate) {
        const busy = toBusyIntervals(
          events.filter((event) => {
            const start = parseEventDate(event.startDate);
            return start && formatDay(start) === day;
          }),
        );
        const gaps = findFreeSlots(busy, {
          rangeStart: dayDate,
          rangeEnd: addDays(dayDate, 1),
          dayStartMinutes: dayStart,
          dayEndMinutes: dayEnd,
          minimumMinutes: 30,
        });
        if (gaps.length > 0) {
          lines.push(
            `  - Free: ${gaps
              .map(
                (gap) =>
                  `${formatDateTime(gap.start).slice(11)}–${formatDateTime(gap.end).slice(11)} (${formatDuration(gap.durationMinutes)})`,
              )
              .join(', ')}`,
          );
        }
      }
      lines.push('');
    }

    if (undated.length > 0) {
      lines.push('**No date**');
      undated.forEach((entry) => {
        lines.push(`- ☐ ${entry.title}${entry.detail ? ` _(${entry.detail})_` : ''}`);
      });
    }

    return lines.join('\n').trimEnd();
  }, 'build agenda');
};

export const handleFreeSlots = async (
  args: ScheduleToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, FreeSlotsSchema);
    const window = resolveWindow(
      validated.startDate,
      validated.endDate,
      DEFAULT_AGENDA_DAYS,
    );

    const events = await calendarRepository.findEvents({
      startDate: formatDay(window.start),
      endDate: formatDay(addDays(window.end, 1)),
      calendarName: validated.filterCalendar,
      accountName: validated.filterAccount,
    });

    const busy = toBusyIntervals(events, {
      includeAllDay: validated.includeAllDayAsBusy,
      respectAvailability: validated.respectAvailability,
    });

    const slots = findFreeSlots(busy, {
      rangeStart: window.start,
      rangeEnd: window.end,
      dayStartMinutes: resolveClock(validated.dayStart, DEFAULT_DAY_START),
      dayEndMinutes: resolveClock(validated.dayEnd, DEFAULT_DAY_END),
      minimumMinutes: validated.durationMinutes,
      bufferMinutes: validated.bufferMinutes,
      daysOfWeek: toJsWeekdays(validated.daysOfWeek),
      // Never hand back a slot that already started.
      notBefore: new Date(),
      maxResults: validated.maxResults,
    });

    const lines = [
      `### Free slots ≥ ${formatDuration(validated.durationMinutes)} (Total: ${slots.length})`,
      `Window ${formatDay(window.start)} → ${formatDay(window.end)}, ${resolveClock(validated.dayStart, DEFAULT_DAY_START) / 60}:00–${resolveClock(validated.dayEnd, DEFAULT_DAY_END) / 60}:00, buffer ${validated.bufferMinutes}m`,
      '',
    ];

    if (slots.length === 0) {
      lines.push(
        'No open slots matched. Try widening dayStart/dayEnd, lowering durationMinutes, reducing bufferMinutes, extending endDate, or clearing daysOfWeek.',
      );
      return lines.join('\n');
    }

    slots.forEach((slot) => {
      lines.push(
        `- ${formatDay(slot.start)} (${weekdayLabel(slot.start)}) ${formatDateTime(slot.start).slice(11)}–${formatDateTime(slot.end).slice(11)} — ${formatDuration(slot.durationMinutes)}`,
      );
    });

    const total = slots.reduce((sum, slot) => sum + slot.durationMinutes, 0);
    lines.push('', `Total open time: ${formatDuration(total)}`);

    return lines.join('\n');
  }, 'find free slots');
};

export const handleConflicts = async (
  args: ScheduleToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, ConflictCheckSchema);

    const parsed = validated.slots.map((slot, index) => {
      const start = parseEventDate(slot.startDate);
      const end = parseEventDate(slot.endDate);
      return {
        label: slot.label ?? `Slot ${index + 1}`,
        start,
        end,
        raw: slot,
      };
    });

    const usable = parsed.filter(
      (slot): slot is typeof slot & { start: Date; end: Date } =>
        slot.start !== undefined && slot.end !== undefined,
    );

    if (usable.length === 0) {
      return 'None of the supplied slots had a parseable start and end date.';
    }

    const earliest = usable.reduce(
      (min, slot) => (slot.start < min ? slot.start : min),
      usable[0].start,
    );
    const latest = usable.reduce(
      (max, slot) => (slot.end > max ? slot.end : max),
      usable[0].end,
    );

    const events = await calendarRepository.findEvents({
      startDate: formatDay(addDays(earliest, -1)),
      endDate: formatDay(addDays(latest, 1)),
      calendarName: validated.filterCalendar,
      accountName: validated.filterAccount,
    });

    const busy = toBusyIntervals(events, {
      includeAllDay: validated.includeAllDayAsBusy,
      respectAvailability: validated.respectAvailability,
    });

    const lines: string[] = [];
    let clashing = 0;

    for (const slot of parsed) {
      if (!slot.start || !slot.end) {
        lines.push(`- ⚠️ ${slot.label}: unparseable dates, skipped`);
        continue;
      }
      if (slot.end <= slot.start) {
        lines.push(`- ⚠️ ${slot.label}: end is not after start, skipped`);
        continue;
      }
      // Bound to locals so the narrowing survives into the callback below.
      const slotStart = slot.start;
      const slotEnd = slot.end;
      const conflicts = findConflicts({ start: slotStart, end: slotEnd }, busy);
      const when = `${formatDay(slotStart)} ${formatDateTime(slotStart).slice(11)}–${formatDateTime(slotEnd).slice(11)}`;
      if (conflicts.length === 0) {
        lines.push(`- ✅ ${slot.label} (${when}): free`);
        continue;
      }
      clashing += 1;
      lines.push(`- ❌ ${slot.label} (${when}): ${conflicts.length} conflict(s)`);
      conflicts.forEach((conflict) => {
        const overlap = minutesBetween(
          conflict.start > slotStart ? conflict.start : slotStart,
          conflict.end < slotEnd ? conflict.end : slotEnd,
        );
        lines.push(
          `  - ${conflict.title}${conflict.calendar ? ` [${conflict.calendar}]` : ''} ${formatDateTime(conflict.start).slice(11)}–${formatDateTime(conflict.end).slice(11)} (overlap ${formatDuration(overlap)})`,
        );
      });
    }

    return [
      `### Conflict check: ${clashing} of ${parsed.length} slot(s) clash`,
      '',
      ...lines,
    ].join('\n');
  }, 'check conflicts');
};
