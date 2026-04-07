// ── Calendar Adapter ─────────────────────────────────────────────────────────
// Interface + Google Calendar implementation following the googleapis OAuth2 pattern
// from fresh-cuts-api/app/api/vapi-tools/route.ts.

import { google, type calendar_v3 } from 'googleapis';
import { createLogger } from '@voxvidia/shared';
import type { CalendarEvent } from '../speakable.js';

const logger = createLogger('orchestrator:calendar');

// ── Interface ───────────────────────────────────────────────────────────────

export interface CreateEventPayload {
  summary: string;
  description?: string;
  date: string;              // "tomorrow", "Monday", "2026-04-10"
  time: string;              // "2:00 PM", "14:00"
  durationMinutes?: number;  // default 30
  attendees?: string[];      // email addresses
  timezone?: string;
}

export interface ReschedulePayload {
  newDate?: string;
  newTime?: string;
  timezone?: string;
}

export interface CalendarAdapter {
  getTodayEvents(timezone?: string): Promise<CalendarEvent[]>;
  getNextMeeting(filters?: { query?: string }): Promise<CalendarEvent | null>;
  createEvent(payload: CreateEventPayload): Promise<{ id: string; time: string; date: string }>;
  rescheduleEvent(eventId: string, payload: ReschedulePayload): Promise<{ id: string; time: string; date: string }>;
}

// ── Date/Time Helpers (mirrored from fresh-cuts pattern) ────────────────────

function nowInTz(tz: string): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
}

function toTzDateRange(date: Date): { dayStart: string; dayEnd: string } {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return {
    dayStart: `${y}-${m}-${d}T00:00:00`,
    dayEnd: `${y}-${m}-${d}T23:59:59`,
  };
}

function formatTimeNatural(hours: number, minutes: number): string {
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${h12}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

function formatDateNatural(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function resolveDate(dateStr: string): Date {
  const lower = dateStr.toLowerCase().trim();
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  if (lower === 'today') return today;
  if (lower === 'tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const cleanDay = lower.replace(/^(this|next)\s+/, '');
  const dayIndex = dayNames.indexOf(cleanDay);
  if (dayIndex !== -1) {
    const d = new Date(today);
    let daysAhead = dayIndex - d.getDay();
    if (daysAhead <= 0) daysAhead += 7;
    if (lower.startsWith('next') && daysAhead <= 7) daysAhead += 7;
    d.setDate(d.getDate() + daysAhead);
    return d;
  }

  const parsed = new Date(dateStr + 'T12:00:00');
  if (!isNaN(parsed.getTime())) return parsed;

  const fallback = new Date(today);
  fallback.setDate(fallback.getDate() + 1);
  return fallback;
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const lower = timeStr.toLowerCase().trim();

  // "2:30 PM", "2 PM", "14:00"
  const match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return { hours: 9, minutes: 0 };

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  return { hours, minutes };
}

function toIsoDatetime(date: Date, hours: number, minutes: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(hours).padStart(2, '0');
  const min = String(minutes).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:00`;
}

// ── Extract CalendarEvent from Google API result ────────────────────────────

function mapGoogleEvent(item: calendar_v3.Schema$Event, tz: string): CalendarEvent {
  const start = item.start?.dateTime
    ? new Date(new Date(item.start.dateTime).toLocaleString('en-US', { timeZone: tz }))
    : null;
  const end = item.end?.dateTime
    ? new Date(new Date(item.end.dateTime).toLocaleString('en-US', { timeZone: tz }))
    : null;

  return {
    summary: item.summary ?? 'Untitled',
    startTime: start ? formatTimeNatural(start.getHours(), start.getMinutes()) : 'all day',
    endTime: end ? formatTimeNatural(end.getHours(), end.getMinutes()) : undefined,
    attendees: (item.attendees ?? [])
      .map((a) => a.displayName ?? a.email ?? '')
      .filter(Boolean)
      .slice(0, 3),
    location: item.location ?? undefined,
  };
}

// ── Stub Implementation ─────────────────────────────────────────────────────

export class StubCalendarAdapter implements CalendarAdapter {
  async getTodayEvents(_timezone?: string): Promise<CalendarEvent[]> {
    return [
      {
        summary: 'Team Standup',
        startTime: '9:00 AM',
        endTime: '9:30 AM',
        attendees: ['Sarah', 'Mike'],
      },
      {
        summary: 'Client Review - Acme Corp',
        startTime: '3:00 PM',
        endTime: '4:00 PM',
        attendees: ['John Smith'],
      },
    ];
  }

  async getNextMeeting(_filters?: { query?: string }): Promise<CalendarEvent | null> {
    return {
      summary: 'Client Review - Acme Corp',
      startTime: '3:00 PM',
      endTime: '4:00 PM',
      attendees: ['John Smith'],
      location: 'Conference Room B',
    };
  }

  async createEvent(payload: CreateEventPayload): Promise<{ id: string; time: string; date: string }> {
    return {
      id: `stub-${Date.now()}`,
      time: payload.time || '2:00 PM',
      date: payload.date || 'tomorrow',
    };
  }

  async rescheduleEvent(
    eventId: string,
    payload: ReschedulePayload,
  ): Promise<{ id: string; time: string; date: string }> {
    return {
      id: eventId,
      time: payload.newTime ?? '3:00 PM',
      date: payload.newDate ?? 'tomorrow',
    };
  }
}

// ── Google Calendar Implementation ──────────────────────────────────────────

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId?: string;
  timezone?: string;
}

export class GoogleCalendarAdapter implements CalendarAdapter {
  private calendar: calendar_v3.Calendar;
  private calendarId: string;
  private tz: string;

  constructor(config: GoogleCalendarConfig) {
    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
    );
    oauth2Client.setCredentials({ refresh_token: config.refreshToken });

    this.calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    this.calendarId = config.calendarId ?? 'primary';
    this.tz = config.timezone ?? 'America/New_York';
  }

  async getTodayEvents(timezone?: string): Promise<CalendarEvent[]> {
    const tz = timezone ?? this.tz;
    const today = nowInTz(tz);
    const { dayStart, dayEnd } = toTzDateRange(today);

    try {
      const res = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: dayStart,
        timeMax: dayEnd,
        timeZone: tz,
        singleEvents: true,
        orderBy: 'startTime',
      });

      return (res.data.items ?? []).map((item) => mapGoogleEvent(item, tz));
    } catch (err) {
      logger.error('Failed to fetch today events', { error: String(err) });
      return [];
    }
  }

  async getNextMeeting(filters?: { query?: string }): Promise<CalendarEvent | null> {
    const now = new Date();

    try {
      const res = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: now.toISOString(),
        timeMax: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
        q: filters?.query,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 1,
        timeZone: this.tz,
      });

      const items = res.data.items ?? [];
      if (items.length === 0) return null;

      return mapGoogleEvent(items[0], this.tz);
    } catch (err) {
      logger.error('Failed to fetch next meeting', { error: String(err) });
      return null;
    }
  }

  async createEvent(payload: CreateEventPayload): Promise<{ id: string; time: string; date: string }> {
    const tz = payload.timezone ?? this.tz;
    const date = resolveDate(payload.date);
    const { hours, minutes } = parseTime(payload.time);
    const duration = payload.durationMinutes ?? 30;

    const startStr = toIsoDatetime(date, hours, minutes);
    const endDate = new Date(date.getTime());
    endDate.setHours(hours, minutes + duration, 0, 0);
    const endStr = toIsoDatetime(endDate, endDate.getHours(), endDate.getMinutes());

    const event = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: {
        summary: payload.summary,
        description: payload.description,
        start: { dateTime: startStr, timeZone: tz },
        end: { dateTime: endStr, timeZone: tz },
        attendees: payload.attendees?.map((email) => ({ email })),
      },
    });

    return {
      id: event.data.id ?? 'unknown',
      time: formatTimeNatural(hours, minutes),
      date: formatDateNatural(date),
    };
  }

  async rescheduleEvent(
    eventId: string,
    payload: ReschedulePayload,
  ): Promise<{ id: string; time: string; date: string }> {
    const tz = payload.timezone ?? this.tz;

    // Fetch existing event to preserve unchanged fields
    const existing = await this.calendar.events.get({
      calendarId: this.calendarId,
      eventId,
    });

    const existingStart = existing.data.start?.dateTime
      ? new Date(existing.data.start.dateTime)
      : new Date();

    const newDate = payload.newDate
      ? resolveDate(payload.newDate)
      : existingStart;

    const newTimeStr = payload.newTime ?? formatTimeNatural(existingStart.getHours(), existingStart.getMinutes());
    const { hours, minutes } = parseTime(newTimeStr);

    // Compute original duration
    const existingEnd = existing.data.end?.dateTime
      ? new Date(existing.data.end.dateTime)
      : new Date(existingStart.getTime() + 30 * 60_000);
    const durationMs = existingEnd.getTime() - existingStart.getTime();

    const startStr = toIsoDatetime(newDate, hours, minutes);
    const endMs = new Date(newDate.getTime());
    endMs.setHours(hours, minutes, 0, 0);
    const endDate = new Date(endMs.getTime() + durationMs);
    const endStr = toIsoDatetime(endDate, endDate.getHours(), endDate.getMinutes());

    await this.calendar.events.patch({
      calendarId: this.calendarId,
      eventId,
      requestBody: {
        start: { dateTime: startStr, timeZone: tz },
        end: { dateTime: endStr, timeZone: tz },
      },
    });

    return {
      id: eventId,
      time: formatTimeNatural(hours, minutes),
      date: formatDateNatural(newDate),
    };
  }
}
