/**
 * naturalDate.test.ts
 * All cases pin `now` so results are stable regardless of when the suite runs.
 */

import { isUnderstandableDate, normalizeDateInput } from './naturalDate.js';

// Wednesday, 2026-07-29 at 14:30 local time.
const NOW = new Date(2026, 6, 29, 14, 30, 0);

describe('normalizeDateInput', () => {
  describe('pass-through', () => {
    it('leaves already-canonical values untouched', () => {
      expect(normalizeDateInput('2026-09-08', NOW)).toBe('2026-09-08');
      expect(normalizeDateInput('2026-09-08 09:30:00', NOW)).toBe(
        '2026-09-08 09:30:00',
      );
      expect(normalizeDateInput('2026-09-08T09:30:00Z', NOW)).toBe(
        '2026-09-08T09:30:00Z',
      );
      expect(normalizeDateInput('2026-09-08T09:30:00-04:00', NOW)).toBe(
        '2026-09-08T09:30:00-04:00',
      );
    });

    it('returns unparseable text unchanged so the schema error still fires', () => {
      expect(normalizeDateInput('not-a-date', NOW)).toBe('not-a-date');
      expect(normalizeDateInput('whenever', NOW)).toBe('whenever');
      expect(normalizeDateInput('', NOW)).toBe('');
    });
  });

  describe('day words', () => {
    it('resolves today/tomorrow/yesterday', () => {
      expect(normalizeDateInput('today', NOW)).toBe('2026-07-29');
      expect(normalizeDateInput('tomorrow', NOW)).toBe('2026-07-30');
      expect(normalizeDateInput('yesterday', NOW)).toBe('2026-07-28');
      expect(normalizeDateInput('day after tomorrow', NOW)).toBe('2026-07-31');
    });

    it('handles tonight as today at 8pm', () => {
      expect(normalizeDateInput('tonight', NOW)).toBe('2026-07-29 20:00:00');
    });
  });

  describe('weekdays', () => {
    it('picks the nearest upcoming weekday for a bare or "this" name', () => {
      // Wednesday → Friday is 2 days out.
      expect(normalizeDateInput('friday', NOW)).toBe('2026-07-31');
      expect(normalizeDateInput('this friday', NOW)).toBe('2026-07-31');
      // Today is Wednesday, so a bare "wednesday" stays today.
      expect(normalizeDateInput('wednesday', NOW)).toBe('2026-07-29');
    });

    it('pushes "next <weekday>" into the following week', () => {
      expect(normalizeDateInput('next wednesday', NOW)).toBe('2026-08-05');
      expect(normalizeDateInput('next friday', NOW)).toBe('2026-07-31');
    });

    it('resolves "last <weekday>" backwards', () => {
      expect(normalizeDateInput('last monday', NOW)).toBe('2026-07-27');
      expect(normalizeDateInput('last wednesday', NOW)).toBe('2026-07-22');
    });

    it('accepts abbreviations', () => {
      expect(normalizeDateInput('mon', NOW)).toBe('2026-08-03');
      expect(normalizeDateInput('thurs', NOW)).toBe('2026-07-30');
    });
  });

  describe('times of day', () => {
    it('parses 12-hour times', () => {
      expect(normalizeDateInput('tomorrow 3pm', NOW)).toBe('2026-07-30 15:00:00');
      expect(normalizeDateInput('tomorrow at 3:45pm', NOW)).toBe(
        '2026-07-30 15:45:00',
      );
      expect(normalizeDateInput('friday 9am', NOW)).toBe('2026-07-31 09:00:00');
      expect(normalizeDateInput('tomorrow 12am', NOW)).toBe('2026-07-30 00:00:00');
      expect(normalizeDateInput('tomorrow 12pm', NOW)).toBe('2026-07-30 12:00:00');
    });

    it('parses 24-hour times', () => {
      expect(normalizeDateInput('friday at 17:00', NOW)).toBe(
        '2026-07-31 17:00:00',
      );
      expect(normalizeDateInput('monday 08:15', NOW)).toBe('2026-08-03 08:15:00');
    });

    it('parses named times', () => {
      expect(normalizeDateInput('tomorrow morning', NOW)).toBe(
        '2026-07-30 09:00:00',
      );
      expect(normalizeDateInput('tomorrow noon', NOW)).toBe('2026-07-30 12:00:00');
      expect(normalizeDateInput('friday evening', NOW)).toBe(
        '2026-07-31 18:00:00',
      );
      expect(normalizeDateInput('tomorrow midnight', NOW)).toBe(
        '2026-07-30 00:00:00',
      );
    });

    it('treats end of day as 17:00', () => {
      expect(normalizeDateInput('friday eod', NOW)).toBe('2026-07-31 17:00:00');
      expect(normalizeDateInput('tomorrow end of day', NOW)).toBe(
        '2026-07-30 17:00:00',
      );
    });

    it('rolls a bare time that already passed into tomorrow', () => {
      // 14:30 now, so 9am means tomorrow but 5pm means today.
      expect(normalizeDateInput('9am', NOW)).toBe('2026-07-30 09:00:00');
      expect(normalizeDateInput('5pm', NOW)).toBe('2026-07-29 17:00:00');
    });
  });

  describe('relative offsets', () => {
    it('handles in-N-units', () => {
      expect(normalizeDateInput('in 2 hours', NOW)).toBe('2026-07-29 16:30:00');
      expect(normalizeDateInput('in 45 minutes', NOW)).toBe(
        '2026-07-29 15:15:00',
      );
      expect(normalizeDateInput('in 3 days', NOW)).toBe('2026-08-01');
      expect(normalizeDateInput('in 2 weeks', NOW)).toBe('2026-08-12');
    });

    it('handles N-units-from-now and N-units-ago', () => {
      expect(normalizeDateInput('3 days from now', NOW)).toBe('2026-08-01');
      expect(normalizeDateInput('2 days ago', NOW)).toBe('2026-07-27');
    });

    it('handles compact offsets', () => {
      expect(normalizeDateInput('+3d', NOW)).toBe('2026-08-01');
      expect(normalizeDateInput('-1w', NOW)).toBe('2026-07-22');
      expect(normalizeDateInput('+90m', NOW)).toBe('2026-07-29 16:00:00');
    });

    it('handles week/month/year jumps', () => {
      expect(normalizeDateInput('next week', NOW)).toBe('2026-08-05');
      expect(normalizeDateInput('next month', NOW)).toBe('2026-08-29');
      expect(normalizeDateInput('next year', NOW)).toBe('2027-07-29');
      expect(normalizeDateInput('end of week', NOW)).toBe('2026-07-31');
      expect(normalizeDateInput('end of month', NOW)).toBe('2026-07-31');
    });

    it('clamps month arithmetic instead of overflowing', () => {
      // Jan 31 + 1 month must not skid into March.
      const jan31 = new Date(2026, 0, 31, 12, 0, 0);
      expect(normalizeDateInput('next month', jan31)).toBe('2026-02-28');
    });
  });

  describe('explicit calendar dates', () => {
    it('parses month names', () => {
      expect(normalizeDateInput('sep 8', NOW)).toBe('2026-09-08');
      expect(normalizeDateInput('September 8', NOW)).toBe('2026-09-08');
      expect(normalizeDateInput('8 september', NOW)).toBe('2026-09-08');
      expect(normalizeDateInput('december 3 2027', NOW)).toBe('2027-12-03');
      expect(normalizeDateInput('dec 3rd', NOW)).toBe('2026-12-03');
    });

    it('rolls a bare month-day that already passed into next year', () => {
      expect(normalizeDateInput('jan 15', NOW)).toBe('2027-01-15');
    });

    it('combines month names with times', () => {
      expect(normalizeDateInput('sep 8 at 9:30', NOW)).toBe(
        '2026-09-08 09:30:00',
      );
      expect(normalizeDateInput('december 12 11:59pm', NOW)).toBe(
        '2026-12-12 23:59:00',
      );
    });

    it('parses slash dates month-first, falling back to day-first', () => {
      expect(normalizeDateInput('9/8', NOW)).toBe('2026-09-08');
      expect(normalizeDateInput('12/25/2026', NOW)).toBe('2026-12-25');
      expect(normalizeDateInput('25/12', NOW)).toBe('2026-12-25');
      expect(normalizeDateInput('3/4/27', NOW)).toBe('2027-03-04');
    });

    it('rejects impossible slash dates', () => {
      expect(normalizeDateInput('13/45', NOW)).toBe('13/45');
    });
  });

  describe('filler words', () => {
    it('ignores leading connectives', () => {
      expect(normalizeDateInput('on friday', NOW)).toBe('2026-07-31');
      expect(normalizeDateInput('by tomorrow 5pm', NOW)).toBe(
        '2026-07-30 17:00:00',
      );
      expect(normalizeDateInput('due next monday', NOW)).toBe('2026-08-03');
    });

    it('is case and whitespace insensitive', () => {
      expect(normalizeDateInput('  TOMORROW  3PM ', NOW)).toBe(
        '2026-07-30 15:00:00',
      );
      expect(normalizeDateInput('Next Friday', NOW)).toBe('2026-07-31');
    });
  });
});

describe('isUnderstandableDate', () => {
  it('reports whether a value will survive validation', () => {
    expect(isUnderstandableDate('tomorrow 3pm')).toBe(true);
    expect(isUnderstandableDate('2026-09-08')).toBe(true);
    expect(isUnderstandableDate('gibberish')).toBe(false);
  });
});
