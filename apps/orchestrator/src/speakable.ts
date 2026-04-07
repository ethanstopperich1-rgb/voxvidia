// ── Speakable Formatters ─────────────────────────────────────────────────────
// Converts structured tool results into short, conversational, voice-friendly text.
// All output targets sub-15-second spoken delivery.

export interface CalendarEvent {
  summary: string;
  startTime: string;       // e.g. "3:00 PM"
  endTime?: string;
  attendees?: string[];
  location?: string;
}

export interface Contact {
  name: string;
  company?: string;
  title?: string;
  phone?: string;
  email?: string;
}

export interface Deal {
  name: string;
  company: string;
  value: number;
  stage?: string;
}

// ── Calendar ────────────────────────────────────────────────────────────────

export function formatCalendarEvents(events: CalendarEvent[]): string {
  if (!events || events.length === 0) {
    return 'Your calendar is clear today. No meetings scheduled.';
  }

  if (events.length === 1) {
    const e = events[0];
    const withWho = e.attendees?.length
      ? ` with ${speakList(e.attendees)}`
      : '';
    return `You have 1 meeting today. ${e.summary} at ${e.startTime}${withWho}.`;
  }

  const count = events.length;
  const descriptions = events.slice(0, 4).map((e) => {
    const withWho = e.attendees?.length
      ? ` with ${e.attendees[0]}`
      : '';
    return `${e.startTime}${withWho}, ${e.summary}`;
  });

  const overflow = count > 4 ? ` And ${count - 4} more after that.` : '';
  return `You have ${count} meetings today. First is ${descriptions[0]}. Then ${descriptions.slice(1).join('. Then ')}.${overflow}`;
}

export function formatNextMeeting(event: CalendarEvent | null): string {
  if (!event) {
    return 'You don\'t have any upcoming meetings.';
  }

  const withWho = event.attendees?.length
    ? ` with ${speakList(event.attendees)}`
    : '';
  const where = event.location ? ` at ${event.location}` : '';
  return `Your next meeting is ${event.summary} at ${event.startTime}${withWho}${where}.`;
}

// ── CRM ─────────────────────────────────────────────────────────────────────

export function formatContact(contact: Contact | null): string {
  if (!contact) {
    return 'I couldn\'t find a matching contact in the system.';
  }

  const parts = [`That's ${contact.name}`];
  if (contact.company) {
    parts.push(`from ${contact.company}`);
  }
  if (contact.title) {
    parts.push(`${contact.title}`);
  }

  return parts.join(', ') + '.';
}

export function formatDeals(deals: Deal[]): string {
  if (!deals || deals.length === 0) {
    return 'There are no open deals right now.';
  }

  if (deals.length === 1) {
    const d = deals[0];
    return `There's 1 open deal. ${speakMoney(d.value)} with ${d.company}${d.stage ? `, currently in ${d.stage}` : ''}.`;
  }

  const summaries = deals.slice(0, 3).map((d) =>
    `${speakMoney(d.value)} with ${d.company}`
  );

  const overflow = deals.length > 3 ? `, and ${deals.length - 3} more` : '';
  return `There are ${deals.length} open deals. ${summaries.join(', ')}${overflow}.`;
}

export function formatAccountSummary(summary: Record<string, unknown> | null): string {
  if (!summary) {
    return 'I couldn\'t pull up the account summary.';
  }

  const name = summary.name ?? 'the account';
  const parts: string[] = [`Here's the summary for ${name}.`];

  if (summary.totalDeals !== undefined) {
    parts.push(`${summary.totalDeals} total deals.`);
  }
  if (summary.openDeals !== undefined) {
    parts.push(`${summary.openDeals} currently open.`);
  }
  if (summary.totalValue !== undefined) {
    parts.push(`Total pipeline value ${speakMoney(summary.totalValue as number)}.`);
  }
  if (summary.lastActivity) {
    parts.push(`Last activity was ${summary.lastActivity}.`);
  }

  return parts.join(' ');
}

// ── Confirmations & Results ─────────────────────────────────────────────────

export function formatConfirmation(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'create_calendar_event': {
      const time = args.time ?? 'the requested time';
      const date = args.date ?? 'tomorrow';
      return `I'll book a meeting for ${date} at ${time}. Should I go ahead?`;
    }
    case 'reschedule_event': {
      const newTime = args.newTime ?? 'the new time';
      return `I'll move the meeting to ${newTime}. Should I go ahead?`;
    }
    case 'create_crm_note': {
      const note = args.note as string | undefined;
      const preview = note && note.length > 60
        ? note.slice(0, 60) + '...'
        : note ?? 'the note';
      return `I'll add this note to the contact: "${preview}". Should I save it?`;
    }
    case 'create_followup_task': {
      const days = args.daysOut ?? 1;
      return `I'll create a follow-up task for ${days} day${days === 1 ? '' : 's'} from now. Should I go ahead?`;
    }
    default:
      return `I'm about to run ${toolName.replace(/_/g, ' ')}. Should I go ahead?`;
  }
}

export function formatSuccess(toolName: string, result: unknown): string {
  const data = result as Record<string, unknown> | undefined;

  switch (toolName) {
    case 'create_calendar_event': {
      const time = data?.time ?? '';
      const date = data?.date ?? '';
      return `Done. Meeting booked${date ? ` for ${date}` : ''}${time ? ` at ${time}` : ''}.`;
    }
    case 'reschedule_event': {
      const time = data?.time ?? '';
      const date = data?.date ?? '';
      return `Done. Meeting rescheduled${date ? ` to ${date}` : ''}${time ? ` at ${time}` : ''}.`;
    }
    case 'create_crm_note':
      return 'Done. Note saved to the contact.';
    case 'create_followup_task':
      return 'Done. Follow-up task created.';
    default:
      return 'Done.';
  }
}

export function formatError(toolName: string, _error: string): string {
  switch (toolName) {
    case 'create_calendar_event':
    case 'reschedule_event':
      return 'Sorry, I wasn\'t able to update the calendar. Would you like me to try again?';
    case 'create_crm_note':
    case 'create_followup_task':
      return 'Sorry, I couldn\'t save that to the CRM. Want me to try again?';
    default:
      return 'Sorry, I wasn\'t able to do that. Would you like me to try again?';
  }
}

// ── Utilities ───────────────────────────────────────────────────────────────

function speakList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

function speakMoney(value: number): string {
  if (value >= 1_000_000) {
    const millions = (value / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${millions} million dollars`;
  }
  if (value >= 1_000) {
    const thousands = Math.round(value / 1_000);
    return `${thousands} thousand dollars`;
  }
  return `${value} dollars`;
}
