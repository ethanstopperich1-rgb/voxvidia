/**
 * Voxvidia Bridge Server
 *
 * Twilio Media Streams  <-->  PersonaPlex WebSocket
 *
 * Audio flow (inbound voice):
 *   Twilio (8 kHz mu-law base64) -> decode mu-law -> upsample 8k->24k PCM
 *     -> send to PersonaPlex (raw PCM with 0x10 marker for Opus sidecar)
 *
 * Audio flow (AI response - Phase 2):
 *   PersonaPlex (Opus 24 kHz) -> decode Opus -> downsample 24k->8k
 *     -> encode mu-law -> base64 -> send to Twilio
 *
 * Text flow:
 *   PersonaPlex streams text tokens (0x02) -> accumulated in TranscriptAccumulator
 */

import http from 'node:http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger, env } from '@voxvidia/shared';
import { SessionManager } from './session.js';
import { decodeMulaw, encodeMulaw, resample, pcmToBuffer } from './audio.js';
import { createOpusDecoder } from './opus-decoder.js';
import { connectToPersonaPlex } from './personaplex.js';
import {
  handleIncomingCall,
  handleCallStatus,
  handleRecordingStatus,
  handleOutboundCall,
  handleEnrichedOutboundCall,
  validateTwilioSignature,
} from './twilio.js';
import { SessionPool } from './session-pool.js';
import { Orchestrator, IntentRouter, ToolRunner, ToolRegistry, ConfirmationPolicy } from '@voxvidia/orchestrator';
import { StubCalendarAdapter } from '@voxvidia/orchestrator';
import { StubCrmAdapter } from '@voxvidia/orchestrator';
import { registerCalendarTools, registerCrmTools } from '@voxvidia/orchestrator';
import { logOrchestratorResult } from './personaplex.js';

const logger = createLogger('bridge:server');
const sessions = new SessionManager();
const pool = new SessionPool({ poolSize: 2 });
const opusDecoder = createOpusDecoder();

// ── Orchestrator setup ──────────────────────────────────────────────────────
const calendarAdapter = new StubCalendarAdapter();
const crmAdapter = new StubCrmAdapter();
const toolRegistry = new ToolRegistry();
registerCalendarTools(toolRegistry, calendarAdapter);
registerCrmTools(toolRegistry, crmAdapter);

const orchestrator = new Orchestrator({
  intentRouter: new IntentRouter(),
  toolRunner: new ToolRunner(toolRegistry),
  confirmationPolicy: new ConfirmationPolicy(),
});

// ── Opus decoder → Twilio audio return path ─────────────────────────────────
// When the decoder produces PCM at 24kHz, downsample to 8kHz, encode mulaw,
// and send to ALL active Twilio streams.
opusDecoder.onDecodedPcm((pcm24k: Int16Array) => {
  const pcm8k = resample(pcm24k, 24000, 8000);
  const mulawBuf = encodeMulaw(pcm8k);
  const payload = mulawBuf.toString('base64');

  // Send to all active Twilio WebSocket connections
  for (const [sid, ws] of twilioWsMap.entries()) {
    const session = sessions.getByStreamSid?.(sid) ?? [...sessions.all()].find(s => s.streamSid === sid);
    if (session && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        event: 'media',
        streamSid: sid,
        media: { payload },
      }));
    }
  }
});

// Track Twilio WebSocket per session for audio return.
const twilioWsMap = new Map<string, WebSocket>();

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    activeCalls: sessions.count,
    pool: pool.status(),
    uptime: process.uptime(),
    personaplexTarget: env.PERSONAPLEX_WS_URL,
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
  let callSid: string | null = undefined;

  twilioWs.on('message', (raw: WebSocket.RawData) => {
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

        const voicePrompt =
          startData.customParameters?.voice || env.DEFAULT_VOICE;
        const textPrompt =
          startData.customParameters?.prompt || env.DEFAULT_PROMPT;

        logger.info('Media stream started', {
          callId: callSid,
          streamSid,
          voicePrompt,
        });

        // Create session.
        const session = sessions.create(
          callSid,
          startData.customParameters?.from || 'unknown',
          startData.customParameters?.to || 'unknown',
          voicePrompt,
          textPrompt,
        );
        session.streamSid = streamSid;
        twilioWsMap.set(streamSid, twilioWs);

        // Try to acquire a pre-warmed session from the pool first.
        const warmSession = pool.acquire();
        if (warmSession) {
          logger.info('Using pre-warmed PersonaPlex session', {
            callId: callSid,
            sessionId: warmSession.id,
          });
          session.personaplexWs = warmSession.ws;
          session.handshakeReceived = true; // Already handshaked

          // Wire up message handler on the warm session's WS
          warmSession.ws.removeAllListeners('message');
          warmSession.ws.on('message', (data: WebSocket.RawData) => {
            let buf: Buffer;
            if (Buffer.isBuffer(data)) buf = data;
            else if (data instanceof ArrayBuffer) buf = Buffer.from(data);
            else if (Array.isArray(data)) buf = Buffer.concat(data);
            else return;
            if (buf.length === 0) return;
            const kind = buf[0];
            if (kind === 0x01) {
              // Audio from PersonaPlex — decode Opus, downsample, encode mulaw, send to Twilio
              const opusData = buf.subarray(1);
              if (opusDecoder.isRunning && session.streamSid) {
                opusDecoder.decode(opusData);
              }
            }
            if (kind === 0x02) {
              const text = buf.subarray(1).toString('utf8');
              session.transcript.onToken(text);
              logger.debug('PersonaPlex text token', { callId: callSid, text });
            }
          });
          warmSession.ws.on('close', () => {
            session.handshakeReceived = false;
            logger.info('PersonaPlex warm session closed', { callId: callSid });
          });
          warmSession.ws.on('error', (err: Error) => {
            logger.error('PersonaPlex warm session error', { callId: callSid, error: err.message });
          });

          // Wire orchestrator to process completed utterances.
          session.transcript.setOnUtterance(async (utterance: string) => {
            try {
              const result = await orchestrator.processUtterance(callSid, utterance);
              if (result.action === 'speak' || result.action === 'confirm') {
                logOrchestratorResult(callSid, result.text!);
              }
            } catch (err) {
              logger.error('Orchestrator error', {
                callId: callSid,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          });
          break;
        }

        // No warm session available — cold start (fallback).
        logger.info('No warm session available, cold-starting PersonaPlex', { callId: callSid });
        const ppConn = connectToPersonaPlex(
          voicePrompt,
          textPrompt,
          {
            onHandshake: () => {
              session.handshakeReceived = true;
              logger.info('PersonaPlex ready for audio (cold start)', { callId: callSid });
            },

            onAudio: (opusData: Buffer) => {
              // Decode Opus, downsample 24k->8k, encode mulaw, send to Twilio
              if (opusDecoder.isRunning && session.streamSid) {
                opusDecoder.decode(opusData);
              }
            },

            onText: (text: string) => {
              session.transcript.onToken(text);
              logger.debug('PersonaPlex text token', {
                callId: callSid,
                text,
              });
            },

            onClose: () => {
              session.handshakeReceived = false;
              logger.info('PersonaPlex connection closed', {
                callId: callSid,
              });
            },

            onError: (err: Error) => {
              logger.error('PersonaPlex connection error', {
                callId: callSid,
                error: err.message,
              });
            },
          },
          callSid,
        );

        session.personaplexWs = ppConn.ws;

        // Wire orchestrator to process completed utterances.
        session.transcript.setOnUtterance(async (utterance: string) => {
          try {
            const result = await orchestrator.processUtterance(callSid, utterance);
            if (result.action === 'speak' || result.action === 'confirm') {
              logOrchestratorResult(callSid, result.text!);
            }
          } catch (err) {
            logger.error('Orchestrator error', {
              callId: callSid,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
        break;
      }

      // ── Media (audio) ───────────────────────────────────────────────────
      case 'media': {
        if (!callSid) return;
        const session = sessions.get(callSid);
        if (
          !session ||
          !session.personaplexWs ||
          session.personaplexWs.readyState !== WebSocket.OPEN ||
          !session.handshakeReceived
        ) {
          return;
        }

        const payload = msg.media!.payload;

        // Decode base64 mu-law from Twilio.
        const mulawBytes = Buffer.from(payload, 'base64');

        // Mu-law -> 16-bit signed PCM at 8 kHz.
        const pcm8k = decodeMulaw(mulawBytes);

        // Upsample 8 kHz -> 24 kHz (PersonaPlex native rate).
        const pcm24k = resample(pcm8k, 8000, 24000);

        // Convert PCM Int16Array to a byte buffer (little-endian).
        const pcmBuffer = pcmToBuffer(pcm24k);

        // Send raw PCM with the 0x10 custom marker.
        // The Python Opus sidecar (or PersonaPlex directly) handles encoding.
        const frame = Buffer.alloc(1 + pcmBuffer.length);
        frame[0] = 0x10; // PP_RAW_PCM
        pcmBuffer.copy(frame, 1);
        session.personaplexWs.send(frame);

        break;
      }

      // ── Stream stop ─────────────────────────────────────────────────────
      case 'stop': {
        logger.info('Media stream stopped', { callId: callSid });

        if (callSid) {
          const session = sessions.get(callSid);
          if (session?.streamSid) {
            twilioWsMap.delete(session.streamSid);
          }
          if (session) {
            // Flush any remaining transcript text.
            session.transcript.flush();
            const fullTranscript = session.transcript.getFullTranscript();
            if (fullTranscript.length > 0) {
              logger.info('Final transcript', {
                callId: callSid,
                transcript: fullTranscript,
              });
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
  logger.info(`Twilio-PersonaPlex bridge running on port ${PORT}`);
  logger.info(`PersonaPlex target: ${env.PERSONAPLEX_WS_URL}`);

  // Start pre-warming PersonaPlex sessions.
  pool.start().catch((err) => {
    logger.error('Failed to start session pool', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
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

  // Shut down session pool and opus decoder.
  pool.shutdown();
  opusDecoder.stop();

  // Close all active PersonaPlex connections.
  for (const session of sessions.all()) {
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
