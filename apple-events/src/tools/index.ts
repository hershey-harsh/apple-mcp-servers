/**
 * tools/index.ts
 * Tool routing: normalizes names, dispatches to handlers
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  CalendarBatchToolArgs,
  CalendarsToolArgs,
  CalendarToolArgs,
  ListsToolArgs,
  RemindersToolArgs,
  ReminderBatchToolArgs,
  ScheduleToolArgs,
  SubtasksToolArgs,
} from '../types/index.js';
import { MESSAGES, TOOLS as TOOL_NAMES } from '../utils/constants.js';
import { TOOLS } from './definitions.js';
import {
  handleAgenda,
  handleBatchCompleteReminders,
  handleBatchCreateEvents,
  handleBatchCreateReminders,
  handleBatchDeleteEvents,
  handleBatchDeleteReminders,
  handleBatchUpdateReminders,
  handleCancelOccurrences,
  handleConflicts,
  handleCreateCalendar,
  handleCreateCalendarEvent,
  handleCreateClassSchedule,
  handleCreateReminder,
  handleCreateReminderList,
  handleCreateSubtask,
  handleDeleteCalendar,
  handleDeleteCalendarEvent,
  handleDeleteReminder,
  handleDeleteReminderList,
  handleDeleteSubtask,
  handleReadCalendarEvents,
  handleReadCalendars,
  handleReadReminderLists,
  handleReadReminders,
  handleReadSubtasks,
  handleReorderSubtasks,
  handleFreeSlots,
  handleScheduleStudyBlocks,
  handleToggleSubtask,
  handleUpdateCalendar,
  handleUpdateCalendarEvent,
  handleUpdateReminder,
  handleUpdateReminderList,
  handleUpdateSubtask,
} from './handlers/index.js';

type ToolArgs =
  | RemindersToolArgs
  | ListsToolArgs
  | SubtasksToolArgs
  | CalendarToolArgs
  | CalendarsToolArgs
  | ScheduleToolArgs
  | CalendarBatchToolArgs
  | ReminderBatchToolArgs;

type ToolRouter = (args?: ToolArgs) => Promise<CallToolResult>;

type ActionHandler<TArgs extends { action: string }> = (
  args: TArgs,
) => Promise<CallToolResult>;

type RoutedToolName =
  | 'reminders_tasks'
  | 'reminders_lists'
  | 'reminders_subtasks'
  | 'calendar_events'
  | 'calendar_calendars'
  | 'calendar_schedule'
  | 'calendar_batch'
  | 'reminders_batch';
type ToolName = RoutedToolName;

/**
 * Creates an action router for tools with multiple actions
 */
const createActionRouter = <TArgs extends { action: string }>(
  toolName: RoutedToolName,
  handlerMap: Record<TArgs['action'], ActionHandler<TArgs>>,
  // When provided, this action is used if the call omits `action` (or args entirely),
  // e.g. `calendar_calendars` defaults to `read` so listing needs no arguments.
  defaultAction?: TArgs['action'],
): ToolRouter => {
  return async (args?: ToolArgs) => {
    if (!args) {
      if (defaultAction === undefined) {
        return createErrorResponse('No arguments provided');
      }
      // args is undefined here; the default (read) handler tolerates that.
      return handlerMap[defaultAction as keyof typeof handlerMap](
        args as unknown as TArgs,
      );
    }

    const typedArgs = args as TArgs;
    const action = (typedArgs.action ?? defaultAction) as TArgs['action'];

    if (!(action in handlerMap)) {
      return createErrorResponse(
        MESSAGES.ERROR.UNKNOWN_ACTION(toolName, String(typedArgs.action)),
      );
    }

    const handler = handlerMap[action as keyof typeof handlerMap];
    return handler(typedArgs);
  };
};

const TOOL_ROUTER_MAP = {
  [TOOL_NAMES.REMINDERS_TASKS]: createActionRouter<RemindersToolArgs>(
    TOOL_NAMES.REMINDERS_TASKS,
    {
      read: (reminderArgs) => handleReadReminders(reminderArgs),
      create: (reminderArgs) => handleCreateReminder(reminderArgs),
      update: (reminderArgs) => handleUpdateReminder(reminderArgs),
      delete: (reminderArgs) => handleDeleteReminder(reminderArgs),
    },
  ),
  [TOOL_NAMES.REMINDERS_LISTS]: createActionRouter<ListsToolArgs>(
    TOOL_NAMES.REMINDERS_LISTS,
    {
      read: async (_listArgs) => handleReadReminderLists(),
      create: (listArgs) => handleCreateReminderList(listArgs),
      update: (listArgs) => handleUpdateReminderList(listArgs),
      delete: (listArgs) => handleDeleteReminderList(listArgs),
    },
  ),
  [TOOL_NAMES.REMINDERS_SUBTASKS]: createActionRouter<SubtasksToolArgs>(
    TOOL_NAMES.REMINDERS_SUBTASKS,
    {
      read: (subtaskArgs) => handleReadSubtasks(subtaskArgs),
      create: (subtaskArgs) => handleCreateSubtask(subtaskArgs),
      update: (subtaskArgs) => handleUpdateSubtask(subtaskArgs),
      delete: (subtaskArgs) => handleDeleteSubtask(subtaskArgs),
      toggle: (subtaskArgs) => handleToggleSubtask(subtaskArgs),
      reorder: (subtaskArgs) => handleReorderSubtasks(subtaskArgs),
    },
  ),
  [TOOL_NAMES.CALENDAR_EVENTS]: createActionRouter<CalendarToolArgs>(
    TOOL_NAMES.CALENDAR_EVENTS,
    {
      read: (calendarArgs) => handleReadCalendarEvents(calendarArgs),
      create: (calendarArgs) => handleCreateCalendarEvent(calendarArgs),
      update: (calendarArgs) => handleUpdateCalendarEvent(calendarArgs),
      delete: (calendarArgs) => handleDeleteCalendarEvent(calendarArgs),
    },
  ),
  [TOOL_NAMES.CALENDAR_CALENDARS]: createActionRouter<CalendarsToolArgs>(
    TOOL_NAMES.CALENDAR_CALENDARS,
    {
      read: (calendarsArgs) => handleReadCalendars(calendarsArgs),
      create: (calendarsArgs) => handleCreateCalendar(calendarsArgs),
      update: (calendarsArgs) => handleUpdateCalendar(calendarsArgs),
      delete: (calendarsArgs) => handleDeleteCalendar(calendarsArgs),
    },
    'read',
  ),
  [TOOL_NAMES.CALENDAR_SCHEDULE]: createActionRouter<ScheduleToolArgs>(
    TOOL_NAMES.CALENDAR_SCHEDULE,
    {
      agenda: (scheduleArgs) => handleAgenda(scheduleArgs),
      'free-slots': (scheduleArgs) => handleFreeSlots(scheduleArgs),
      conflicts: (scheduleArgs) => handleConflicts(scheduleArgs),
    },
    // Asking for "my schedule" with no action should show the agenda.
    'agenda',
  ),
  [TOOL_NAMES.CALENDAR_BATCH]: createActionRouter<CalendarBatchToolArgs>(
    TOOL_NAMES.CALENDAR_BATCH,
    {
      'create-events': (batchArgs) => handleBatchCreateEvents(batchArgs),
      'delete-events': (batchArgs) => handleBatchDeleteEvents(batchArgs),
      'cancel-occurrences': (batchArgs) => handleCancelOccurrences(batchArgs),
      'create-class-schedule': (batchArgs) =>
        handleCreateClassSchedule(batchArgs),
      'schedule-study-blocks': (batchArgs) =>
        handleScheduleStudyBlocks(batchArgs),
    },
  ),
  [TOOL_NAMES.REMINDERS_BATCH]: createActionRouter<ReminderBatchToolArgs>(
    TOOL_NAMES.REMINDERS_BATCH,
    {
      create: (batchArgs) => handleBatchCreateReminders(batchArgs),
      update: (batchArgs) => handleBatchUpdateReminders(batchArgs),
      complete: (batchArgs) => handleBatchCompleteReminders(batchArgs),
      delete: (batchArgs) => handleBatchDeleteReminders(batchArgs),
    },
  ),
} satisfies Record<ToolName, ToolRouter>;

const isManagedToolName = (value: string): value is ToolName =>
  value in TOOL_ROUTER_MAP;

/**
 * Creates an error response with the given message
 */
function createErrorResponse(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export async function handleToolCall(
  name: string,
  args?: ToolArgs,
): Promise<CallToolResult> {
  if (!isManagedToolName(name)) {
    return createErrorResponse(MESSAGES.ERROR.UNKNOWN_TOOL(name));
  }

  const router = TOOL_ROUTER_MAP[name];
  return router(args);
}

export { TOOLS };
