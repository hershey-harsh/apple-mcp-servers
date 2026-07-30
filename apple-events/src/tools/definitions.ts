/**
 * tools/definitions.ts
 * MCP tool definitions for Apple Reminders server, adhering to standard JSON Schema.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  CALENDAR_ACTIONS,
  CALENDAR_BATCH_ACTIONS,
  DUE_WITHIN_OPTIONS,
  LIST_ACTIONS,
  REMINDER_ACTIONS,
  REMINDER_BATCH_ACTIONS,
  SCHEDULE_ACTIONS,
} from '../types/index.js';

/**
 * Shared prose for the date fields. Every date parameter in this server accepts
 * plain language, so the model never has to compute a timestamp itself.
 */
// Repeated on ~20 date fields, so every word here costs ~20x in the tool payload.
// Keep it to the format plus enough examples to signal that plain language parses.
const DATE_HINT =
  "'YYYY-MM-DD[ HH:mm:ss]', ISO 8601, or plain language ('tomorrow 3pm', 'next monday', 'in 2 hours', '+3d', 'end of week').";

/** Reusable JSON Schema for a weekday list in EventKit's numbering. */
const WEEKDAYS_PROPERTY = {
  type: 'array' as const,
  items: { type: 'integer' as const, minimum: 1, maximum: 7 },
  description:
    'Weekdays as 1=Sunday, 2=Monday … 7=Saturday. A Mon/Wed/Fri class is [2,4,6]; a Tue/Thu class is [3,5].',
};

/** Reusable alarm array schema, shared by the batch/class tools. */
const ALARMS_PROPERTY = {
  type: 'array' as const,
  description:
    'Each alarm needs exactly one trigger: relativeOffset, absoluteDate, or locationTrigger. soundName or emailAddress optionally set the action.',
  items: {
    type: 'object' as const,
    properties: {
      relativeOffset: {
        type: 'number' as const,
        description: 'Seconds from the start; negative fires before (-600 = 10 min before).',
      },
      absoluteDate: { type: 'string' as const, description: DATE_HINT },
      soundName: {
        type: 'string' as const,
        description: 'System sound for an audible alarm (e.g. "Basso", "Ping", "Glass").',
      },
      emailAddress: {
        type: 'string' as const,
        description: 'Email alarm recipient. Takes precedence over soundName.',
      },
    },
  },
};

export const TOOLS: Tool[] = [
  {
    name: 'reminders_tasks',
    description:
      'Manages reminder tasks. Supports reading, creating, updating, and deleting reminders. Cross-server: to turn an email into a reminder, fetch it with the Apple Mail MCP (search_emails / get_email_thread) and pass its subject and any due date here.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: REMINDER_ACTIONS,
          description: 'The operation to perform.',
        },
        // ID-based operations
        id: {
          type: 'string',
          description:
            'The unique identifier of the reminder (REQUIRED for update, delete; optional for read to get single reminder).',
        },
        // Creation/Update properties
        title: {
          type: 'string',
          description:
            'The title of the reminder (REQUIRED for create, optional for update).',
        },
        startDate: {
          type: 'string',
          description: `Start date. ${DATE_HINT} Times without a timezone are local.`,
        },
        dueDate: {
          type: 'string',
          description: `Due date. ${DATE_HINT} Times without a timezone are local.`,
        },
        completionDate: {
          type: 'string',
          description:
            'Completion date/time (for update). When provided, sets the completion date of the reminder.',
        },
        note: {
          type: 'string',
          description: 'Additional notes for the reminder.',
        },
        location: {
          type: 'string',
          description:
            'Location text for the reminder (EKCalendarItem.location). Not the same as a location-based trigger.',
        },
        url: {
          type: 'string',
          description: 'A URL to associate with the reminder.',
          format: 'uri',
        },
        completed: {
          type: 'boolean',
          description: 'The completion status of the reminder (for update).',
        },
        priority: {
          type: 'integer',
          enum: [0, 1, 5, 9],
          description:
            'Priority level: 0=none, 1=high, 5=medium, 9=low (for create/update).',
        },
        alarms: {
          type: 'array',
          description:
            'Alarms for the reminder (EKCalendarItem.alarms). Each alarm must specify exactly one of relativeOffset (seconds), absoluteDate, or locationTrigger.',
          items: {
            type: 'object',
            properties: {
              relativeOffset: {
                type: 'number',
                description:
                  'Seconds offset for a relative alarm (negative = before due/start). Example: -900 for 15 minutes before. TRAVEL-TIME / "time to leave" alarms: fetch the trip duration from the Apple Maps MCP (maps_get_directions -> expected_travel_time_seconds), then set relativeOffset to the negative of that duration (optionally plus a buffer) so the alarm fires exactly when you need to depart. Combine with the location field to record where you are heading.',
              },
              absoluteDate: {
                type: 'string',
                description:
                  'Absolute trigger date/time for the alarm. Supports the same formats as dueDate.',
              },
              locationTrigger: {
                type: 'object',
                description:
                  'Location-based (geofence) alarm. Equivalent to setting EKAlarm.structuredLocation + proximity. Cross-server: get latitude/longitude for a place from the Apple Maps MCP place-search tool (maps_search_places), then set proximity "enter" to alert on arrival or "leave" to alert on departure.',
                properties: {
                  title: {
                    type: 'string',
                    description:
                      'Location name/title (e.g., "Home", "Office").',
                  },
                  latitude: {
                    type: 'number',
                    description: 'Latitude coordinate of the location.',
                  },
                  longitude: {
                    type: 'number',
                    description: 'Longitude coordinate of the location.',
                  },
                  radius: {
                    type: 'number',
                    description: 'Geofence radius in meters (default 100).',
                    default: 100,
                  },
                  proximity: {
                    type: 'string',
                    enum: ['enter', 'leave'],
                    description:
                      'When to trigger: "enter" fires when arriving, "leave" fires when departing.',
                  },
                },
                required: ['title', 'latitude', 'longitude', 'proximity'],
              },
              soundName: {
                type: 'string',
                description:
                  'Optional alarm ACTION (macOS-only): name of a system sound to play when the alarm fires (sets EKAlarm.soundName, making it an "audio" alarm). Example: "Basso", "Ping", "Glass". Mutually exclusive with emailAddress.',
              },
              emailAddress: {
                type: 'string',
                description:
                  'Optional alarm ACTION (macOS-only): email address to notify when the alarm fires (sets EKAlarm.emailAddress, making it an "email" alarm). Takes precedence over soundName if both are given. Note: "procedure" (run-script / open-URL) alarms are intentionally unsupported — Apple deprecated them in OS X 10.9 and saving one errors.',
              },
              alarmType: {
                type: 'string',
                enum: ['display', 'audio', 'procedure', 'email'],
                description:
                  'READ-ONLY: Alarm presentation type (EKAlarm.type). Derived from the action fields: set soundName for "audio", emailAddress for "email"; with neither it is "display" (a notification). "procedure" is legacy and unsupported. Do not set this directly.',
              },
            },
          },
        },
        clearAlarms: {
          type: 'boolean',
          description: 'Set to true to remove all alarms from the reminder.',
        },
        targetList: {
          type: 'string',
          description: 'The name of the list for create or update operations.',
        },
        // Read filters
        filterList: {
          type: 'string',
          description: 'Filter reminders by a specific list name.',
        },
        showCompleted: {
          type: 'boolean',
          description: 'Include completed reminders in the results.',
          default: false,
        },
        search: {
          type: 'string',
          description: 'A search term to filter reminders by title or notes.',
        },
        dueWithin: {
          type: 'string',
          enum: DUE_WITHIN_OPTIONS,
          description: 'Filter reminders by a due date range.',
        },
        filterPriority: {
          type: 'string',
          enum: ['high', 'medium', 'low', 'none'],
          description: 'Filter reminders by priority level.',
        },
        filterRecurring: {
          type: 'boolean',
          description: 'Filter to only show recurring reminders when true.',
        },
        // Recurrence properties for create/update
        recurrence: {
          type: 'object',
          description:
            'Recurrence rule for repeating reminders. Set to create/update recurring reminders.',
          properties: {
            frequency: {
              type: 'string',
              enum: ['daily', 'weekly', 'monthly', 'yearly'],
              description: 'How often the reminder repeats.',
            },
            interval: {
              type: 'integer',
              description:
                'Interval between occurrences (e.g., 2 for every 2 weeks). Defaults to 1.',
              default: 1,
            },
            endDate: {
              type: 'string',
              description:
                'When the recurrence ends (YYYY-MM-DD format). Optional.',
            },
            occurrenceCount: {
              type: 'integer',
              description:
                'Number of times to repeat (e.g., 10 for repeat 10 times). Optional.',
            },
            daysOfWeek: {
              type: 'array',
              items: { type: 'integer' },
              description:
                'Days of week for weekly recurrence (1=Sunday, 7=Saturday). Optional.',
            },
            daysOfMonth: {
              type: 'array',
              items: { type: 'integer' },
              description:
                'Days of month for monthly recurrence (1-31). Optional.',
            },
            monthsOfYear: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Months for yearly recurrence (1-12). Optional.',
            },
          },
          required: ['frequency'],
        },
        recurrenceRules: {
          type: 'array',
          description:
            'Recurrence rules for repeating reminders (EKCalendarItem.recurrenceRules).',
          items: {
            type: 'object',
            properties: {
              frequency: {
                type: 'string',
                enum: ['daily', 'weekly', 'monthly', 'yearly'],
                description: 'How often the reminder repeats.',
              },
              interval: {
                type: 'integer',
                description:
                  'Interval between occurrences (e.g., 2 for every 2 weeks). Defaults to 1.',
                default: 1,
              },
              endDate: {
                type: 'string',
                description:
                  'When the recurrence ends (YYYY-MM-DD format). Optional.',
              },
              occurrenceCount: {
                type: 'integer',
                description:
                  'Number of times to repeat (e.g., 10 for repeat 10 times). Optional.',
              },
              daysOfWeek: {
                type: 'array',
                items: { type: 'integer' },
                description:
                  'Days of week for weekly recurrence (1=Sunday, 7=Saturday). Optional.',
              },
              daysOfMonth: {
                type: 'array',
                items: { type: 'integer' },
                description:
                  'Days of month for monthly recurrence (1-31). Optional.',
              },
              monthsOfYear: {
                type: 'array',
                items: { type: 'integer' },
                description: 'Months for yearly recurrence (1-12). Optional.',
              },
              weeksOfYear: {
                type: 'array',
                items: { type: 'integer' },
                description:
                  'Weeks of the year (1-53). Negative counts back from year end (-1 = last week). Optional.',
              },
              daysOfYear: {
                type: 'array',
                items: { type: 'integer' },
                description:
                  'Days of the year (1-366). Negative counts back from year end. Optional.',
              },
              setPositions: {
                type: 'array',
                items: { type: 'integer' },
                description:
                  'Narrows the days the rule already matches to the Nth of each period (1=first, -1=last). "Last Friday of the month" = frequency monthly + daysOfWeek [6] + setPositions [-1]. "3rd Tuesday" = monthly + daysOfWeek [3] + setPositions [3]. Optional.',
              },
            },
            required: ['frequency'],
          },
        },
        clearRecurrence: {
          type: 'boolean',
          description:
            'Set to true to remove recurrence from an existing reminder (for update).',
        },
        filterLocationBased: {
          type: 'boolean',
          description:
            'Filter to only show location-based reminders when true.',
        },
        // Location trigger properties for create/update
        locationTrigger: {
          type: 'object',
          description:
            'Location trigger for geofence-based reminders. Reminder will fire when entering or leaving the specified location. Cross-server: to turn a place name into latitude/longitude, use the Apple Maps MCP place-search tool (maps_search_places) — each result carries coordinates — then pass them here (proximity "enter" = arrive, "leave" = depart).',
          properties: {
            title: {
              type: 'string',
              description:
                'Location name/title (e.g., "Home", "Office", "Grocery Store").',
            },
            latitude: {
              type: 'number',
              description: 'Latitude coordinate of the location.',
            },
            longitude: {
              type: 'number',
              description: 'Longitude coordinate of the location.',
            },
            radius: {
              type: 'number',
              description:
                'Geofence radius in meters (default 100). Determines how close you need to be to trigger.',
              default: 100,
            },
            proximity: {
              type: 'string',
              enum: ['enter', 'leave'],
              description:
                'When to trigger: "enter" fires when arriving, "leave" fires when departing.',
            },
          },
          required: ['title', 'latitude', 'longitude', 'proximity'],
        },
        clearLocationTrigger: {
          type: 'boolean',
          description:
            'Set to true to remove location trigger from an existing reminder (for update).',
        },
        // Tag filtering
        filterTags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter reminders by tags (must have ALL specified tags). Example: ["work", "urgent"]',
        },
        // Tag properties for create/update
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Tags to set on the reminder (for create). Replaces any existing tags. Example: ["work", "urgent"]',
        },
        addTags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Tags to add to the reminder (for update). Merges with existing tags. Example: ["followup"]',
        },
        removeTags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Tags to remove from the reminder (for update). Example: ["urgent"]',
        },
        // Subtask properties for create
        subtasks: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Initial subtasks to create with the reminder (for create action). Provide an array of subtask titles. Example: ["Buy milk", "Get eggs", "Pick up bread"]',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'reminders_lists',
    description:
      'Manages reminder lists. Supports reading, creating, updating, and deleting reminder lists.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: LIST_ACTIONS,
          description: 'The operation to perform on a list.',
        },
        name: {
          type: 'string',
          description:
            'The current name of the list (for update, delete) or the name of the new list (for create).',
        },
        newName: {
          type: 'string',
          description: 'The new name for the list (for update).',
        },
        color: {
          type: 'string',
          description:
            'The hex color code for the list (for create/update). Example: "#FF5733".',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'calendar_events',
    description:
      'Manages calendar events (time blocks). Supports reading, creating, updating, and deleting calendar events. Cross-server: to create an event from an email, fetch it with the Apple Mail MCP (search_emails / get_email_thread), extract the date/time, subject, and participants, then pass them here.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: CALENDAR_ACTIONS,
          description: 'The operation to perform.',
        },
        // ID-based operations
        id: {
          type: 'string',
          description:
            'The unique identifier of the event (REQUIRED for update, delete; optional for read to get single event).',
        },
        // Creation/Update properties
        title: {
          type: 'string',
          description:
            'The title of the event (REQUIRED for create, optional for update).',
        },
        startDate: {
          type: 'string',
          description:
            "Start date and time. RECOMMENDED format: 'YYYY-MM-DD HH:mm:ss' (local time without timezone, e.g., '2025-11-04 09:00:00'). Also supports: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', or ISO 8601 with timezone. When no timezone is specified, the time is interpreted as local time. For action='read': if omitted and endDate is omitted, defaults to today; if only endDate is provided, startDate defaults to endDate - 14 days.",
        },
        endDate: {
          type: 'string',
          description:
            "End date and time. RECOMMENDED format: 'YYYY-MM-DD HH:mm:ss' (local time without timezone, e.g., '2025-11-04 10:00:00'). Also supports: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', or ISO 8601 with timezone. When no timezone is specified, the time is interpreted as local time. For action='read': if omitted and startDate is omitted, defaults to today + 14 days; if only startDate is provided, endDate defaults to startDate + 14 days.",
        },
        note: {
          type: 'string',
          description: 'Additional notes for the event.',
        },
        location: {
          type: 'string',
          description:
            'Location for the event. Cross-server: for outdoor or travel events within ~16 days, pass this place name (or the structuredLocation coordinates) to the Apple Weather MCP get_forecast to check conditions at the event time; severe-weather alerts are US-only.',
        },
        structuredLocation: {
          type: 'object',
          description:
            'Structured location for the event (EKEvent.structuredLocation). If provided, title is required. Cross-server: resolve a place name to latitude/longitude with the Apple Maps MCP place-search tool (maps_search_places), then pass the coordinates here so geofence alarms and one-tap navigation work.',
          properties: {
            title: {
              type: 'string',
              description: 'Location name/title.',
            },
            latitude: {
              type: 'number',
              description: 'Latitude coordinate of the location.',
            },
            longitude: {
              type: 'number',
              description: 'Longitude coordinate of the location.',
            },
            radius: {
              type: 'number',
              description: 'Optional radius in meters.',
            },
          },
          required: ['title'],
        },
        url: {
          type: 'string',
          description: 'A URL to associate with the event.',
          format: 'uri',
        },
        availability: {
          type: 'string',
          enum: ['not-supported', 'busy', 'free', 'tentative', 'unavailable'],
          description: 'Event availability (EKEvent.availability).',
        },
        isAllDay: {
          type: 'boolean',
          description: 'Whether the event is an all-day event.',
        },
        alarms: {
          type: 'array',
          description:
            'Alarms for the event (EKCalendarItem.alarms). Each alarm must specify exactly one of relativeOffset (seconds), absoluteDate, or locationTrigger.',
          items: {
            type: 'object',
            properties: {
              relativeOffset: {
                type: 'number',
                description:
                  'Seconds offset for a relative alarm (negative = before start). Example: -1800 for 30 minutes before.',
              },
              absoluteDate: {
                type: 'string',
                description:
                  'Absolute trigger date/time for the alarm. Supports the same formats as startDate.',
              },
              locationTrigger: {
                type: 'object',
                description:
                  'Location-based (geofence) alarm. Equivalent to setting EKAlarm.structuredLocation + proximity. Cross-server: get latitude/longitude for a place from the Apple Maps MCP place-search tool (maps_search_places), then set proximity "enter" to alert on arrival or "leave" to alert on departure.',
                properties: {
                  title: {
                    type: 'string',
                    description:
                      'Location name/title (e.g., "Home", "Office").',
                  },
                  latitude: {
                    type: 'number',
                    description: 'Latitude coordinate of the location.',
                  },
                  longitude: {
                    type: 'number',
                    description: 'Longitude coordinate of the location.',
                  },
                  radius: {
                    type: 'number',
                    description: 'Geofence radius in meters (default 100).',
                    default: 100,
                  },
                  proximity: {
                    type: 'string',
                    enum: ['enter', 'leave'],
                    description:
                      'When to trigger: "enter" fires when arriving, "leave" fires when departing.',
                  },
                },
                required: ['title', 'latitude', 'longitude', 'proximity'],
              },
              soundName: {
                type: 'string',
                description:
                  'Optional alarm ACTION (macOS-only): name of a system sound to play when the alarm fires (sets EKAlarm.soundName, making it an "audio" alarm). Example: "Basso", "Ping", "Glass". Mutually exclusive with emailAddress.',
              },
              emailAddress: {
                type: 'string',
                description:
                  'Optional alarm ACTION (macOS-only): email address to notify when the alarm fires (sets EKAlarm.emailAddress, making it an "email" alarm). Takes precedence over soundName if both are given. Note: "procedure" (run-script / open-URL) alarms are intentionally unsupported — Apple deprecated them in OS X 10.9 and saving one errors.',
              },
              alarmType: {
                type: 'string',
                enum: ['display', 'audio', 'procedure', 'email'],
                description:
                  'READ-ONLY: Alarm presentation type (EKAlarm.type). Derived from the action fields: set soundName for "audio", emailAddress for "email"; with neither it is "display" (a notification). "procedure" is legacy and unsupported. Do not set this directly.',
              },
            },
          },
        },
        clearAlarms: {
          type: 'boolean',
          description: 'Set to true to remove all alarms from the event.',
        },
        recurrenceRules: {
          type: 'array',
          description:
            'Recurrence rules for repeating events (EKCalendarItem.recurrenceRules).',
          items: {
            type: 'object',
            properties: {
              frequency: {
                type: 'string',
                enum: ['daily', 'weekly', 'monthly', 'yearly'],
                description: 'How often the event repeats.',
              },
              interval: {
                type: 'integer',
                description:
                  'Interval between occurrences (e.g., 2 for every 2 weeks). Defaults to 1.',
                default: 1,
              },
              endDate: {
                type: 'string',
                description:
                  'When the recurrence ends (YYYY-MM-DD format). Optional.',
              },
              occurrenceCount: {
                type: 'integer',
                description:
                  'Number of times to repeat (e.g., 10 for repeat 10 times). Optional.',
              },
              daysOfWeek: {
                type: 'array',
                items: { type: 'integer' },
                description:
                  'Days of week for weekly recurrence (1=Sunday, 7=Saturday). Optional.',
              },
              daysOfMonth: {
                type: 'array',
                items: { type: 'integer' },
                description:
                  'Days of month for monthly recurrence (1-31). Optional.',
              },
              monthsOfYear: {
                type: 'array',
                items: { type: 'integer' },
                description: 'Months for yearly recurrence (1-12). Optional.',
              },
              weeksOfYear: {
                type: 'array',
                items: { type: 'integer' },
                description:
                  'Weeks of the year (1-53). Negative counts back from year end (-1 = last week). Optional.',
              },
              daysOfYear: {
                type: 'array',
                items: { type: 'integer' },
                description:
                  'Days of the year (1-366). Negative counts back from year end. Optional.',
              },
              setPositions: {
                type: 'array',
                items: { type: 'integer' },
                description:
                  'Narrows the days the rule already matches to the Nth of each period (1=first, -1=last). "Last Friday of the month" = frequency monthly + daysOfWeek [6] + setPositions [-1]. "3rd Tuesday" = monthly + daysOfWeek [3] + setPositions [3]. Optional.',
              },
            },
            required: ['frequency'],
          },
        },
        clearRecurrence: {
          type: 'boolean',
          description: 'Set to true to remove recurrence rules from the event.',
        },
        span: {
          type: 'string',
          enum: ['this-event', 'future-events'],
          description:
            'Scope for changes to recurring events: this-event or future-events.',
        },
        occurrenceDate: {
          type: 'string',
          description:
            'Targets ONE occurrence of a recurring series instead of the first one. Without it, update/delete on a repeating event always hits the earliest occurrence. Pass the date of the meeting you mean (YYYY-MM-DD, or YYYY-MM-DD HH:mm:ss to disambiguate same-day repeats) together with span "this-event" to move or cancel just that one — e.g. one cancelled class, an exam moved to a different room. To cancel several dates at once (a holiday break) use calendar_batch action "cancel-occurrences".',
        },
        targetCalendar: {
          type: 'string',
          description:
            'The name of the calendar for create or update operations.',
        },
        // Read filters
        filterCalendar: {
          type: 'string',
          description: 'Filter events by a specific calendar name.',
        },
        filterAccount: {
          type: 'string',
          description:
            'Filter events by account name (e.g., "Google", "Exchange"). Use calendar_calendars to see available accounts.',
        },
        search: {
          type: 'string',
          description:
            'A search term to filter events by title, notes, or location.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'calendar_calendars',
    description:
      'Reads and manages calendar collections (the calendars that hold events). Supports reading, creating, updating, and deleting calendars, including setting a calendar color. Use to inspect available calendars before creating or updating events.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'create', 'update', 'delete'],
          description:
            'The operation to perform on calendars: read (list all), create (new calendar), update (rename or recolor), delete (remove).',
        },
        name: {
          type: 'string',
          description:
            'Calendar name. Required for create, update, and delete. For update, this identifies the existing calendar to modify.',
        },
        newName: {
          type: 'string',
          description: 'New name for the calendar (update action only).',
        },
        color: {
          type: 'string',
          description:
            'Calendar color as a hex code (e.g., "#FF5733"). Applies to create and update. Note: macOS may snap the value to the nearest displayable color.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'reminders_subtasks',
    description:
      'Manages subtasks/checklists within reminders. Subtasks are stored in the notes field and visible in the native Reminders app. Use this to create checklist items for a reminder.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'create', 'update', 'delete', 'toggle', 'reorder'],
          description:
            'The operation to perform: read (list subtasks), create (add new), update (modify), delete (remove), toggle (flip completion), reorder (change order).',
        },
        reminderId: {
          type: 'string',
          description:
            'The unique identifier of the parent reminder (REQUIRED for all operations).',
        },
        subtaskId: {
          type: 'string',
          description:
            'The unique identifier of the subtask (REQUIRED for update, delete, toggle).',
        },
        title: {
          type: 'string',
          description:
            'The title of the subtask (REQUIRED for create, optional for update).',
        },
        completed: {
          type: 'boolean',
          description: 'The completion status of the subtask (for update).',
        },
        order: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Array of subtask IDs in desired order (REQUIRED for reorder). Must include all subtask IDs.',
        },
      },
      required: ['action', 'reminderId'],
    },
  },
  {
    name: 'calendar_schedule',
    description:
      'Read-only planning over calendars and reminders. Four actions: "agenda" merges events and dated reminders into one chronological timeline (with overlap warnings and, optionally, the free gaps in each day); "free-slots" finds open time that satisfies a duration, a daily window, chosen weekdays and a buffer around existing commitments; "conflicts" checks proposed times against what is already booked before you create anything; "hops" extracts the back-to-back location changes the schedule demands, already shaped for the Apple Maps MCP. Use this BEFORE calendar_events create — it is how you answer "when am I free", "does this clash", "what does my week look like", "can I make it across campus in time". Defaults to "agenda" for the next 7 days when called with no arguments. Cross-server: feed "hops" straight into maps_check_campus_hops; pair free-slots with the Apple Maps travel-time tools when a slot has to allow for getting across campus, and with the Apple Weather forecast tools when the slot is for something outdoors.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: SCHEDULE_ACTIONS,
          description:
            'agenda = merged timeline; free-slots = open time; conflicts = clash check for proposed slots; hops = back-to-back location changes for a travel-time check. Defaults to agenda.',
        },
        maxGapMinutes: {
          type: 'number',
          description:
            'hops: only report transitions with a gap this size or smaller, i.e. the tight ones. Defaults to 60.',
        },
        startDate: {
          type: 'string',
          description: `Start of the window (agenda, free-slots). Defaults to today. ${DATE_HINT}`,
        },
        endDate: {
          type: 'string',
          description: `End of the window (agenda, free-slots). Defaults to 7 days after the start. ${DATE_HINT}`,
        },
        dayStart: {
          type: 'string',
          description:
            "Earliest bookable time of day, 24-hour 'HH:mm'. Defaults to 09:00. Set '07:00' for early classes or '08:00' for a normal campus day.",
        },
        dayEnd: {
          type: 'string',
          description:
            "Latest bookable time of day, 24-hour 'HH:mm'. Defaults to 18:00. Set '23:00' to include late-night study time.",
        },
        durationMinutes: {
          type: 'integer',
          description:
            'free-slots: discard gaps shorter than this many minutes. Defaults to 30.',
          default: 30,
        },
        bufferMinutes: {
          type: 'integer',
          description:
            'free-slots: keep this many minutes clear either side of existing commitments (travel/settling time). Defaults to 0.',
          default: 0,
        },
        daysOfWeek: WEEKDAYS_PROPERTY,
        maxResults: {
          type: 'integer',
          description: 'free-slots: cap on returned slots. Defaults to 50.',
          default: 50,
        },
        slots: {
          type: 'array',
          description:
            'conflicts (REQUIRED): the proposed times to test. Each needs startDate and endDate; label is optional and echoed back.',
          items: {
            type: 'object',
            properties: {
              startDate: { type: 'string', description: DATE_HINT },
              endDate: { type: 'string', description: DATE_HINT },
              label: {
                type: 'string',
                description: 'Optional name for this slot in the report.',
              },
            },
            required: ['startDate', 'endDate'],
          },
        },
        includeReminders: {
          type: 'boolean',
          description:
            'agenda: include dated reminders alongside events. Defaults to true.',
          default: true,
        },
        includeCompletedReminders: {
          type: 'boolean',
          description: 'agenda: also show reminders already done. Defaults to false.',
          default: false,
        },
        includeFreeGaps: {
          type: 'boolean',
          description:
            'agenda: append the open gaps in each day. Defaults to false.',
          default: false,
        },
        includeAllDayAsBusy: {
          type: 'boolean',
          description:
            'Treat all-day events as blocking. Defaults to false, so an all-day "Reading Day" does not make the whole day unbookable.',
          default: false,
        },
        respectAvailability: {
          type: 'boolean',
          description:
            'When true (default), events marked free or cancelled do not block time.',
          default: true,
        },
        filterCalendar: {
          type: 'string',
          description:
            'Only consider this calendar. Omit to use every calendar — usually what you want for a true free/busy picture.',
        },
        filterAccount: {
          type: 'string',
          description: 'Only consider calendars from this account.',
        },
        search: {
          type: 'string',
          description: 'agenda: filter entries by title, notes, or location.',
        },
      },
      required: [],
    },
  },
  {
    name: 'calendar_batch',
    description:
      'Multi-event calendar writes, each reporting per-item success or failure instead of aborting on the first error. Actions: "create-events" adds many events in one call (a whole exam week, every advising appointment); "delete-events" removes many by ID; "cancel-occurrences" cancels specific meetings of ONE recurring series while leaving the rest intact (holidays, a cancelled class); "create-class-schedule" builds a full term from meeting patterns — weekly recurring events per class, with meetings that fall inside break ranges removed automatically; "schedule-study-blocks" finds real free time and books study sessions into it. Use create-class-schedule for semester setup and schedule-study-blocks for exam prep. Cross-server: resolve building names to coordinates with the Apple Maps place-search tool and pass them as structuredLocation so travel-time and arrival alerts work.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: CALENDAR_BATCH_ACTIONS,
          description: 'Which batch operation to run.',
        },
        events: {
          type: 'array',
          description:
            'create-events (REQUIRED): the events to create. Each accepts the same fields as calendar_events create.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Event title.' },
              startDate: { type: 'string', description: DATE_HINT },
              endDate: { type: 'string', description: DATE_HINT },
              note: { type: 'string', description: 'Notes body.' },
              location: { type: 'string', description: 'Plain-text location.' },
              structuredLocation: {
                type: 'object',
                description:
                  'Geocoded location. Resolve coordinates with the Apple Maps place-search tool.',
                properties: {
                  title: { type: 'string' },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                  radius: { type: 'number' },
                },
                required: ['title'],
              },
              url: { type: 'string', description: 'Associated URL.' },
              isAllDay: { type: 'boolean' },
              availability: {
                type: 'string',
                enum: ['not-supported', 'busy', 'free', 'tentative', 'unavailable'],
              },
              alarms: ALARMS_PROPERTY,
              recurrenceRules: {
                type: 'array',
                description:
                  'Recurrence rules; same shape as calendar_events (supports setPositions for "last Friday of the month").',
                items: { type: 'object' },
              },
              targetCalendar: {
                type: 'string',
                description:
                  'Calendar for this event; falls back to the top-level targetCalendar.',
              },
            },
            required: ['title', 'startDate', 'endDate'],
          },
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'delete-events (REQUIRED): event IDs to delete.',
        },
        id: {
          type: 'string',
          description:
            'cancel-occurrences (REQUIRED): the ID of the recurring series to cancel meetings from.',
        },
        occurrenceDates: {
          type: 'array',
          items: { type: 'string' },
          description: `cancel-occurrences (REQUIRED): the dates to cancel. ${DATE_HINT}`,
        },
        termStart: {
          type: 'string',
          description: `create-class-schedule (REQUIRED): first day of term. ${DATE_HINT}`,
        },
        termEnd: {
          type: 'string',
          description: `create-class-schedule (REQUIRED): last day of term. ${DATE_HINT}`,
        },
        skipRanges: {
          type: 'array',
          description:
            'create-class-schedule: breaks and holidays. Any class meeting inside a range is removed from its series. Inclusive of both ends.',
          items: {
            type: 'object',
            properties: {
              start: { type: 'string', description: DATE_HINT },
              end: {
                type: 'string',
                description: `Last skipped day (same as start for a single day). ${DATE_HINT}`,
              },
              label: {
                type: 'string',
                description: 'Name of the break, e.g. "Thanksgiving".',
              },
            },
            required: ['start', 'end'],
          },
        },
        classes: {
          type: 'array',
          description:
            'create-class-schedule (REQUIRED): one entry per class section.',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'e.g. "CS 245 Lecture" or "BIO 201 Lab".',
              },
              daysOfWeek: WEEKDAYS_PROPERTY,
              startTime: {
                type: 'string',
                description: "Meeting start, 24-hour 'HH:mm' (e.g. '09:30').",
              },
              endTime: {
                type: 'string',
                description:
                  "Meeting end, 24-hour 'HH:mm'. An end at or before the start is read as running past midnight.",
              },
              location: { type: 'string', description: 'Room or building.' },
              structuredLocation: {
                type: 'object',
                description:
                  'Geocoded building, for travel-time and arrival alerts.',
                properties: {
                  title: { type: 'string' },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                  radius: { type: 'number' },
                },
                required: ['title'],
              },
              note: {
                type: 'string',
                description: 'Notes — instructor, office hours, section number.',
              },
              url: { type: 'string', description: 'Course page or meeting link.' },
              alarms: ALARMS_PROPERTY,
              availability: {
                type: 'string',
                enum: ['not-supported', 'busy', 'free', 'tentative', 'unavailable'],
                description: 'Defaults to busy so classes block free-slot searches.',
              },
              interval: {
                type: 'integer',
                description:
                  'Meets every N weeks. Defaults to 1; use 2 for a biweekly lab.',
                default: 1,
              },
            },
            required: ['title', 'daysOfWeek', 'startTime', 'endTime'],
          },
        },
        title: {
          type: 'string',
          description:
            'schedule-study-blocks (REQUIRED): block title, e.g. "Study: CHEM 110 midterm".',
        },
        totalMinutes: {
          type: 'integer',
          description:
            'schedule-study-blocks (REQUIRED): total study time to place across the window.',
        },
        blockMinutes: {
          type: 'integer',
          description:
            'schedule-study-blocks: length of each session. Defaults to 90.',
          default: 90,
        },
        maxBlocksPerDay: {
          type: 'integer',
          description: 'schedule-study-blocks: per-day cap. Defaults to 2.',
          default: 2,
        },
        startDate: {
          type: 'string',
          description: `schedule-study-blocks: window start. Defaults to now. ${DATE_HINT}`,
        },
        endDate: {
          type: 'string',
          description: `schedule-study-blocks: window end (e.g. the day before the exam). Defaults to 7 days out. ${DATE_HINT}`,
        },
        dayStart: {
          type: 'string',
          description:
            "schedule-study-blocks: earliest time of day, 'HH:mm'. Defaults to 09:00.",
        },
        dayEnd: {
          type: 'string',
          description:
            "schedule-study-blocks: latest time of day, 'HH:mm'. Defaults to 18:00.",
        },
        daysOfWeek: WEEKDAYS_PROPERTY,
        bufferMinutes: {
          type: 'integer',
          description:
            'schedule-study-blocks: gap kept around existing commitments and between blocks. Defaults to 10.',
          default: 10,
        },
        dryRun: {
          type: 'boolean',
          description:
            'schedule-study-blocks: return the plan without creating anything. Defaults to false.',
          default: false,
        },
        note: {
          type: 'string',
          description: 'schedule-study-blocks: notes applied to every block.',
        },
        location: {
          type: 'string',
          description: 'schedule-study-blocks: location applied to every block.',
        },
        alarms: ALARMS_PROPERTY,
        availability: {
          type: 'string',
          enum: ['not-supported', 'busy', 'free', 'tentative', 'unavailable'],
          description: 'Availability for created events. Defaults to busy.',
        },
        includeAllDayAsBusy: {
          type: 'boolean',
          description:
            'Treat all-day events as blocking when looking for free time. Defaults to false.',
          default: false,
        },
        respectAvailability: {
          type: 'boolean',
          description:
            'When true (default), events marked free or cancelled do not block.',
          default: true,
        },
        span: {
          type: 'string',
          enum: ['this-event', 'future-events'],
          description:
            'delete-events: scope when an ID belongs to a recurring series. Defaults to this-event.',
        },
        targetCalendar: {
          type: 'string',
          description:
            'Default calendar for anything created. Omit to use the system default calendar.',
        },
        filterCalendar: {
          type: 'string',
          description:
            'Restrict the busy-time lookup to one calendar when finding study time.',
        },
        filterAccount: {
          type: 'string',
          description: 'Restrict the busy-time lookup to one account.',
        },
        skipConflicts: {
          type: 'boolean',
          description:
            'create-events: skip any event that would overlap something already booked, reporting it as skipped. Defaults to false.',
          default: false,
        },
        continueOnError: {
          type: 'boolean',
          description:
            'Keep going after an item fails and report every outcome. Defaults to true.',
          default: true,
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'reminders_batch',
    description:
      'Multi-reminder writes with per-item results: "create" adds many reminders at once (a semester of assignment deadlines from a syllabus, every task from one email thread), "update" edits many, "complete" ticks off or re-opens many, "delete" removes many. complete and delete accept plain titles as well as IDs, so you do not need to look an ID up first — titles are matched case-insensitively and every match is acted on. Cross-server: build the list from the Apple Mail search tools when deadlines arrive by email, or from an Apple Notes page when they live in lecture notes.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: REMINDER_BATCH_ACTIONS,
          description: 'Which batch operation to run.',
        },
        reminders: {
          type: 'array',
          description:
            'create (REQUIRED): the reminders to create. Each accepts the same fields as reminders_tasks create.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Reminder title.' },
              dueDate: { type: 'string', description: DATE_HINT },
              startDate: { type: 'string', description: DATE_HINT },
              note: { type: 'string', description: 'Notes body.' },
              url: { type: 'string', description: 'Associated URL.' },
              location: { type: 'string', description: 'Plain-text location.' },
              priority: {
                type: 'integer',
                enum: [0, 1, 5, 9],
                description: '0 none, 1 high, 5 medium, 9 low.',
              },
              completed: { type: 'boolean' },
              alarms: ALARMS_PROPERTY,
              recurrenceRules: {
                type: 'array',
                description: 'Recurrence rules; same shape as reminders_tasks.',
                items: { type: 'object' },
              },
              locationTrigger: {
                type: 'object',
                description:
                  'Geofence trigger. Resolve coordinates with the Apple Maps place-search tool; proximity "enter" fires on arrival, "leave" on departure.',
                properties: {
                  title: { type: 'string' },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                  radius: { type: 'number' },
                  proximity: { type: 'string', enum: ['enter', 'leave'] },
                },
                required: ['title', 'latitude', 'longitude', 'proximity'],
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags stored in the notes as [#tag].',
              },
              subtasks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Initial subtask titles.',
              },
              targetList: {
                type: 'string',
                description:
                  'List for this reminder; falls back to the top-level targetList.',
              },
            },
            required: ['title'],
          },
        },
        updates: {
          type: 'array',
          description:
            'update (REQUIRED): each entry needs an id plus the fields to change.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Reminder ID (REQUIRED).' },
              title: { type: 'string', description: 'New title.' },
              dueDate: { type: 'string', description: DATE_HINT },
              startDate: { type: 'string', description: DATE_HINT },
              note: { type: 'string' },
              url: { type: 'string' },
              location: { type: 'string' },
              completed: { type: 'boolean' },
              completionDate: { type: 'string', description: DATE_HINT },
              priority: { type: 'integer', enum: [0, 1, 5, 9] },
              alarms: ALARMS_PROPERTY,
              clearAlarms: { type: 'boolean' },
              clearRecurrence: { type: 'boolean' },
              clearLocationTrigger: { type: 'boolean' },
              targetList: { type: 'string', description: 'Move to this list.' },
            },
            required: ['id'],
          },
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'complete/delete: reminder IDs to act on.',
        },
        titles: {
          type: 'array',
          items: { type: 'string' },
          description:
            'complete/delete: exact reminder titles to act on, matched case-insensitively. Every match is acted on, so narrow with filterList if a title repeats across lists.',
        },
        filterList: {
          type: 'string',
          description:
            'complete/delete: only match reminders in this list when resolving titles.',
        },
        completed: {
          type: 'boolean',
          description:
            'complete: true marks done (default), false re-opens the reminders.',
          default: true,
        },
        targetList: {
          type: 'string',
          description:
            'create: default list for reminders that do not name their own.',
        },
        continueOnError: {
          type: 'boolean',
          description:
            'Keep going after an item fails and report every outcome. Defaults to true.',
          default: true,
        },
      },
      required: ['action'],
    },
  },
];
