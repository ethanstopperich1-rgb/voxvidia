// ── Calendar Tool Handlers ───────────────────────────────────────────────────
// Registers tool handlers that bridge the ToolRegistry to CalendarAdapter.

import type { ToolRegistry } from '../tool-runner.js';
import type { CalendarAdapter } from '../adapters/calendar.js';

export function registerCalendarTools(
  registry: ToolRegistry,
  adapter: CalendarAdapter,
): void {
  registry.register('get_today_calendar_events', async (args) => {
    const timezone = (args.timezone as string) ?? undefined;
    return adapter.getTodayEvents(timezone);
  });

  registry.register('get_next_meeting', async (args) => {
    const query = (args.query as string) ?? undefined;
    return adapter.getNextMeeting(query ? { query } : undefined);
  });

  registry.register('create_calendar_event', async (args) => {
    return adapter.createEvent({
      summary: (args.summary as string) ?? (args.rawUtterance as string) ?? 'Meeting',
      description: args.description as string | undefined,
      date: (args.date as string) ?? 'tomorrow',
      time: (args.time as string) ?? '2:00 PM',
      durationMinutes: (args.durationMinutes as number) ?? 30,
      attendees: args.attendees as string[] | undefined,
      timezone: args.timezone as string | undefined,
    });
  });

  registry.register('reschedule_event', async (args) => {
    const eventId = args.eventId as string;
    if (!eventId) {
      throw new Error('reschedule_event requires an eventId');
    }

    return adapter.rescheduleEvent(eventId, {
      newDate: args.newDate as string | undefined,
      newTime: (args.newTime as string) ?? undefined,
      timezone: args.timezone as string | undefined,
    });
  });
}
