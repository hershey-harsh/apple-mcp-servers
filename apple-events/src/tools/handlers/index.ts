/**
 * handlers/index.ts
 * Unified exports for all tool handlers
 */

export {
  handleCreateCalendar,
  handleCreateCalendarEvent,
  handleDeleteCalendar,
  handleDeleteCalendarEvent,
  handleReadCalendarEvents,
  handleReadCalendars,
  handleUpdateCalendar,
  handleUpdateCalendarEvent,
} from './calendarHandlers.js';

export {
  handleBatchCompleteReminders,
  handleBatchCreateEvents,
  handleBatchCreateReminders,
  handleBatchDeleteEvents,
  handleBatchDeleteReminders,
  handleBatchUpdateReminders,
  handleCancelOccurrences,
  handleCreateClassSchedule,
  handleScheduleStudyBlocks,
} from './batchHandlers.js';

export {
  handleCreateReminderList,
  handleDeleteReminderList,
  handleReadReminderLists,
  handleUpdateReminderList,
} from './listHandlers.js';
export {
  handleCreateReminder,
  handleDeleteReminder,
  handleReadReminders,
  handleUpdateReminder,
} from './reminderHandlers.js';

export {
  handleAgenda,
  handleConflicts,
  handleFreeSlots,
  handleHops,
} from './scheduleHandlers.js';

export {
  handleCreateSubtask,
  handleDeleteSubtask,
  handleReadSubtasks,
  handleReorderSubtasks,
  handleToggleSubtask,
  handleUpdateSubtask,
} from './subtaskHandlers.js';
