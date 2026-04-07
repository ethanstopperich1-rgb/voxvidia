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
  // The session pool ensures PersonaPlex is pre-warmed and ready.
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
 * Initiate an outbound call with a fully personalized PersonaPlex agent.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
