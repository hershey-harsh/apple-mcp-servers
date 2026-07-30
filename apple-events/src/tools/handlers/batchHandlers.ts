/**
 * handlers/batchHandlers.ts
 * Multi-item write operations: bulk event/reminder creation, occurrence cancellation,
 * whole-term class schedules, and automatic study-block placement.
 *
 * Every action reports per-item outcomes rather than failing the whole call, so a
 * single bad row in a 40-row import does not lose the other 39.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  CalendarBatchToolArgs,
  Reminder,
  ReminderBatchToolArgs,
} from '../../types/index.js';
import { calendarRepository } from '../../utils/calendarRepository.js';
import { handleAsyncOperation } from '../../utils/errorHandling.js';
import { reminderRepository } from '../../utils/reminderRepository.js';
import {
  addDays,
  addMinutes,
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
  BatchCompleteRemindersSchema,
  BatchCreateEventsSchema,
  BatchCreateRemindersSchema,
  BatchDateRangeSchema,
  BatchDateSchema,
  BatchDeleteEventsSchema,
  BatchDeleteRemindersSchema,
  BatchEventItemSchema,
  BatchReminderItemSchema,
  BatchReminderUpdateItemSchema,
  BatchUpdateRemindersSchema,
  CancelOccurrencesSchema,
  ClassScheduleItemSchema,
  CreateClassScheduleSchema,
  ScheduleStudyBlocksSchema,
  validateInput,
} from '../../validation/schemas.js';
import {
  extractAndValidateArgs,
  formatBatchResults,
  runBatch,
} from './shared.js';

/**
 * Reads a display field off an unvalidated row. Batch labels have to work even when
 * the row turns out to be invalid, so this never throws.
 */
const peek = (item: unknown, key: string): string => {
  if (item && typeof item === 'object' && key in item) {
    const value = (item as Record<string, unknown>)[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return '';
};

const labelFor = (item: unknown, index: number, ...keys: string[]): string => {
  const parts = keys.map((key) => peek(item, key)).filter(Boolean);
  return parts.length > 0 ? parts.join(' — ') : `item ${index + 1}`;
};

const DEFAULT_DAY_START = 9 * 60;
const DEFAULT_DAY_END = 18 * 60;

const resolveClock = (value: string | undefined, fallback: number): number =>
  value ? (parseClockTime(value) ?? fallback) : fallback;

/** Combines a calendar day with a minute-of-day into a CLI-ready timestamp. */
const atClock = (day: Date, minutesFromMidnight: number): Date =>
  addMinutes(startOfDay(day), minutesFromMidnight);

const toCliDateTime = (date: Date): string => `${formatDateTime(date)}:00`;

/* ------------------------------------------------------------------ *
 * Calendar batch actions
 * ------------------------------------------------------------------ */

export const handleBatchCreateEvents = async (
  args: CalendarBatchToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, BatchCreateEventsSchema);

    // Only fetch existing events when we actually need to test for clashes.
    let busy: ReturnType<typeof toBusyIntervals> = [];
    if (validated.skipConflicts) {
      const starts = validated.events
        .map((event) => parseEventDate(peek(event, 'startDate')))
        .filter((date): date is Date => date !== undefined);
      const ends = validated.events
        .map((event) => parseEventDate(peek(event, 'endDate')))
        .filter((date): date is Date => date !== undefined);
      if (starts.length > 0 && ends.length > 0) {
        const earliest = new Date(Math.min(...starts.map((d) => d.getTime())));
        const latest = new Date(Math.max(...ends.map((d) => d.getTime())));
        const existing = await calendarRepository.findEvents({
          startDate: formatDay(addDays(earliest, -1)),
          endDate: formatDay(addDays(latest, 1)),
          calendarName: validated.targetCalendar,
        });
        busy = toBusyIntervals(existing);
      }
    }

    const results = await runBatch(
      validated.events,
      (item, index) => labelFor(item, index, 'title', 'startDate'),
      async (raw) => {
        // Validated per row: one malformed event must not sink the rest.
        const event = validateInput(BatchEventItemSchema, raw);
        if (validated.skipConflicts) {
          const start = parseEventDate(event.startDate);
          const end = parseEventDate(event.endDate);
          if (start && end) {
            const clashes = findConflicts({ start, end }, busy);
            if (clashes.length > 0) {
              throw new Error(
                `skipped — conflicts with ${clashes.map((c) => c.title).join(', ')}`,
              );
            }
          }
        }
        const created = await calendarRepository.createEvent({
          title: event.title,
          startDate: event.startDate,
          endDate: event.endDate,
          calendar: event.targetCalendar ?? validated.targetCalendar,
          notes: event.note,
          location: event.location,
          structuredLocation: event.structuredLocation,
          url: event.url,
          isAllDay: event.isAllDay,
          availability: event.availability,
          alarms: event.alarms,
          recurrenceRules: event.recurrenceRules,
        });
        return created.id;
      },
      validated.continueOnError,
    );

    return formatBatchResults('Batch create events', results);
  }, 'batch create calendar events');
};

export const handleBatchDeleteEvents = async (
  args: CalendarBatchToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, BatchDeleteEventsSchema);

    const results = await runBatch(
      validated.ids,
      (id) => id,
      async (id) => {
        await calendarRepository.deleteEvent(id, validated.span);
        return undefined;
      },
      validated.continueOnError,
    );

    return formatBatchResults('Batch delete events', results);
  }, 'batch delete calendar events');
};

export const handleCancelOccurrences = async (
  args: CalendarBatchToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, CancelOccurrencesSchema);

    const results = await runBatch(
      validated.occurrenceDates,
      (date) => date,
      async (rawDate) => {
        // Normalized per date, so 'next tuesday' works and one bad date is isolated.
        const date = validateInput(BatchDateSchema, rawDate);
        // 'this-event' keeps the rest of the series intact — the point of the action.
        await calendarRepository.deleteEvent(validated.id, 'this-event', date);
        return undefined;
      },
      validated.continueOnError,
    );

    return formatBatchResults('Cancel occurrences', results, [
      `Series: ${validated.id}`,
    ]);
  }, 'cancel event occurrences');
};

/**
 * Enumerates the meeting dates of a weekly pattern, honouring an every-N-weeks interval.
 * `daysOfWeek` uses EventKit numbering (1 = Sunday).
 */
const expandMeetingDates = (
  firstMeeting: Date,
  termEnd: Date,
  daysOfWeek: number[],
  intervalWeeks: number,
): Date[] => {
  const jsDays = [...new Set(daysOfWeek.map((day) => day - 1))].sort();
  const firstDay = startOfDay(firstMeeting);
  const lastDay = startOfDay(termEnd);
  // Align to the Sunday of the first meeting's week so interval weeks are stable.
  const weekStart = addDays(firstDay, -firstDay.getDay());
  const dates: Date[] = [];

  for (let week = 0; ; week += intervalWeeks) {
    const base = addDays(weekStart, week * 7);
    if (base > lastDay) break;
    for (const day of jsDays) {
      const candidate = addDays(base, day);
      if (candidate >= firstDay && candidate <= lastDay) {
        dates.push(candidate);
      }
    }
    // Guard against a pathological interval producing an unbounded loop.
    if (week > 520) break;
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
};

/** Earliest date on/after `from` that falls on one of the given EventKit weekdays. */
const firstMeetingOnOrAfter = (from: Date, daysOfWeek: number[]): Date => {
  const wanted = new Set(daysOfWeek.map((day) => day - 1));
  let candidate = startOfDay(from);
  for (let step = 0; step < 7; step += 1) {
    if (wanted.has(candidate.getDay())) return candidate;
    candidate = addDays(candidate, 1);
  }
  return startOfDay(from);
};

export const handleCreateClassSchedule = async (
  args: CalendarBatchToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, CreateClassScheduleSchema);

    const termStart = parseEventDate(validated.termStart);
    const termEnd = parseEventDate(validated.termEnd);
    if (!termStart || !termEnd) {
      throw new Error('termStart and termEnd must be parseable dates.');
    }
    if (termEnd <= termStart) {
      throw new Error('termEnd must be after termStart.');
    }

    const skipRanges: Array<{ start: Date; end: Date; label?: string }> = [];
    const skipWarnings: string[] = [];
    for (const raw of validated.skipRanges ?? []) {
      // A range that will not parse is reported, not silently ignored — otherwise a
      // typo in a break date would quietly leave classes on a holiday.
      try {
        const range = validateInput(BatchDateRangeSchema, raw);
        const start = parseEventDate(range.start);
        const end = parseEventDate(range.end);
        if (start && end) {
          skipRanges.push({ start, end, label: range.label });
        } else {
          skipWarnings.push(`⚠️ unusable skipRange: ${JSON.stringify(raw)}`);
        }
      } catch (error) {
        skipWarnings.push(
          `⚠️ ignored skipRange ${JSON.stringify(raw)} — ${error instanceof Error ? error.message : 'invalid'}`,
        );
      }
    }

    const notes: string[] = [
      `Term ${formatDay(termStart)} → ${formatDay(termEnd)}`,
      ...skipWarnings,
    ];
    if (skipRanges.length > 0) {
      notes.push(
        `Skipping: ${skipRanges
          .map(
            (range) =>
              `${range.label ?? 'break'} ${formatDay(range.start)}–${formatDay(range.end)}`,
          )
          .join('; ')}`,
      );
    }

    const results = await runBatch(
      validated.classes,
      (item, index) => labelFor(item, index, 'title'),
      async (raw) => {
        const klass = validateInput(ClassScheduleItemSchema, raw);
        const startMinutes = parseClockTime(klass.startTime);
        const endMinutes = parseClockTime(klass.endTime);
        if (startMinutes === undefined || endMinutes === undefined) {
          throw new Error('startTime and endTime must be 24-hour HH:mm values');
        }

        const firstMeeting = firstMeetingOnOrAfter(termStart, klass.daysOfWeek);
        if (firstMeeting > termEnd) {
          throw new Error('no meeting day falls inside the term');
        }

        const start = atClock(firstMeeting, startMinutes);
        // An end time at or before the start means the class runs past midnight.
        const end =
          endMinutes > startMinutes
            ? atClock(firstMeeting, endMinutes)
            : atClock(addDays(firstMeeting, 1), endMinutes);

        const created = await calendarRepository.createEvent({
          title: klass.title,
          startDate: toCliDateTime(start),
          endDate: toCliDateTime(end),
          calendar: validated.targetCalendar,
          notes: klass.note,
          location: klass.location,
          structuredLocation: klass.structuredLocation,
          url: klass.url,
          availability: klass.availability ?? 'busy',
          alarms: klass.alarms,
          recurrenceRules: [
            {
              frequency: 'weekly',
              interval: klass.interval,
              daysOfWeek: klass.daysOfWeek,
              endDate: formatDay(termEnd),
            },
          ],
        });

        // Remove the meetings that land inside a break. Each cancellation detaches
        // just that occurrence, leaving the rest of the series alone.
        if (skipRanges.length > 0) {
          const meetings = expandMeetingDates(
            firstMeeting,
            termEnd,
            klass.daysOfWeek,
            klass.interval,
          );
          const skipped = meetings.filter((date) =>
            skipRanges.some(
              (range) =>
                startOfDay(date) >= startOfDay(range.start) &&
                startOfDay(date) <= startOfDay(range.end),
            ),
          );
          let cancelled = 0;
          for (const date of skipped) {
            try {
              await calendarRepository.deleteEvent(
                created.id,
                'this-event',
                formatDay(date),
              );
              cancelled += 1;
            } catch {
              // A break day that never had a meeting is not an error worth failing on.
            }
          }
          if (cancelled > 0) {
            notes.push(`${klass.title}: removed ${cancelled} break meeting(s)`);
          }
        }

        return created.id;
      },
      validated.continueOnError,
    );

    return formatBatchResults('Create class schedule', results, notes);
  }, 'create class schedule');
};

export const handleScheduleStudyBlocks = async (
  args: CalendarBatchToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, ScheduleStudyBlocksSchema);

    const rangeStart = validated.startDate
      ? (parseEventDate(validated.startDate) ?? new Date())
      : new Date();
    const rangeEnd = validated.endDate
      ? (parseEventDate(validated.endDate) ?? addDays(rangeStart, 7))
      : addDays(rangeStart, 7);

    if (rangeEnd <= rangeStart) {
      throw new Error('endDate must be after startDate.');
    }

    const existing = await calendarRepository.findEvents({
      startDate: formatDay(rangeStart),
      endDate: formatDay(addDays(rangeEnd, 1)),
      calendarName: validated.filterCalendar,
      accountName: validated.filterAccount,
    });

    const busy = toBusyIntervals(existing, {
      includeAllDay: validated.includeAllDayAsBusy,
      respectAvailability: validated.respectAvailability,
    });

    // Ask for gaps at least one block long; shorter leftovers are not worth booking.
    const gaps = findFreeSlots(busy, {
      rangeStart,
      rangeEnd,
      dayStartMinutes: resolveClock(validated.dayStart, DEFAULT_DAY_START),
      dayEndMinutes: resolveClock(validated.dayEnd, DEFAULT_DAY_END),
      minimumMinutes: Math.min(validated.blockMinutes, validated.totalMinutes),
      bufferMinutes: validated.bufferMinutes,
      daysOfWeek: validated.daysOfWeek?.map((day) => day - 1),
      notBefore: new Date(),
      maxResults: 200,
    });

    // Carve blocks out of the gaps, respecting the per-day cap.
    const planned: Array<{ start: Date; end: Date }> = [];
    const perDay = new Map<string, number>();
    let remaining = validated.totalMinutes;

    for (const gap of gaps) {
      if (remaining <= 0) break;
      const dayKey = formatDay(gap.start);
      let cursor = new Date(gap.start);

      while (remaining > 0 && cursor < gap.end) {
        const used = perDay.get(dayKey) ?? 0;
        if (used >= validated.maxBlocksPerDay) break;

        const available = minutesBetween(cursor, gap.end);
        const length = Math.min(validated.blockMinutes, remaining, available);
        // Never book a sliver; 15 minutes is the floor worth putting on a calendar.
        if (length < 15) break;

        const blockEnd = addMinutes(cursor, length);
        planned.push({ start: new Date(cursor), end: blockEnd });
        perDay.set(dayKey, used + 1);
        remaining -= length;
        cursor = addMinutes(blockEnd, validated.bufferMinutes);
      }
    }

    const placedMinutes = validated.totalMinutes - remaining;
    const summary = [
      `Window ${formatDay(rangeStart)} → ${formatDay(rangeEnd)}`,
      `Requested ${formatDuration(validated.totalMinutes)}, placed ${formatDuration(placedMinutes)} in ${planned.length} block(s)`,
    ];
    if (remaining > 0) {
      summary.push(
        `⚠️ ${formatDuration(remaining)} could not be placed — widen the window, raise maxBlocksPerDay, shorten blockMinutes, or extend endDate.`,
      );
    }

    if (planned.length === 0) {
      return [
        '### Schedule study blocks: nothing to place',
        '',
        ...summary,
      ].join('\n');
    }

    if (validated.dryRun) {
      return [
        `### Study block plan (dry run — nothing was created)`,
        '',
        ...summary,
        '',
        ...planned.map(
          (block, index) =>
            `- ${index + 1}. ${formatDay(block.start)} (${weekdayLabel(block.start)}) ${formatDateTime(block.start).slice(11)}–${formatDateTime(block.end).slice(11)} — ${formatDuration(minutesBetween(block.start, block.end))}`,
        ),
      ].join('\n');
    }

    const results = await runBatch(
      planned,
      (block, index) =>
        `${validated.title} ${index + 1}/${planned.length} — ${formatDay(block.start)} ${formatDateTime(block.start).slice(11)}`,
      async (block, index) => {
        const created = await calendarRepository.createEvent({
          title:
            planned.length > 1
              ? `${validated.title} (${index + 1}/${planned.length})`
              : validated.title,
          startDate: toCliDateTime(block.start),
          endDate: toCliDateTime(block.end),
          calendar: validated.targetCalendar,
          notes: validated.note,
          location: validated.location,
          availability: validated.availability ?? 'busy',
          alarms: validated.alarms,
        });
        return created.id;
      },
      true,
    );

    return formatBatchResults('Schedule study blocks', results, summary);
  }, 'schedule study blocks');
};

/* ------------------------------------------------------------------ *
 * Reminder batch actions
 * ------------------------------------------------------------------ */

export const handleBatchCreateReminders = async (
  args: ReminderBatchToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, BatchCreateRemindersSchema);

    const results = await runBatch(
      validated.reminders,
      (item, index) => labelFor(item, index, 'title', 'dueDate'),
      async (raw) => {
        const reminder = validateInput(BatchReminderItemSchema, raw);
        const created = await reminderRepository.createReminder({
          title: reminder.title,
          list: reminder.targetList ?? validated.targetList,
          notes: reminder.note,
          url: reminder.url,
          location: reminder.location,
          startDate: reminder.startDate,
          dueDate: reminder.dueDate,
          priority: reminder.priority,
          isCompleted: reminder.completed,
          alarms: reminder.alarms,
          recurrenceRules: reminder.recurrenceRules ?? (reminder.recurrence ? [reminder.recurrence] : undefined),
          locationTrigger: reminder.locationTrigger,
        });
        return created.id;
      },
      validated.continueOnError,
    );

    return formatBatchResults('Batch create reminders', results);
  }, 'batch create reminders');
};

export const handleBatchUpdateReminders = async (
  args: ReminderBatchToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, BatchUpdateRemindersSchema);

    const results = await runBatch(
      validated.updates,
      (item, index) => labelFor(item, index, 'title', 'id'),
      async (raw) => {
        const update = validateInput(BatchReminderUpdateItemSchema, raw);
        const updated = await reminderRepository.updateReminder({
          id: update.id,
          newTitle: update.title,
          list: update.targetList,
          notes: update.note,
          url: update.url,
          location: update.location,
          isCompleted: update.completed,
          completionDate: update.completionDate,
          startDate: update.startDate,
          dueDate: update.dueDate,
          priority: update.priority,
          alarms: update.alarms,
          clearAlarms: update.clearAlarms,
          recurrenceRules: update.recurrenceRules,
          clearRecurrence: update.clearRecurrence,
          locationTrigger: update.locationTrigger,
          clearLocationTrigger: update.clearLocationTrigger,
        });
        return updated.id;
      },
      validated.continueOnError,
    );

    return formatBatchResults('Batch update reminders', results);
  }, 'batch update reminders');
};

/**
 * Resolves the reminders targeted by ids and/or titles.
 * Title matching is case-insensitive and exact-after-trim; ambiguous titles resolve
 * to every match so "mark all three 'Read chapter 4' done" behaves as expected.
 */
const resolveTargetReminders = async (
  ids: string[] | undefined,
  titles: string[] | undefined,
  filterList: string | undefined,
): Promise<{
  matched: Array<{ id: string; title: string }>;
  unmatched: string[];
}> => {
  const matched: Array<{ id: string; title: string }> = [];
  const unmatched: string[] = [];

  for (const id of ids ?? []) {
    matched.push({ id, title: id });
  }

  if (titles && titles.length > 0) {
    const candidates: Reminder[] = await reminderRepository.findReminders({
      list: filterList,
      showCompleted: true,
    });
    for (const title of titles) {
      const needle = title.trim().toLowerCase();
      const hits = candidates.filter(
        (reminder) => reminder.title.trim().toLowerCase() === needle,
      );
      if (hits.length === 0) {
        unmatched.push(title);
        continue;
      }
      hits.forEach((hit) => matched.push({ id: hit.id, title: hit.title }));
    }
  }

  // De-duplicate in case an id was also reachable by title.
  const seen = new Set<string>();
  return {
    matched: matched.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
    unmatched,
  };
};

export const handleBatchCompleteReminders = async (
  args: ReminderBatchToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, BatchCompleteRemindersSchema);
    const { matched, unmatched } = await resolveTargetReminders(
      validated.ids,
      validated.titles,
      validated.filterList,
    );

    const notes = unmatched.length > 0 ? [`No match for: ${unmatched.join(', ')}`] : [];

    if (matched.length === 0) {
      return [
        '### Batch complete reminders: nothing matched',
        '',
        ...notes,
        'Check the exact title with reminders_tasks action=read, or pass ids instead.',
      ].join('\n');
    }

    const results = await runBatch(
      matched,
      (item) => item.title,
      async (item) => {
        const updated = await reminderRepository.updateReminder({
          id: item.id,
          isCompleted: validated.completed,
        });
        return updated.id;
      },
      validated.continueOnError,
    );

    return formatBatchResults(
      validated.completed
        ? 'Batch complete reminders'
        : 'Batch re-open reminders',
      results,
      notes,
    );
  }, 'batch complete reminders');
};

export const handleBatchDeleteReminders = async (
  args: ReminderBatchToolArgs,
): Promise<CallToolResult> => {
  return handleAsyncOperation(async () => {
    const validated = extractAndValidateArgs(args, BatchDeleteRemindersSchema);
    const { matched, unmatched } = await resolveTargetReminders(
      validated.ids,
      validated.titles,
      validated.filterList,
    );

    const notes = unmatched.length > 0 ? [`No match for: ${unmatched.join(', ')}`] : [];

    if (matched.length === 0) {
      return [
        '### Batch delete reminders: nothing matched',
        '',
        ...notes,
      ].join('\n');
    }

    const results = await runBatch(
      matched,
      (item) => item.title,
      async (item) => {
        await reminderRepository.deleteReminder(item.id);
        return undefined;
      },
      validated.continueOnError,
    );

    return formatBatchResults('Batch delete reminders', results, notes);
  }, 'batch delete reminders');
};
