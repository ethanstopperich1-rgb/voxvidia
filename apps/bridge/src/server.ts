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
import { Orchestrator, IntentRouter, ToolRunner, ToolRegistry, ConfirmationPolicy } from '@voxvidia/orchestrator';
import { StubCalendarAdapter } from '@voxvidia/orchestrator';
import { StubCrmAdapter } from '@voxvidia/orchestrator';
import { registerCalendarTools, registerCrmTools } from '@voxvidia/orchestrator';

const logger = createLogger('bridge:server');
const sessions = new SessionManager();

// ── Orchestrator + Tool Runner setup ────────────────────────────────────────
const calendarAdapter = new StubCalendarAdapter();
const crmAdapter = new StubCrmAdapter();
const toolRegistry = new ToolRegistry();
registerCalendarTools(toolRegistry, calendarAdapter);
registerCrmTools(toolRegistry, crmAdapter);

const toolRunner = new ToolRunner(toolRegistry);

const orchestrator = new Orchestrator({
  intentRouter: new IntentRouter(),
  toolRunner,
  confirmationPolicy: new ConfirmationPolicy(),
});

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
          onAudio: (audioBuffer) => {
            // Rime ws3 may return PCM (not mulaw) — convert if needed.
            // PCM from Rime is typically 22050Hz int16 LE.
            // Twilio needs 8000Hz mulaw.
            let mulawPayload: string;
            try {
              // Try to detect if this is PCM (will be larger than mulaw for same duration)
              // PCM 22050Hz: ~44100 bytes/sec. Mulaw 8000Hz: ~8000 bytes/sec
              // If buffer is much larger than expected for mulaw, it's likely PCM
              const pcm = bufferToPcm(audioBuffer);
              const pcm8k = resample(pcm, 22050, 8000);
              const mulaw = encodeMulaw(pcm8k);
              mulawPayload = mulaw.toString('base64');
            } catch {
              // If conversion fails, try sending as-is (might already be mulaw)
              mulawPayload = audioBuffer.toString('base64');
            }

            if (twilioWs.readyState === WebSocket.OPEN && session.streamSid) {
              twilioWs.send(JSON.stringify({
                event: 'media',
                streamSid: session.streamSid,
                media: { payload: mulawPayload },
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

        // 6. Function to handle LLM tool calls
        const handleToolCall = async (toolCall: ToolCall) => {
          const toolName = toolCall.function.name;
          const filler = getFillerPhrase(toolName);

          // Speak filler phrase while tool executes
          speakText(filler);

          let args: Record<string, any>;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            args = {};
          }

          // Execute tool via orchestrator
          try {
            const result = await toolRunner.runTool(toolName, args);

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
              },
              onError: (err) => {
                logger.error('LLM error after tool', { callId: callSid, error: err.message });
              },
            }, callSid!);
          } catch (err) {
            logger.error('Tool execution error', {
              callId: callSid,
              tool: toolName,
              error: err instanceof Error ? err.message : String(err),
            });
            speakText("I'm sorry, I'm having a little trouble with that. Let me connect you with our team.");
          }
        };

        // 7. Connect to Deepgram STT
        const deepgramConn = createDeepgramConnection(env.DEEPGRAM_API_KEY || '', {
          onTranscript: async (text, isFinal) => {
            if (!isFinal) return;

            session.transcript.onToken(text);
            logger.info('Caller said', { callId: callSid, text });

            // Add caller message to conversation
            session.llmMessages.push({ role: 'user', content: text });

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
              },
              onError: (err) => {
                logger.error('LLM error', { callId: callSid, error: err.message });
                speakText("I'm sorry, could you say that again?");
              },
            }, callSid!);
          },
          onInterim: (text) => {
            // Barge-in detection: caller is speaking while AI is talking
            if (session.rimeIsSpeaking && text.length > 3) {
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

        // Wire orchestrator to process completed utterances.
        session.transcript.setOnUtterance(async (utterance: string) => {
          try {
            const result = await orchestrator.processUtterance(callSid!, utterance);
            if (result.action === 'speak' || result.action === 'confirm') {
              // In the new pipeline, orchestrator results are informational.
              // The LLM handles actual response generation via tool calls.
              logger.debug('Orchestrator result', { callId: callSid, action: result.action, text: result.text });
            }
          } catch (err) {
            logger.error('Orchestrator error', {
              callId: callSid,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });

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
          sessions.end(callSid);

          // Clean up orchestrator per-call state.
          orchestrator.endCall(callSid);

          // Trigger post-call analysis asynchronously.
          import('@voxvidia/workers').then(({ processPostCall }) => {
            processPostCall(callSid).catch((err) => {
              logger.error('Post-call worker error', {
                callId: callSid,
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }).catch(() => {
            logger.warn('Workers package not available, skipping post-call analysis', { callId: callSid });
          });
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
