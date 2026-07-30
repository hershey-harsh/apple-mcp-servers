/**
 * handlers/shared.ts
 * Shared helper functions for all handlers
 */

import type { output, ZodTypeAny } from 'zod/v3';
import type {
  BatchItemResult,
  CalendarBatchToolArgs,
  CalendarsToolArgs,
  CalendarToolArgs,
  ListsToolArgs,
  RemindersToolArgs,
  ReminderBatchToolArgs,
  ScheduleToolArgs,
  SubtasksToolArgs,
} from '../../types/index.js';
import { validateInput } from '../../validation/schemas.js';

export type AnyToolArgs =
  | RemindersToolArgs
  | ListsToolArgs
  | SubtasksToolArgs
  | CalendarToolArgs
  | CalendarsToolArgs
  | ScheduleToolArgs
  | CalendarBatchToolArgs
  | ReminderBatchToolArgs;

/**
 * Extracts and validates arguments by removing action and validating the rest
 */
export const extractAndValidateArgs = <TSchema extends ZodTypeAny>(
  args: AnyToolArgs | undefined,
  schema: TSchema,
): output<TSchema> => {
  const { action: _, ...rest } = args ?? {};
  return validateInput(schema, rest);
};

/**
 * Runs an operation over many items sequentially, recording each outcome instead of
 * aborting the whole call on the first failure. EventKit writes are not safely
 * parallelizable against one store, so this stays serial on purpose.
 */
export const runBatch = async <TItem>(
  items: TItem[],
  labelOf: (item: TItem, index: number) => string,
  operation: (item: TItem, index: number) => Promise<string | undefined>,
  continueOnError: boolean,
): Promise<BatchItemResult[]> => {
  const results: BatchItemResult[] = [];

  for (const [index, item] of items.entries()) {
    const label = labelOf(item, index);
    try {
      const id = await operation(item, index);
      results.push({ index, label, ok: true, id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ index, label, ok: false, message });
      if (!continueOnError) break;
    }
  }

  return results;
};

/**
 * Renders batch outcomes with a headline count, so a partial success is never
 * mistaken for a clean run.
 */
export const formatBatchResults = (
  operation: string,
  results: BatchItemResult[],
  extraLines: string[] = [],
): string => {
  const succeeded = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);

  const lines = [
    `### ${operation}: ${succeeded.length} succeeded, ${failed.length} failed`,
    '',
  ];

  if (extraLines.length > 0) {
    lines.push(...extraLines, '');
  }

  if (succeeded.length > 0) {
    lines.push('**Succeeded**');
    succeeded.forEach((result) => {
      lines.push(`- ${result.label}${result.id ? ` — ID: ${result.id}` : ''}`);
    });
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push('**Failed**');
    failed.forEach((result) => {
      lines.push(`- ${result.label} — ${result.message ?? 'unknown error'}`);
    });
  }

  return lines.join('\n').trimEnd();
};

/**
 * Formats a list of items as markdown with header and empty state message
 */
export const formatListMarkdown = <T>(
  title: string,
  items: T[],
  formatItem: (item: T) => string[],
  emptyMessage: string,
): string => {
  const lines: string[] = [`### ${title} (Total: ${items.length})`, ''];

  if (items.length === 0) {
    lines.push(emptyMessage);
  } else {
    items.forEach((item) => {
      lines.push(...formatItem(item));
    });
  }

  return lines.join('\n');
};

/**
 * Formats a success message with ID for created/updated items
 */
export const formatSuccessMessage = (
  action: 'created' | 'updated',
  itemType: string,
  title: string,
  id: string,
): string => {
  const actionText = action === 'created' ? 'created' : 'updated';
  const prefix =
    action === 'updated' && itemType === 'list'
      ? `Successfully updated ${itemType} to`
      : `Successfully ${actionText} ${itemType}`;
  return `${prefix} "${title}".\n- ID: ${id}`;
};

/**
 * Formats a delete success message
 */
export const formatDeleteMessage = (
  itemType: string,
  identifier: string,
  options: {
    useQuotes?: boolean;
    useIdPrefix?: boolean;
    usePeriod?: boolean;
    useColon?: boolean;
  } = {},
): string => {
  const {
    useQuotes = true,
    useIdPrefix = true,
    usePeriod = true,
    useColon = true,
  } = options;
  const formattedId = useQuotes ? `"${identifier}"` : identifier;
  let idPart: string;
  if (useIdPrefix) {
    const separator = useColon ? ': ' : ' ';
    idPart = `with ID${separator}${formattedId}`;
  } else {
    idPart = formattedId;
  }
  const period = usePeriod ? '.' : '';
  return `Successfully deleted ${itemType} ${idPart}${period}`;
};
