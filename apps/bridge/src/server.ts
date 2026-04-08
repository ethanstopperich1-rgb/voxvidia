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

// ── Tool Runner setup (VIP Buyback stubs) ──────────────────────────────────
const toolRegistry = new ToolRegistry();

toolRegistry.register('get_buyback_lead_context', async (_args) => {
  return {
    lead_id: 'lead_abc123',
    customer_name: 'Marcus Johnson',
    vehicle: '2021 Toyota Camry SE',
    mailer_campaign: 'spring_buyback_2026',
    status: 'new',
  };
});

toolRegistry.register('update_lead_status', async (args) => {
  return { updated: true, lead_id: args.lead_id };
});

toolRegistry.register('get_appraisal_slots', async (_args) => {
  return {
    slots: [
      { slot_id: 'slot_fri_10am', date: 'Friday, April 11', time: '10:00 AM', available: true },
      { slot_id: 'slot_fri_2pm', date: 'Friday, April 11', time: '2:00 PM', available: true },
    ],
  };
});

toolRegistry.register('book_appraisal_appointment', async (_args) => {
  return {
    booked: true,
    confirmation: 'VX-' + Date.now().toString().slice(-6),
    date: 'Friday, April 11',
    time: '10:00 AM',
    duration: '15 minutes',
  };
});

toolRegistry.register('save_callback_number', async (args) => {
  return {
    saved: true,
    normalized: '+1' + (args.callback_phone_raw as string || '').replace(/\D/g, ''),
  };
});

toolRegistry.register('transfer_to_vip_desk', async (args) => {
  return { transferred: true, department: 'VIP Desk', reason: args.transfer_reason };
});

toolRegistry.register('log_call_outcome', async (args) => {
  return { logged: true, outcome: args.final_outcome };
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

// Outbound call API.
app.post('/api/outbound', (req, res) => {
  handleOutboundCall(req, res).catch((err) => {
    logger.error('handleOutboundCall error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Internal error' });
  });
});

// Enriched outbound call API (CRM + Calendar context injected into prompt).
app.post('/api/outbound/enriched', (req, res) => {
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

        // 2. Build system prompt
        const systemPrompt = buildSystemPrompt({
          agentName: env.AGENT_NAME,
          companyName: env.COMPANY_NAME,
          customPrompt: textPrompt !== 'default' ? textPrompt : undefined,
          callerPhone: fromNumber,
          currentDateTime: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
        });

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
            let responseBuffer = '';
            await streamChatCompletion(env.OPENAI_API_KEY || '', session.llmMessages, {
              onToken: (token) => {
                responseBuffer += token;
                // Send complete sentences to Rime for synthesis
                const sentences = responseBuffer.match(/[^.!?]+[.!?]+/g);
                if (sentences) {
                  for (const s of sentences) {
                    rimeConn.speak(s.trim());
                  }
                  // Keep any incomplete sentence in buffer
                  const lastDot = responseBuffer.lastIndexOf('.');
                  const lastBang = responseBuffer.lastIndexOf('!');
                  const lastQ = responseBuffer.lastIndexOf('?');
                  const lastPunct = Math.max(lastDot, lastBang, lastQ);
                  if (lastPunct > -1) {
                    responseBuffer = responseBuffer.substring(lastPunct + 1);
                  }
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
                logger.info('Agent said', { callId: callSid, text: fullText });

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

        // 8. Generate AI greeting
        const greetingPrompt = session.llmMessages.slice(); // Copy messages
        streamChatCompletion(env.OPENAI_API_KEY || '', greetingPrompt, {
          onToken: () => {},
          onToolCall: handleToolCall,
          onDone: (greeting) => {
            speakText(greeting);
            session.llmMessages.push({ role: 'assistant', content: greeting });
            logger.info('AI greeting', { callId: callSid, text: greeting });
          },
          onError: () => {
            speakText("Hi, thanks for calling. How can I help you today?");
          },
        }, callSid!).catch((err) => {
          logger.error('Greeting generation error', {
            callId: callSid,
            error: err instanceof Error ? err.message : String(err),
          });
          speakText("Hi, thanks for calling. How can I help you today?");
        });

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
