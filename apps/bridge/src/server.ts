/**
 * Voxvidia Bridge Server
 *
 * Twilio Media Streams  <-->  Deepgram STT + GPT-4.1 mini + Rime TTS
 *
 * Audio flow (inbound voice):
 *   Twilio (8 kHz mu-law base64) -> decode mu-law -> upsample 8k->16k PCM
 *     -> send to Deepgram Nova-3 (16 kHz linear16)
 *
 * Audio flow (AI response):
 *   GPT-4.1 mini text tokens -> Rime Mist v3 (mulaw 8kHz)
 *     -> send directly to Twilio (zero transcoding)
 *
 * Text flow:
 *   Deepgram final transcripts -> GPT-4.1 mini -> streamed tokens
 *     -> sentence-chunked to Rime TTS
 */

import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createLogger, env } from '@voxvidia/shared';
import { SessionManager } from './session.js';
import { decodeMulaw, encodeMulaw, resample, pcmToBuffer, bufferToPcm } from './audio.js';
import { createDeepgramConnection } from './deepgram.js';
import { createRimeConnection, chunkTextForTTS } from './rime.js';
import {
  streamChatCompletion,
  buildSystemPrompt,
  getFillerPhrase,
} from './llm.js';
import type { ChatMessage, ToolCall } from './llm.js';
import {
  handleIncomingCall,
  handleCallStatus,
  handleRecordingStatus,
  handleOutboundCall,
  handleEnrichedOutboundCall,
  validateTwilioSignature,
} from './twilio.js';
import { ToolRunner, ToolRegistry } from '@voxvidia/orchestrator';
import { runPostCallAnalysis, type CallData } from './post-call.js';

const logger = createLogger('bridge:server');
const sessions = new SessionManager();

// ── Supabase client (singleton, skip if env vars missing) ────────────────────
const DEALER_ID = '00000000-0000-0000-0000-000000000001'; // Orlando Motors

let supabase: SupabaseClient | null = null;
if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  logger.info('Supabase client initialized');
} else {
  logger.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not set — call data will NOT be persisted');
}

/** Fire-and-forget Supabase write. Logs errors but never throws. */
function dbWrite(label: string, fn: (sb: SupabaseClient) => Promise<any>) {
  if (!supabase) return;
  fn(supabase).catch((err) => {
    logger.error(`Supabase ${label} write failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

// In-memory accumulators for post-call analysis (keyed by callSid)
const callTranscripts = new Map<string, Array<{ speaker: string; text: string; timestamp_ms: number }>>();
const callToolCalls = new Map<string, Array<{ name: string; args: any; result: any; success: boolean }>>();
const callStartTimes = new Map<string, number>();

// ── Tool Runner setup (VIP Buyback — real Supabase implementations) ─────────
const toolRegistry = new ToolRegistry();

// VIP desk number — could be env var later
const VIP_DESK_NUMBER = '+14072890294';

toolRegistry.register('get_buyback_lead_context', async (args) => {
  if (!supabase) return { found: false, reason: 'database_unavailable' };

  const phone = (args.caller_phone as string) || '';
  const mailerCode = args.mailer_code as string | null;

  // Normalize phone: strip non-digits, ensure E.164-ish for matching
  const digits = phone.replace(/\D/g, '');
  if (!digits && !mailerCode) return { found: false, reason: 'no_identifier' };

  // Try mailer_code first (most specific), then phone
  let query = supabase.from('leads').select('*');
  if (mailerCode) {
    query = query.eq('mailer_code', mailerCode);
  } else {
    // Match on last 10 digits to handle +1 prefix variations
    const last10 = digits.slice(-10);
    query = query.like('phone', `%${last10}`);
  }

  const { data, error } = await query.eq('dealer_id', DEALER_ID).limit(1).single();

  if (error || !data) {
    logger.info('No lead found for caller', { phone, mailerCode });
    return { found: false, reason: 'no_match' };
  }

  return {
    found: true,
    lead_id: data.id,
    customer_name: data.customer_name,
    vehicle: data.vehicle,
    mailer_campaign: data.mailer_campaign,
    status: data.status,
    still_owns_vehicle: data.still_owns_vehicle,
    callback_phone: data.callback_phone,
  };
});

toolRegistry.register('update_lead_status', async (args) => {
  if (!supabase) return { updated: false, error: 'database_unavailable' };

  const leadId = args.lead_id as string;
  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (args.still_owns_vehicle != null) updateFields.still_owns_vehicle = args.still_owns_vehicle;
  if (args.interest_level) updateFields.interest_level = args.interest_level;
  if (args.vehicle_disposition) updateFields.vehicle_disposition = args.vehicle_disposition;
  if (args.notes) updateFields.notes = args.notes;

  // Map interest_level to lead status
  const interestToStatus: Record<string, string> = {
    interested: 'interested',
    not_interested: 'not_interested',
    wrong_person: 'wrong_person',
  };
  if (args.interest_level && interestToStatus[args.interest_level as string]) {
    updateFields.status = interestToStatus[args.interest_level as string];
  }
  if (args.still_owns_vehicle === false) {
    updateFields.status = 'no_longer_has_vehicle';
  }

  const { error } = await supabase.from('leads').update(updateFields).eq('id', leadId);

  if (error) {
    logger.error('update_lead_status failed', { leadId, error: error.message });
    return { updated: false, error: error.message };
  }

  return { updated: true, lead_id: leadId };
});

toolRegistry.register('get_appraisal_slots', async (args) => {
  // Generate 2 real slots based on current date/time
  // Rules: no Sundays, no same-day slots after 4 PM, hard-cap at 2 slots
  const maxSlots = Math.min(Number(args.max_slots_to_return) || 2, 2);
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const slots: Array<{ slot_id: string; date: string; time: string; available: boolean }> = [];

  // Start from tomorrow if it's after 4 PM today
  let startDay = now.getHours() >= 16 ? 1 : 0;
  if (startDay === 0) startDay = 1; // always start from at least tomorrow

  for (let dayOffset = startDay; dayOffset < 14 && slots.length < maxSlots; dayOffset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + dayOffset);

    // Skip Sundays
    if (candidate.getDay() === 0) continue;

    const dayName = dayNames[candidate.getDay()];
    const monthName = monthNames[candidate.getMonth()];
    const dateStr = `${dayName}, ${monthName} ${candidate.getDate()}`;

    // Morning slot: 10 AM
    if (slots.length < maxSlots) {
      const slotDate = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, '0')}-${String(candidate.getDate()).padStart(2, '0')}`;
      slots.push({
        slot_id: `slot_${slotDate}_10am`,
        date: dateStr,
        time: '10:00 AM',
        available: true,
      });
    }

    // Afternoon slot: 2 PM
    if (slots.length < maxSlots) {
      const slotDate = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, '0')}-${String(candidate.getDate()).padStart(2, '0')}`;
      slots.push({
        slot_id: `slot_${slotDate}_2pm`,
        date: dateStr,
        time: '2:00 PM',
        available: true,
      });
    }
  }

  return { slots };
});

toolRegistry.register('book_appraisal_appointment', async (args) => {
  if (args.customer_confirmed_slot !== true) {
    return { error: 'Slot not confirmed by customer' };
  }

  if (!supabase) return { error: 'database_unavailable' };

  const leadId = args.lead_id as string;
  const slotId = args.selected_slot_id as string;

  // Parse slot_id format: slot_YYYY-MM-DD_10am or slot_YYYY-MM-DD_2pm
  const slotMatch = slotId.match(/^slot_(\d{4}-\d{2}-\d{2})_(\d{1,2})(am|pm)$/);
  if (!slotMatch) return { error: 'Invalid slot ID format' };

  const [, dateStr, hourStr, meridiem] = slotMatch;
  let hour = parseInt(hourStr, 10);
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  const timeStr = `${String(hour).padStart(2, '0')}:00:00`;

  // Idempotency: check if this lead already has a confirmed appointment for this slot
  const { data: existing } = await supabase
    .from('appointments')
    .select('id, confirmation_code')
    .eq('lead_id', leadId)
    .eq('appointment_date', dateStr)
    .eq('appointment_time', timeStr)
    .eq('status', 'confirmed')
    .limit(1)
    .maybeSingle();

  if (existing) {
    logger.info('Duplicate booking prevented — returning existing appointment', {
      leadId, confirmation: existing.confirmation_code,
    });
    // Return the existing appointment instead of creating a duplicate
    const displayHourExisting = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const displayMeridiemExisting = hour >= 12 ? 'PM' : 'AM';
    const existingDate = new Date(dateStr + 'T12:00:00');
    const dNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const mNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return {
      booked: true,
      confirmation: existing.confirmation_code,
      date: `${dNames[existingDate.getDay()]}, ${mNames[existingDate.getMonth()]} ${existingDate.getDate()}`,
      time: `${displayHourExisting}:00 ${displayMeridiemExisting}`,
      duration: '15 minutes',
    };
  }

  const confirmationCode = 'VX-' + Date.now().toString().slice(-6);

  const { error } = await supabase.from('appointments').insert({
    dealer_id: DEALER_ID,
    lead_id: leadId,
    confirmation_code: confirmationCode,
    appointment_date: dateStr,
    appointment_time: timeStr,
    duration_minutes: 15,
    appointment_type: (args.appointment_type as string) || 'vip_buyback_appraisal',
    callback_phone: (args.callback_phone as string) || null,
    notes: (args.notes as string) || null,
  });

  if (error) {
    logger.error('book_appraisal_appointment failed', { leadId, error: error.message });
    return { error: error.message };
  }

  // Update lead status
  await supabase.from('leads').update({
    status: 'appointment_booked',
    updated_at: new Date().toISOString(),
  }).eq('id', leadId);

  // Format the time naturally for the response
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const displayMeridiem = hour >= 12 ? 'PM' : 'AM';
  const appointmentDate = new Date(dateStr + 'T12:00:00');
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const displayDate = `${dayNames[appointmentDate.getDay()]}, ${monthNames[appointmentDate.getMonth()]} ${appointmentDate.getDate()}`;

  return {
    booked: true,
    confirmation: confirmationCode,
    date: displayDate,
    time: `${displayHour}:00 ${displayMeridiem}`,
    duration: '15 minutes',
  };
});

toolRegistry.register('save_callback_number', async (args) => {
  if (args.customer_confirmed_digits !== true) {
    return { error: 'Digits not confirmed' };
  }

  const raw = (args.callback_phone_raw as string) || '';
  const digits = raw.replace(/\D/g, '');

  // Normalize to E.164
  let normalized: string;
  if (digits.length === 10) {
    normalized = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    normalized = `+${digits}`;
  } else {
    normalized = `+${digits}`;
  }

  if (!supabase) return { saved: true, normalized };

  const leadId = args.lead_id as string;
  const { error } = await supabase.from('leads').update({
    callback_phone: normalized,
    updated_at: new Date().toISOString(),
  }).eq('id', leadId);

  if (error) {
    logger.error('save_callback_number failed', { leadId, error: error.message });
    return { saved: false, error: error.message };
  }

  return { saved: true, normalized };
});

toolRegistry.register('transfer_to_vip_desk', async (args) => {
  // Log the transfer in Supabase
  if (supabase) {
    await supabase.from('transfer_log').insert({
      dealer_id: DEALER_ID,
      lead_id: (args.lead_id as string) || null,
      transfer_reason: args.transfer_reason as string,
      vip_desk_number: VIP_DESK_NUMBER,
    }).then(({ error }) => {
      if (error) logger.error('transfer_log insert failed', { error: error.message });
    });
  }

  // Attempt real Twilio call transfer via REST API
  // This updates the live call to redirect to a <Dial> TwiML that connects to VIP desk
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;

  // The callSid is stored in the args context or we find it from the lead's last_call_sid
  // For now, we need the callSid passed via tool context — the LLM doesn't have it,
  // so we return the transfer instructions and let the bridge handle the redirect.
  if (accountSid && authToken) {
    // Find the active call for this lead to redirect
    const leadId = args.lead_id as string | null;
    if (leadId && supabase) {
      const { data: leadData } = await supabase
        .from('leads')
        .select('last_call_sid')
        .eq('id', leadId)
        .single();

      const activeCallSid = leadData?.last_call_sid;
      if (activeCallSid) {
        try {
          const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
          const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting you to our VIP team now.</Say><Dial timeout="30">${VIP_DESK_NUMBER}</Dial></Response>`;

          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${activeCallSid}.json`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({ Twiml: twiml }),
            },
          );

          if (res.ok) {
            logger.info('Twilio call transferred to VIP desk', {
              callSid: activeCallSid,
              vipNumber: VIP_DESK_NUMBER,
            });
            return {
              transferred: true,
              department: 'VIP Desk',
              phone_number: VIP_DESK_NUMBER,
              reason: args.transfer_reason,
            };
          }
          const errBody = await res.text();
          logger.error('Twilio transfer API error', { status: res.status, body: errBody });
        } catch (err) {
          logger.error('Twilio transfer failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // Fallback: log-only transfer (Twilio creds missing or call not found)
  logger.warn('Transfer logged but not executed — Twilio redirect unavailable', {
    leadId: args.lead_id,
    reason: args.transfer_reason,
  });
  return {
    transferred: false,
    transfer_logged: true,
    department: 'VIP Desk',
    phone_number: VIP_DESK_NUMBER,
    reason: args.transfer_reason,
    note: 'Transfer was logged. A team member will follow up shortly.',
  };
});

toolRegistry.register('log_call_outcome', async (args) => {
  if (!supabase) return { logged: false, error: 'database_unavailable' };

  const leadId = args.lead_id as string | null;
  const outcome = args.final_outcome as string;
  const followUp = args.follow_up_needed as boolean;
  const summary = args.summary_note as string | null;

  // Update lead status based on outcome
  if (leadId) {
    const outcomeToStatus: Record<string, string> = {
      appointment_booked: 'appointment_booked',
      not_interested: 'not_interested',
      no_longer_has_vehicle: 'no_longer_has_vehicle',
      wrong_person: 'wrong_person',
      requested_callback: 'callback_requested',
    };
    const newStatus = outcomeToStatus[outcome];
    if (newStatus) {
      await supabase.from('leads').update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', leadId);
    }
  }

  return { logged: true, outcome };
});

const toolRunner = new ToolRunner(toolRegistry);

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    activeCalls: sessions.count,
    uptime: process.uptime(),
    stack: 'deepgram-nova3 + gpt-4.1-mini + rime-mistv3',
  });
});

// Twilio webhooks.
app.post('/twilio/voice', (req, res) => {
  if (!validateTwilioSignature(req)) {
    logger.warn('Invalid Twilio signature on /twilio/voice');
    res.sendStatus(403);
    return;
  }
  handleIncomingCall(req, res).catch((err) => {
    logger.error('handleIncomingCall error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.sendStatus(500);
  });
});

app.post('/twilio/status', (req, res) => {
  handleCallStatus(req, res).catch((err) => {
    logger.error('handleCallStatus error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.sendStatus(500);
  });
});

app.post('/twilio/recording-status', (req, res) => {
  handleRecordingStatus(req, res).catch((err) => {
    logger.error('handleRecordingStatus error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.sendStatus(500);
  });
});

// ── Outbound API auth middleware ─────────────────────────────────────────────
function requireApiSecret(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const secret = env.VOXVIDIA_API_SECRET;
  if (!secret) {
    // Fail-closed in production — only allow open access in development
    if (env.NODE_ENV === 'production') {
      logger.error('VOXVIDIA_API_SECRET not set in production — blocking request');
      res.status(503).json({ error: 'Service misconfigured' });
      return;
    }
    logger.warn('VOXVIDIA_API_SECRET not set — allowing request (dev mode)');
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    logger.warn('Missing Authorization header', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Extract bearer token and use constant-time comparison
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);

  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    logger.warn('Invalid API secret', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// Outbound call API.
app.post('/api/outbound', requireApiSecret, (req, res) => {
  handleOutboundCall(req, res).catch((err) => {
    logger.error('handleOutboundCall error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Internal error' });
  });
});

// Enriched outbound call API (CRM + Calendar context injected into prompt).
app.post('/api/outbound/enriched', requireApiSecret, (req, res) => {
  handleEnrichedOutboundCall(req, res).catch((err) => {
    logger.error('handleEnrichedOutboundCall error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Internal error' });
  });
});

// ── HTTP + WebSocket server ───────────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ── Twilio Media Stream WebSocket handler ─────────────────────────────────────

wss.on('connection', (twilioWs: WebSocket, req) => {
  if (req.url !== '/media-stream') {
    logger.warn('Rejected WebSocket connection to non-media-stream path', {
      url: req.url,
    });
    twilioWs.close();
    return;
  }

  logger.info('Twilio Media Stream WebSocket connected');

  // These will be populated by the "start" event.
  let callSid: string | undefined = undefined;

  twilioWs.on('message', (raw: RawData) => {
    let msg: TwilioMediaMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      logger.warn('Failed to parse Twilio WS message');
      return;
    }

    switch (msg.event) {
      // ── Stream start ────────────────────────────────────────────────────
      case 'start': {
        const startData = msg.start!;
        callSid = startData.callSid;
        const streamSid = startData.streamSid;
        const fromNumber = startData.customParameters?.from || 'unknown';
        const toNumber = startData.customParameters?.to || 'unknown';

        const voicePrompt =
          startData.customParameters?.voice || env.DEFAULT_VOICE;
        const textPrompt =
          startData.customParameters?.prompt || env.DEFAULT_PROMPT;

        logger.info('Media stream started', {
          callId: callSid,
          streamSid,
          voicePrompt,
        });

        // 1. Create session
        const session = sessions.create(
          callSid,
          fromNumber,
          toNumber,
          voicePrompt,
          textPrompt,
        );
        session.streamSid = streamSid;

        // 1b. Track call start time and init accumulators for post-call
        const callStartTime = Date.now();
        callStartTimes.set(callSid, callStartTime);
        callTranscripts.set(callSid, []);
        callToolCalls.set(callSid, []);

        // 1c. Insert call record into Supabase (fire-and-forget)
        dbWrite('calls.insert', (sb) =>
          sb.from('calls').insert({
            call_sid: callSid,
            dealer_id: DEALER_ID,
            direction: 'inbound',
            from_number: fromNumber || 'unknown',
            to_number: toNumber || 'unknown',
            status: 'active',
          }),
        );

        // 2. Build initial system prompt (will be rebuilt after lead lookup)
        const buildPromptOpts = {
          agentName: env.AGENT_NAME,
          companyName: env.COMPANY_NAME,
          customPrompt: textPrompt !== 'default' ? textPrompt : undefined,
          callerPhone: fromNumber,
          currentDateTime: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
        } as Parameters<typeof buildSystemPrompt>[0];

        const systemPrompt = buildSystemPrompt(buildPromptOpts);

        // 3. Initialize conversation messages
        session.llmMessages = [{ role: 'system', content: systemPrompt }];

        // 4. Connect to Rime TTS
        const rimeConn = createRimeConnection(env.RIME_API_KEY || '', env.RIME_VOICE, {
          onAudio: (mulawBuffer) => {
            // /ws endpoint with audioFormat=mulaw&samplingRate=8000 outputs
            // raw mulaw 8kHz — send DIRECTLY to Twilio, zero conversion.
            if (twilioWs.readyState === WebSocket.OPEN && session.streamSid) {
              twilioWs.send(JSON.stringify({
                event: 'media',
                streamSid: session.streamSid,
                media: { payload: mulawBuffer.toString('base64') },
              }));
            }
          },
          onDone: () => {
            session.rimeIsSpeaking = false;
          },
          onError: (err) => {
            logger.error('Rime error', { callId: callSid, error: err.message });
          },
          onClose: () => {
            logger.info('Rime closed', { callId: callSid });
          },
        }, callSid!);
        session.rimeConn = rimeConn;

        // 5. Function to send LLM response text to Rime TTS
        const speakText = (text: string) => {
          const chunks = chunkTextForTTS(text);
          for (const chunk of chunks) {
            rimeConn.speak(chunk);
          }
          session.rimeIsSpeaking = true;
        };

        // 6. Function to handle LLM tool calls (with retry limit)
        let toolCallCount = 0;
        const MAX_TOOL_CALLS = 8;
        const handleToolCall = async (toolCall: ToolCall) => {
          toolCallCount++;
          if (toolCallCount > MAX_TOOL_CALLS) {
            logger.warn('Tool call limit reached', { callId: callSid, count: toolCallCount });
            speakText("I apologize, I'm having some trouble with my system. Would you like me to connect you with a team member instead?");
            return;
          }
          const toolName = toolCall.function.name;
          const filler = getFillerPhrase(toolName);

          // Speak filler phrase while tool executes (skip silent tools)
          if (filler) {
            speakText(filler);
          }

          let args: Record<string, any>;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            args = {};
          }

          // Execute tool via orchestrator
          const toolStartMs = Date.now();
          try {
            const result = await toolRunner.runTool(toolName, args);
            const latencyMs = Date.now() - toolStartMs;

            // Track tool call for post-call analysis
            callToolCalls.get(callSid!)?.push({ name: toolName, args, result, success: true });

            // Write tool call to Supabase (fire-and-forget)
            dbWrite('call_tool_calls.insert', (sb) =>
              sb.from('call_tool_calls').insert({
                call_sid: callSid,
                dealer_id: DEALER_ID,
                tool_name: toolName,
                arguments: args,
                result,
                latency_ms: latencyMs,
                success: true,
              }),
            );

            // Add tool call + result to conversation
            session.llmMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: [toolCall],
            });
            session.llmMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });

            // Get LLM to formulate response with tool result
            await streamChatCompletion(env.OPENAI_API_KEY || '', session.llmMessages, {
              onToken: (token) => {
                // Tokens are buffered by the onDone handler below;
                // sentence-level streaming is handled in the primary onTranscript path.
              },
              onToolCall: (tc) => {
                handleToolCall(tc);
              },
              onDone: (text) => {
                speakText(text);
                session.llmMessages.push({ role: 'assistant', content: text });

                // Write agent transcript to Supabase
                const startTs = callStartTimes.get(callSid!) || Date.now();
                callTranscripts.get(callSid!)?.push({ speaker: 'agent', text, timestamp_ms: Date.now() - startTs });
                dbWrite('call_transcripts.insert(agent/tool)', (sb) =>
                  sb.from('call_transcripts').insert({
                    call_sid: callSid,
                    dealer_id: DEALER_ID,
                    speaker: 'agent',
                    text,
                    timestamp_ms: Date.now() - startTs,
                  }),
                );
              },
              onError: (err) => {
                logger.error('LLM error after tool', { callId: callSid, error: err.message });
              },
            }, callSid!);
          } catch (err) {
            const latencyMs = Date.now() - toolStartMs;
            logger.error('Tool execution error', {
              callId: callSid,
              tool: toolName,
              error: err instanceof Error ? err.message : String(err),
            });

            // Track failed tool call
            callToolCalls.get(callSid!)?.push({ name: toolName, args, result: null, success: false });
            dbWrite('call_tool_calls.insert(error)', (sb) =>
              sb.from('call_tool_calls').insert({
                call_sid: callSid,
                dealer_id: DEALER_ID,
                tool_name: toolName,
                arguments: args,
                result: { error: err instanceof Error ? err.message : String(err) },
                latency_ms: latencyMs,
                success: false,
              }),
            );

            speakText("I'm sorry, I'm having a little trouble with that. Let me connect you with our team.");
          }
        };

        // 7. Connect to Deepgram STT
        const deepgramConn = createDeepgramConnection(env.DEEPGRAM_API_KEY || '', {
          onTranscript: async (text, isSpeechFinal) => {
            // Accumulate all finalized segments
            session.transcript.onToken(text);

            // Only send to LLM when the caller has FULLY finished speaking (speechFinal=true)
            if (!isSpeechFinal) {
              logger.debug('Deepgram partial segment (waiting for speechFinal)', { callId: callSid, text });
              return;
            }

            // Get the full accumulated utterance
            const fullUtterance = session.transcript.getLastUtterance() || text;
            logger.info('Caller said', { callId: callSid, text: fullUtterance });

            // Write caller transcript to Supabase (fire-and-forget)
            const startTs = callStartTimes.get(callSid!) || Date.now();
            callTranscripts.get(callSid!)?.push({ speaker: 'caller', text, timestamp_ms: Date.now() - startTs });
            dbWrite('call_transcripts.insert(caller)', (sb) =>
              sb.from('call_transcripts').insert({
                call_sid: callSid,
                dealer_id: DEALER_ID,
                speaker: 'caller',
                text,
                timestamp_ms: Date.now() - startTs,
              }),
            );

            // Add caller message to conversation (use full utterance, not partial segment)
            session.llmMessages.push({ role: 'user', content: fullUtterance });

            // Get LLM response
            const llmResponseStartMs = Date.now();
            let firstTokenMs: number | null = null;
            let responseBuffer = '';
            await streamChatCompletion(env.OPENAI_API_KEY || '', session.llmMessages, {
              onToken: (token) => {
                if (firstTokenMs === null) {
                  firstTokenMs = Date.now() - llmResponseStartMs;
                }
                responseBuffer += token;
                // Send complete sentences to Rime for synthesis.
                // Sentence-split for TTS. Match sentences ending with
                // punctuation followed by a space or end-of-buffer, but
                // skip abbreviations (Mr. Mrs. Dr. St. etc.), decimals
                // (4.1, 2.0), and time periods (A.M. P.M.).
                const sentenceRe = /(?:(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|Inc|Ltd|a\.m|p\.m|A\.M|P\.M)\.|[0-9]+\.[0-9]+|[^.!?])+[.!?]+(?=\s|$)/g;
                let lastMatchEnd = 0;
                let match: RegExpExecArray | null;
                while ((match = sentenceRe.exec(responseBuffer)) !== null) {
                  rimeConn.speak(match[0].trim());
                  lastMatchEnd = sentenceRe.lastIndex;
                }
                if (lastMatchEnd > 0) {
                  responseBuffer = responseBuffer.substring(lastMatchEnd);
                }
                session.rimeIsSpeaking = true;
              },
              onToolCall: handleToolCall,
              onDone: (fullText) => {
                // Send any remaining text
                if (responseBuffer.trim().length > 0) {
                  rimeConn.speak(responseBuffer.trim());
                }
                session.llmMessages.push({ role: 'assistant', content: fullText });
                const totalResponseMs = Date.now() - llmResponseStartMs;
                logger.info('Agent said', {
                  callId: callSid,
                  text: fullText,
                  firstTokenMs,
                  totalResponseMs,
                });

                // Write agent transcript to Supabase (fire-and-forget)
                const startTs2 = callStartTimes.get(callSid!) || Date.now();
                callTranscripts.get(callSid!)?.push({ speaker: 'agent', text: fullText, timestamp_ms: Date.now() - startTs2 });
                dbWrite('call_transcripts.insert(agent)', (sb) =>
                  sb.from('call_transcripts').insert({
                    call_sid: callSid,
                    dealer_id: DEALER_ID,
                    speaker: 'agent',
                    text: fullText,
                    timestamp_ms: Date.now() - startTs2,
                  }),
                );
              },
              onError: (err) => {
                logger.error('LLM error', { callId: callSid, error: err.message });
                speakText("I'm sorry, could you say that again?");
              },
            }, callSid!);
          },
          onInterim: (text) => {
            // Barge-in detection: caller is speaking while AI is talking
            if (session.rimeIsSpeaking && text.split(' ').length >= 3) {
              // 1. Clear Rime's synthesis buffer
              rimeConn.clear();
              session.rimeIsSpeaking = false;

              // 2. Clear Twilio's audio playback queue so silence is immediate
              if (twilioWs.readyState === WebSocket.OPEN && session.streamSid) {
                twilioWs.send(JSON.stringify({
                  event: 'clear',
                  streamSid: session.streamSid,
                }));
              }

              logger.info('Barge-in detected — cleared Rime + Twilio', { callId: callSid, interim: text });
            }
          },
          onUtteranceEnd: () => {
            session.transcript.flush();
          },
          onError: (err) => {
            logger.error('Deepgram error', { callId: callSid, error: err.message });
          },
          onClose: () => {
            logger.info('Deepgram closed', { callId: callSid });
          },
        }, callSid!);
        session.deepgramConn = deepgramConn;

        // 8. Lookup lead context first (with 300ms hard timeout), then generate AI greeting
        (async () => {
          const greetingStartMs = Date.now();
          try {
            // Race the lead lookup against a 300ms deadline so the caller
            // never waits in silence for a slow DB query.
            const LEAD_LOOKUP_TIMEOUT_MS = 300;
            const leadResult = await Promise.race([
              toolRunner.runTool('get_buyback_lead_context', {
                lead_session_id: null,
                caller_phone: fromNumber,
                mailer_code: null,
              }),
              new Promise<{ success: false; data: null; latencyMs: number }>((resolve) =>
                setTimeout(() => resolve({ success: false, data: null, latencyMs: LEAD_LOOKUP_TIMEOUT_MS }), LEAD_LOOKUP_TIMEOUT_MS),
              ),
            ]);

            const lookupMs = Date.now() - greetingStartMs;
            if (leadResult.success && leadResult.data) {
              const lead = leadResult.data as Record<string, unknown>;
              if (lead.found !== false && lead.customer_name) {
                // Rebuild system prompt with lead data
                buildPromptOpts.callerName = String(lead.customer_name);
                buildPromptOpts.vehicleInfo = lead.vehicle ? String(lead.vehicle) : undefined;
                buildPromptOpts.contactId = lead.lead_id ? String(lead.lead_id) : undefined;
                const enrichedPrompt = buildSystemPrompt(buildPromptOpts);
                session.llmMessages = [{ role: 'system', content: enrichedPrompt }];
                logger.info('Lead context loaded for greeting', {
                  callId: callSid,
                  name: lead.customer_name,
                  vehicle: lead.vehicle,
                  lookupMs,
                });

                // Stamp the active callSid on the lead so transfer_to_vip_desk can find it
                if (supabase && lead.lead_id) {
                  dbWrite('leads.stamp_call_sid', (sb) =>
                    sb.from('leads').update({
                      last_call_sid: callSid,
                      last_contacted_at: new Date().toISOString(),
                    }).eq('id', String(lead.lead_id)),
                  );
                }
              }
            } else {
              logger.info('Lead lookup skipped or timed out, using generic greeting', {
                callId: callSid,
                lookupMs,
              });
            }
          } catch (err) {
            logger.warn('Lead lookup failed before greeting, using generic opener', {
              callId: callSid,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          // Generate greeting (with or without lead context)
          const llmStartMs = Date.now();
          try {
            await streamChatCompletion(env.OPENAI_API_KEY || '', session.llmMessages.slice(), {
              onToken: () => {},
              onToolCall: handleToolCall,
              onDone: (greeting) => {
                const totalGreetingMs = Date.now() - greetingStartMs;
                const llmMs = Date.now() - llmStartMs;
                speakText(greeting);
                session.llmMessages.push({ role: 'assistant', content: greeting });
                logger.info('AI greeting', {
                  callId: callSid,
                  text: greeting,
                  totalGreetingMs,
                  llmMs,
                });
              },
              onError: () => {
                speakText("Hi, thanks for calling. How can I help you today?");
              },
            }, callSid!);
          } catch (err) {
            logger.error('Greeting generation error', {
              callId: callSid,
              error: err instanceof Error ? err.message : String(err),
            });
            speakText("Hi, thanks for calling. How can I help you today?");
          }
        })();

        break;
      }

      // ── Media (audio) ───────────────────────────────────────────────────
      case 'media': {
        if (!callSid) return;
        const session = sessions.get(callSid);
        if (!session?.deepgramConn?.isReady()) return;

        const payload = msg.media!.payload;
        const mulawBytes = Buffer.from(payload, 'base64');
        const pcm8k = decodeMulaw(mulawBytes);
        const pcm16k = resample(pcm8k, 8000, 16000);
        const pcmBuffer = pcmToBuffer(pcm16k);
        session.deepgramConn.send(pcmBuffer);
        break;
      }

      // ── Stream stop ─────────────────────────────────────────────────────
      case 'stop': {
        logger.info('Media stream stopped', { callId: callSid });

        if (callSid) {
          const session = sessions.get(callSid);
          if (session) {
            session.deepgramConn?.close();
            session.rimeConn?.close();
            session.transcript.flush();
            const transcript = session.transcript.getFullTranscript();
            if (transcript.length > 0) {
              logger.info('Final transcript', { callId: callSid, transcript });
            }
          }

          // Calculate duration
          const callStart = callStartTimes.get(callSid) || Date.now();
          const durationSeconds = Math.round((Date.now() - callStart) / 1000);

          // Update call record in Supabase (fire-and-forget)
          dbWrite('calls.update(completed)', (sb) =>
            sb
              .from('calls')
              .update({
                status: 'completed',
                ended_at: new Date().toISOString(),
                duration_seconds: durationSeconds,
              })
              .eq('call_sid', callSid),
          );

          // Gather transcript + tool call data for post-call analysis
          const transcriptData = callTranscripts.get(callSid) || [];
          const toolCallData = callToolCalls.get(callSid) || [];

          // Clean up in-memory accumulators
          callStartTimes.delete(callSid);
          callTranscripts.delete(callSid);
          callToolCalls.delete(callSid);

          sessions.end(callSid);

          // Run post-call analysis asynchronously (this one we DO await internally)
          if (supabase && env.OPENAI_API_KEY && transcriptData.length > 0) {
            const analysisCallSid = callSid; // capture for closure
            (async () => {
              try {
                const callDataForAnalysis: CallData = {
                  callSid: analysisCallSid,
                  dealerId: DEALER_ID,
                  transcript: transcriptData,
                  toolCalls: toolCallData,
                  durationSeconds,
                };

                const analysis = await runPostCallAnalysis(
                  env.OPENAI_API_KEY!,
                  callDataForAnalysis,
                );

                await supabase!.from('call_analysis').insert({
                  call_sid: analysisCallSid,
                  dealer_id: DEALER_ID,
                  summary: analysis.summary,
                  lead_outcome: analysis.lead_outcome,
                  sentiment: analysis.sentiment,
                  customer_name: analysis.customer_name,
                  customer_vehicle: analysis.customer_vehicle,
                  still_owns_vehicle: analysis.still_owns_vehicle,
                  appointment_booked: analysis.appointment_booked,
                  appointment_date: analysis.appointment_date,
                  appointment_time: analysis.appointment_time,
                  follow_up_needed: analysis.follow_up_needed,
                  follow_up_action: analysis.follow_up_action,
                  qa_flags: analysis.qa_flags,
                });

                logger.info('Post-call analysis persisted', { callSid: analysisCallSid });
              } catch (err) {
                logger.error('Post-call analysis error', {
                  callId: analysisCallSid,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            })();
          } else {
            // Fallback to workers package if Supabase is not configured
            import('@voxvidia/workers')
              .then(({ processPostCall }) => {
                processPostCall(callSid!).catch((err) => {
                  logger.error('Post-call worker error', {
                    callId: callSid,
                    error: err instanceof Error ? err.message : String(err),
                  });
                });
              })
              .catch(() => {
                logger.warn('Workers package not available, skipping post-call analysis', {
                  callId: callSid,
                });
              });
          }
        }
        break;
      }

      // ── Mark / DTMF / other events (ignored) ───────────────────────────
      default:
        break;
    }
  });

  twilioWs.on('close', () => {
    logger.info('Twilio WebSocket disconnected', { callId: callSid });
    if (callSid) {
      sessions.end(callSid);
    }
  });

  twilioWs.on('error', (err: Error) => {
    logger.error('Twilio WebSocket error', {
      callId: callSid,
      error: err.message,
    });
  });
});

// ── Twilio Media Stream message types ─────────────────────────────────────────

interface TwilioMediaMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark' | 'dtmf';
  sequenceNumber?: string;
  start?: {
    streamSid: string;
    callSid: string;
    accountSid: string;
    tracks: string[];
    customParameters?: Record<string, string>;
    mediaFormat?: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
}

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = env.PORT;

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Voxvidia bridge running on port ${PORT}`);
  logger.info('Stack: Deepgram Nova-3 + GPT-4.1 mini + Rime Mist v3');
});

// ── Process error handlers ────────────────────────────────────────────────────

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception', {
    error: err.message,
    stack: err.stack,
  });
  // Give structured log time to flush, then exit.
  setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// Graceful shutdown.
const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully`);

  // Close all active Deepgram + Rime connections.
  for (const session of sessions.all()) {
    session.deepgramConn?.close();
    session.rimeConn?.close();
    session.transcript.flush();
    sessions.end(session.callSid);
  }

  // Close the WebSocket server.
  wss.close(() => {
    server.close(() => {
      logger.info('Server shut down');
      process.exit(0);
    });
  });

  // Force exit after 10 seconds.
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
