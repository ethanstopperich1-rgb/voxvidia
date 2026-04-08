/**
 * Twilio webhook handlers.
 *
 * - POST /twilio/voice              -> returns TwiML to greet caller and start Media Stream
 * - POST /twilio/status             -> call status callback
 * - POST /twilio/recording-status   -> recording completion callback
 */

import type { Request, Response } from 'express';
import { createLogger, env } from '@voxvidia/shared';
import { createCall, updateCall, completeCall } from '@voxvidia/storage';
import { validateRequest } from 'twilio';
import type { CrmAdapter } from '@voxvidia/orchestrator';
import type { CalendarAdapter } from '@voxvidia/orchestrator';
import {
  StubCrmAdapter,
  GhlCrmAdapter,
  StubCalendarAdapter,
  GoogleCalendarAdapter,
} from '@voxvidia/orchestrator';

const logger = createLogger('bridge:twilio');

// ── Signature validation ──────────────────────────────────────────────────────

/**
 * Validate the X-Twilio-Signature header.
 * Skipped if TWILIO_AUTH_TOKEN is not configured.
 */
export function validateTwilioSignature(req: Request): boolean {
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    logger.warn('TWILIO_AUTH_TOKEN not set — skipping signature validation');
    return true;
  }

  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature) {
    logger.warn('Missing X-Twilio-Signature header');
    return false;
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const url = `${protocol}://${req.headers.host}${req.originalUrl}`;

  return validateRequest(authToken, signature, url, req.body || {});
}

// ── Incoming call handler ─────────────────────────────────────────────────────

export async function handleIncomingCall(
  req: Request,
  res: Response,
): Promise<void> {
  const callSid = req.body?.CallSid || 'unknown';
  const fromNumber = req.body?.From || 'unknown';
  const toNumber = req.body?.To || 'unknown';

  logger.info('Incoming call', {
    callId: callSid,
    from: fromNumber,
    to: toNumber,
  });

  // Persist call record via the storage layer (gracefully skips if Supabase is unconfigured).
  try {
    await createCall({
      callSid,
      fromNumber,
      toNumber,
      status: 'initiated',
      startedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Failed to persist call record', {
      callId: callSid,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Build the WebSocket URL for the Media Stream.
  const host = req.headers.host || 'localhost:3000';
  const protocol =
    req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${host}/media-stream`;

  const voicePrompt = env.DEFAULT_VOICE;
  const textPrompt = env.DEFAULT_PROMPT;

  // Return TwiML — no greeting, stream connects immediately.
  // Stream connects immediately — Deepgram, LLM, and Rime init on 'start' event.
  res.type('text/xml');
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}">
      <Parameter name="voice" value="${escapeXml(voicePrompt)}" />
      <Parameter name="prompt" value="${escapeXml(textPrompt)}" />
    </Stream>
  </Connect>
</Response>`,
  );
}

// ── Call status handler ───────────────────────────────────────────────────────

export async function handleCallStatus(
  req: Request,
  res: Response,
): Promise<void> {
  const callSid = req.body?.CallSid || 'unknown';
  const callStatus = req.body?.CallStatus || 'unknown';
  const callDuration = req.body?.CallDuration;

  logger.info('Call status update', {
    callId: callSid,
    status: callStatus,
    duration: callDuration,
  });

  try {
    if (callStatus === 'completed') {
      await completeCall(callSid, new Date().toISOString());
    } else {
      // Map Twilio status strings to our schema.
      const statusMap: Record<string, string> = {
        queued: 'initiated',
        initiated: 'initiated',
        ringing: 'ringing',
        'in-progress': 'answered',
        completed: 'completed',
        busy: 'failed',
        'no-answer': 'failed',
        canceled: 'failed',
        failed: 'failed',
      };
      const mappedStatus = statusMap[callStatus] as
        | 'initiated'
        | 'ringing'
        | 'answered'
        | 'completed'
        | 'failed'
        | undefined;

      if (mappedStatus) {
        await updateCall(callSid, { status: mappedStatus });
      }
    }
  } catch (err) {
    logger.error('Failed to update call status', {
      callId: callSid,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  res.sendStatus(204);
}

// ── Recording status handler ──────────────────────────────────────────────────

export async function handleRecordingStatus(
  req: Request,
  res: Response,
): Promise<void> {
  const callSid = req.body?.CallSid || 'unknown';
  const recordingUrl = req.body?.RecordingUrl;
  const recordingSid = req.body?.RecordingSid;
  const recordingStatus = req.body?.RecordingStatus;

  logger.info('Recording status update', {
    callId: callSid,
    recordingSid,
    status: recordingStatus,
    url: recordingUrl,
  });

  if (recordingUrl) {
    try {
      await updateCall(callSid, { recordingUrl });
    } catch (err) {
      logger.error('Failed to update recording URL', {
        callId: callSid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.sendStatus(204);
}

// ── Outbound call handler ────────────────────────────────────────────────────

export interface OutboundCallRequest {
  to: string;
  from?: string;
  prompt: string;
  voice?: string;
  callerName?: string;
  metadata?: Record<string, string>;
}

/**
 * POST /api/outbound
 *
 * Initiate an outbound call with a fully personalized voice agent.
 * All dynamic variables (name, context, instructions) are baked into the prompt.
 *
 * Example:
 *   POST /api/outbound
 *   {
 *     "to": "+15551234567",
 *     "prompt": "You work for Fresh Cuts. You are calling Marcus. He missed his fade appointment yesterday. Offer to reschedule.",
 *     "voice": "NATF2.pt",
 *     "callerName": "Marcus Johnson"
 *   }
 */
export async function handleOutboundCall(
  req: Request,
  res: Response,
): Promise<void> {
  const {
    to,
    from,
    prompt,
    voice,
    callerName,
    metadata,
  } = req.body as OutboundCallRequest;

  if (!to || !prompt) {
    res.status(400).json({ error: 'Missing required fields: to, prompt' });
    return;
  }

  const fromNumber = from || env.TWILIO_FROM_NUMBER || '';
  const voicePrompt = voice || env.DEFAULT_VOICE;

  if (!fromNumber) {
    res.status(400).json({ error: 'No "from" number provided and TWILIO_FROM_NUMBER not set' });
    return;
  }

  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    res.status(500).json({ error: 'Twilio credentials not configured' });
    return;
  }

  logger.info('Initiating outbound call', {
    to,
    from: fromNumber,
    voice: voicePrompt,
    callerName,
  });

  // Build the stream URL — Twilio will connect here after the call is answered.
  const host = req.headers.host || 'localhost:3000';
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${host}/media-stream`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${escapeXml(wsUrl)}"><Parameter name="voice" value="${escapeXml(voicePrompt)}"/><Parameter name="prompt" value="${escapeXml(prompt)}"/></Stream></Connect></Response>`;

  try {
    // Use Twilio REST API to create the outbound call.
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          From: fromNumber,
          Twiml: twiml,
          StatusCallback: `https://${host}/twilio/status`,
          StatusCallbackMethod: 'POST',
          StatusCallbackEvent: 'initiated ringing answered completed',
        }),
      },
    );

    const callData = await twilioRes.json() as Record<string, unknown>;

    if (!twilioRes.ok) {
      logger.error('Twilio outbound call failed', {
        status: twilioRes.status,
        error: callData,
      });
      res.status(twilioRes.status).json({
        error: 'Failed to initiate call',
        details: callData,
      });
      return;
    }

    const callSid = callData.sid as string;

    logger.info('Outbound call initiated', {
      callId: callSid,
      to,
      from: fromNumber,
      callerName,
    });

    // Persist call record.
    try {
      await createCall({
        callSid,
        fromNumber,
        toNumber: to,
        status: 'initiated',
        startedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Failed to persist outbound call record', {
        callId: callSid,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    res.json({
      success: true,
      callSid,
      to,
      from: fromNumber,
      voice: voicePrompt,
      callerName,
    });
  } catch (err) {
    logger.error('Outbound call error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({
      error: 'Internal error initiating call',
    });
  }
}

// ── Adapter factory (env-driven) ─────────────────────────────────────────────

function buildCrmAdapter(): CrmAdapter {
  if (env.USE_STUB_ADAPTERS !== 'false' || !env.CRM_BASE_URL || !env.CRM_API_KEY) {
    return new StubCrmAdapter();
  }
  return new GhlCrmAdapter({
    baseUrl: env.CRM_BASE_URL,
    apiKey: env.CRM_API_KEY,
  });
}

function buildCalendarAdapter(): CalendarAdapter {
  if (
    env.USE_STUB_ADAPTERS !== 'false' ||
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REFRESH_TOKEN
  ) {
    return new StubCalendarAdapter();
  }
  return new GoogleCalendarAdapter({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
    calendarId: env.GOOGLE_CALENDAR_ID,
  });
}

// ── Enriched Outbound Call ───────────────────────────────────────────────────

export interface EnrichedOutboundRequest {
  to: string;
  templatePrompt?: string;
  voice?: string;
}

/**
 * POST /api/outbound/enriched
 *
 * Accepts a phone number, looks up the contact in CRM, pulls today's calendar,
 * builds a fully enriched system prompt, then initiates the outbound call via
 * the existing Twilio flow.
 *
 * Degrades gracefully: if CRM or Calendar are unavailable the prompt still
 * contains sensible defaults.
 */
export async function handleEnrichedOutboundCall(
  req: Request,
  res: Response,
): Promise<void> {
  const { to, templatePrompt, voice } = req.body as EnrichedOutboundRequest;

  if (!to) {
    res.status(400).json({ error: 'Missing required field: to' });
    return;
  }

  const agentName = env.AGENT_NAME;
  const companyName = env.COMPANY_NAME;

  // ── Build adapters ──
  const crm = buildCrmAdapter();
  const calendar = buildCalendarAdapter();

  // ── Enrich: CRM lookup ──
  let contact: { name?: string; company?: string; id?: string } | null = null;
  let deals: Array<{ name: string; value: number }> = [];

  try {
    contact = await crm.findContactByPhone(to);
    if (contact?.id) {
      const rawDeals = await crm.getOpenDeals(contact.id);
      deals = rawDeals.map((d) => ({ name: d.name, value: d.value }));
    }
  } catch (err) {
    logger.warn('CRM enrichment failed, using defaults', {
      to,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Enrich: Calendar ──
  let events: Array<{ time: string; title: string }> = [];

  try {
    const todayEvents = await calendar.getTodayEvents();
    events = todayEvents.map((e) => ({ time: e.startTime, title: e.summary }));
  } catch (err) {
    logger.warn('Calendar enrichment failed, using defaults', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Build enriched prompt ──
  const enrichedPrompt = `
# Identity
You are ${agentName || 'an AI assistant'} at ${companyName || 'our company'}.
Tone: warm, concise, professional.
Keep responses to 1-2 sentences.

# Current Call Context
Date and time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}
Caller name: ${contact?.name || 'Unknown'}
Account: ${contact?.company || 'Unknown'}
Open deals: ${deals.length > 0 ? deals.map((d) => d.name + ' - $' + d.value).join(', ') : 'None'}
Today's meetings: ${events.length > 0 ? events.map((e) => e.time + ' - ' + e.title).join(', ') : 'None'}

# Mission
${templatePrompt || 'Help the caller with scheduling and account questions.'}

# Rules
ALWAYS:
- Use the caller's first name after the greeting
- Confirm before any booking or scheduling action
- Speak numbers naturally

NEVER:
- Mention you are AI unless asked
- Use filler phrases like "Certainly!" or "Absolutely!"
- Make up information not in the context above
`.trim();

  logger.info('Enriched outbound prompt built', {
    to,
    contactFound: !!contact,
    dealsCount: deals.length,
    eventsCount: events.length,
  });

  // ── Delegate to the existing outbound handler by synthesizing the request ──
  req.body = {
    to,
    prompt: enrichedPrompt,
    voice: voice || env.DEFAULT_VOICE,
    callerName: contact?.name,
  } satisfies OutboundCallRequest;

  return handleOutboundCall(req, res);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
