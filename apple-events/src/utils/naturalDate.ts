/**
 * naturalDate.ts
 * Normalizes human phrasing ("tomorrow 3pm", "next monday", "in 2 hours") into the
 * `YYYY-MM-DD[ HH:mm:ss]` form EventKitCLI already accepts.
 *
 * Anything already in an accepted format is returned untouched, and anything that
 * cannot be understood is returned untouched too — so the existing schema error is
 * what the caller sees, rather than a wrong date silently landing in their calendar.
 */

/** Already-supported inputs: YYYY-MM-DD, YYYY-MM-DD HH:mm:ss, ISO 8601. */
const ALREADY_NORMALIZED = /^\d{4}-\d{2}-\d{2}/;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  weds: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/** Named times of day, in hours. */
const NAMED_TIMES: Record<string, number> = {
  midnight: 0,
  noon: 12,
  midday: 12,
  morning: 9,
  afternoon: 14,
  evening: 18,
  tonight: 20,
  night: 20,
};

const pad = (value: number): string => String(value).padStart(2, '0');

const formatLocal = (date: Date, includeTime: boolean): string => {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (!includeTime) return day;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const startOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

/**
 * Adds months while clamping the day, so "next month" from Jan 31 lands on Feb 28/29
 * rather than skidding into March the way bare setMonth() does.
 */
const addMonths = (date: Date, months: number): Date => {
  const copy = new Date(date);
  const targetDay = copy.getDate();
  copy.setDate(1);
  copy.setMonth(copy.getMonth() + months);
  const daysInTarget = new Date(
    copy.getFullYear(),
    copy.getMonth() + 1,
    0,
  ).getDate();
  copy.setDate(Math.min(targetDay, daysInTarget));
  return copy;
};

interface TimeOfDay {
  hours: number;
  minutes: number;
  seconds: number;
}

interface ExtractedTime {
  /** Input with the time phrase removed. */
  rest: string;
  time?: TimeOfDay;
}

const to24Hour = (hour: number, meridiem: string): number => {
  const normalized = hour % 12;
  return meridiem === 'pm' ? normalized + 12 : normalized;
};

/**
 * Pulls a time-of-day phrase out of the text, returning the remainder so the
 * day portion can be resolved independently.
 */
const extractTime = (input: string): ExtractedTime => {
  // 12-hour with optional minutes: "3pm", "3:30 pm", "at 11:15am"
  const meridiemMatch = input.match(
    /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)\b/,
  );
  if (meridiemMatch) {
    const hour = Number(meridiemMatch[1]);
    if (hour >= 1 && hour <= 12) {
      return {
        rest: input.replace(meridiemMatch[0], ' '),
        time: {
          hours: to24Hour(hour, meridiemMatch[4]),
          minutes: Number(meridiemMatch[2] ?? 0),
          seconds: Number(meridiemMatch[3] ?? 0),
        },
      };
    }
  }

  // 24-hour clock: "14:00", "at 09:30:00"
  const clockMatch = input.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (clockMatch) {
    const hours = Number(clockMatch[1]);
    const minutes = Number(clockMatch[2]);
    const seconds = Number(clockMatch[3] ?? 0);
    if (hours <= 23 && minutes <= 59 && seconds <= 59) {
      return {
        rest: input.replace(clockMatch[0], ' '),
        time: { hours, minutes, seconds },
      };
    }
  }

  // "end of day" / "eod" — treated as 17:00, matching the working-day end used elsewhere.
  const eodMatch = input.match(/\b(?:eod|end\s+of\s+(?:the\s+)?day)\b/);
  if (eodMatch) {
    return {
      rest: input.replace(eodMatch[0], ' '),
      time: { hours: 17, minutes: 0, seconds: 0 },
    };
  }

  // Named times. "tonight" also carries a day meaning, so it is left in `rest`.
  for (const [name, hours] of Object.entries(NAMED_TIMES)) {
    const namedMatch = input.match(new RegExp(`\\b(?:in\\s+the\\s+)?${name}\\b`));
    if (namedMatch) {
      const rest = name === 'tonight' ? input : input.replace(namedMatch[0], ' ');
      return { rest, time: { hours, minutes: 0, seconds: 0 } };
    }
  }

  return { rest: input };
};

const RELATIVE_UNITS: Record<string, 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'> =
  {
    min: 'minute',
    mins: 'minute',
    minute: 'minute',
    minutes: 'minute',
    hr: 'hour',
    hrs: 'hour',
    hour: 'hour',
    hours: 'hour',
    day: 'day',
    days: 'day',
    week: 'week',
    weeks: 'week',
    wk: 'week',
    wks: 'week',
    month: 'month',
    months: 'month',
    year: 'year',
    years: 'year',
  };

const applyOffset = (
  base: Date,
  amount: number,
  unit: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year',
): Date => {
  const copy = new Date(base);
  switch (unit) {
    case 'minute':
      copy.setMinutes(copy.getMinutes() + amount);
      return copy;
    case 'hour':
      copy.setHours(copy.getHours() + amount);
      return copy;
    case 'day':
      return addDays(copy, amount);
    case 'week':
      return addDays(copy, amount * 7);
    case 'month':
      return addMonths(copy, amount);
    case 'year':
      return addMonths(copy, amount * 12);
  }
};

/**
 * Resolves the upcoming occurrence of a weekday.
 * `includeToday` keeps today when it already is that weekday ("this friday" on a Friday).
 */
const nextWeekday = (from: Date, weekday: number, includeToday: boolean): Date => {
  const current = from.getDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(from, delta);
};

interface ResolvedDay {
  date: Date;
  /** True when the phrase itself implies a clock time (e.g. "in 2 hours"). */
  impliesTime: boolean;
}

const resolveDayPhrase = (phrase: string, now: Date): ResolvedDay | undefined => {
  const text = phrase.replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;

  if (/^now$/.test(text)) return { date: new Date(now), impliesTime: true };
  if (/^(?:today|tod)$/.test(text)) return { date: startOfDay(now), impliesTime: false };
  if (/^tonight$/.test(text)) return { date: startOfDay(now), impliesTime: true };
  if (/^(?:tomorrow|tmrw|tmr)$/.test(text)) {
    return { date: startOfDay(addDays(now, 1)), impliesTime: false };
  }
  if (/^yesterday$/.test(text)) {
    return { date: startOfDay(addDays(now, -1)), impliesTime: false };
  }
  if (/^day after tomorrow$/.test(text)) {
    return { date: startOfDay(addDays(now, 2)), impliesTime: false };
  }
  if (/^(?:next|this coming) week$/.test(text)) {
    return { date: startOfDay(addDays(now, 7)), impliesTime: false };
  }
  if (/^last week$/.test(text)) {
    return { date: startOfDay(addDays(now, -7)), impliesTime: false };
  }
  if (/^next month$/.test(text)) {
    return { date: startOfDay(addMonths(now, 1)), impliesTime: false };
  }
  if (/^last month$/.test(text)) {
    return { date: startOfDay(addMonths(now, -1)), impliesTime: false };
  }
  if (/^next year$/.test(text)) {
    return { date: startOfDay(addMonths(now, 12)), impliesTime: false };
  }
  // "end of week" resolves to the upcoming Friday — the practical end of a school week.
  if (/^end of (?:the )?week$/.test(text)) {
    return { date: startOfDay(nextWeekday(now, 5, true)), impliesTime: false };
  }
  if (/^end of (?:the )?month$/.test(text)) {
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { date: startOfDay(endOfMonth), impliesTime: false };
  }

  // "in 2 hours", "2 days from now", "after 30 minutes"
  const relative = text.match(
    /^(?:in|after)\s+(\d+)\s+([a-z]+)$|^(\d+)\s+([a-z]+)\s+(?:from now|later|ahead)$/,
  );
  if (relative) {
    const amount = Number(relative[1] ?? relative[3]);
    const unit = RELATIVE_UNITS[relative[2] ?? relative[4]];
    if (unit && Number.isFinite(amount)) {
      const date = applyOffset(now, amount, unit);
      return {
        date: unit === 'minute' || unit === 'hour' ? date : startOfDay(date),
        impliesTime: unit === 'minute' || unit === 'hour',
      };
    }
  }

  // "2 days ago"
  const ago = text.match(/^(\d+)\s+([a-z]+)\s+ago$/);
  if (ago) {
    const unit = RELATIVE_UNITS[ago[2]];
    if (unit) {
      const date = applyOffset(now, -Number(ago[1]), unit);
      return {
        date: unit === 'minute' || unit === 'hour' ? date : startOfDay(date),
        impliesTime: unit === 'minute' || unit === 'hour',
      };
    }
  }

  // Compact offsets: "+3d", "-2w", "+90m"
  const compact = text.match(/^([+-])\s*(\d+)\s*([a-z]+)$/);
  if (compact) {
    const unitKey = compact[3];
    const unit =
      RELATIVE_UNITS[unitKey] ??
      ({ d: 'day', h: 'hour', m: 'minute', w: 'week', y: 'year' } as const)[unitKey];
    if (unit) {
      const signed = compact[1] === '-' ? -Number(compact[2]) : Number(compact[2]);
      const date = applyOffset(now, signed, unit);
      return {
        date: unit === 'minute' || unit === 'hour' ? date : startOfDay(date),
        impliesTime: unit === 'minute' || unit === 'hour',
      };
    }
  }

  // Weekdays, with or without a next/this/last qualifier.
  const weekdayMatch = text.match(/^(?:(next|this|coming|last|upcoming)\s+)?([a-z]+)$/);
  if (weekdayMatch) {
    const weekday = WEEKDAYS[weekdayMatch[2]];
    if (weekday !== undefined) {
      const qualifier = weekdayMatch[1];
      if (qualifier === 'last') {
        const current = now.getDay();
        const delta = ((current - weekday + 7) % 7) || 7;
        return { date: startOfDay(addDays(now, -delta)), impliesTime: false };
      }
      // "next friday" means the one in the following week, even mid-week;
      // "this"/"coming"/bare mean the nearest upcoming one (today included).
      if (qualifier === 'next') {
        return {
          date: startOfDay(addDays(nextWeekday(now, weekday, false), 0)),
          impliesTime: false,
        };
      }
      return { date: startOfDay(nextWeekday(now, weekday, true)), impliesTime: false };
    }
  }

  // Month-name dates: "jan 15", "15 january", "december 3 2027"
  const monthFirst = text.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/);
  const dayFirst = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:\s+(\d{4}))?$/);
  const monthNamed = monthFirst ?? dayFirst;
  if (monthNamed) {
    const monthKey = monthFirst ? monthNamed[1] : monthNamed[2];
    const dayValue = Number(monthFirst ? monthNamed[2] : monthNamed[1]);
    const month = MONTHS[monthKey];
    if (month !== undefined && dayValue >= 1 && dayValue <= 31) {
      const explicitYear = monthNamed[3] ? Number(monthNamed[3]) : undefined;
      let year = explicitYear ?? now.getFullYear();
      // With no year given, a date that already passed means next year.
      if (explicitYear === undefined) {
        const candidate = new Date(year, month, dayValue);
        if (candidate < startOfDay(now)) year += 1;
      }
      const resolved = new Date(year, month, dayValue);
      if (resolved.getMonth() === month && resolved.getDate() === dayValue) {
        return { date: resolved, impliesTime: false };
      }
    }
  }

  // Slash dates. Interpreted month-first (US convention); a first part above 12 is
  // read day-first so "25/12" still works instead of failing outright.
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const month = first > 12 ? second - 1 : first - 1;
    const dayValue = first > 12 ? first : second;
    let year = now.getFullYear();
    if (slash[3]) {
      const raw = Number(slash[3]);
      year = raw < 100 ? 2000 + raw : raw;
    }
    const resolved = new Date(year, month, dayValue);
    if (
      month >= 0 &&
      month <= 11 &&
      resolved.getMonth() === month &&
      resolved.getDate() === dayValue
    ) {
      return { date: resolved, impliesTime: false };
    }
  }

  return undefined;
};

/**
 * Converts a human date/time phrase into `YYYY-MM-DD` or `YYYY-MM-DD HH:mm:ss`.
 * Returns the input unchanged when it is already normalized or is not understood.
 *
 * @param value Raw user/model-supplied date text.
 * @param now Reference point for relative phrases; injectable for tests.
 */
export const normalizeDateInput = (value: string, now: Date = new Date()): string => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || ALREADY_NORMALIZED.test(trimmed)) return trimmed;

  const lowered = trimmed
    .toLowerCase()
    // Drop connective filler so "on friday at 5pm" and "by tomorrow" both parse.
    .replace(/^(?:on|by|due|starting|starts|from)\s+/, '')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const { rest, time } = extractTime(lowered);
  const dayPhrase = rest.replace(/\bat\b/g, ' ').replace(/\s+/g, ' ').trim();

  // A bare time with no day means today (or tomorrow if that time already passed).
  if (!dayPhrase && time) {
    const candidate = new Date(now);
    candidate.setHours(time.hours, time.minutes, time.seconds, 0);
    const target = candidate < now ? addDays(candidate, 1) : candidate;
    return formatLocal(target, true);
  }

  const resolved = resolveDayPhrase(dayPhrase, now);
  if (!resolved) return trimmed;

  if (time) {
    const withTime = new Date(resolved.date);
    withTime.setHours(time.hours, time.minutes, time.seconds, 0);
    return formatLocal(withTime, true);
  }

  return formatLocal(resolved.date, resolved.impliesTime);
};

/**
 * True when a value is a date string this module (or the CLI) can make sense of.
 * Used by tools that want to reject nonsense before doing any work.
 */
export const isUnderstandableDate = (value: string): boolean =>
  ALREADY_NORMALIZED.test(normalizeDateInput(value));
