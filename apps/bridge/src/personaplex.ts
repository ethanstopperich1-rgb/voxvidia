/**
 * PersonaPlex WebSocket client wrapper.
 *
 * Protocol:
 *   Connect to ws://host:8998/api/chat?voice_prompt=...&text_prompt=...
 *   Server sends 0x00 byte              -> handshake (ready)
 *   Client sends 0x01 + opus audio data -> voice input
 *   Server sends 0x01 + opus audio data -> voice response
 *   Server sends 0x02 + utf8 text       -> streaming text tokens
 */

import WebSocket from 'ws';
import { createLogger, env } from '@voxvidia/shared';

const logger = createLogger('bridge:personaplex');

// ── PersonaPlex protocol byte markers ─────────────────────────────────────────

export const PP_HANDSHAKE = 0x00;
export const PP_AUDIO = 0x01;
export const PP_TEXT = 0x02;

// Custom marker: raw PCM from Twilio needing Opus encoding (sent to sidecar)
export const PP_RAW_PCM = 0x10;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PersonaPlexCallbacks {
  onHandshake: () => void;
  onAudio: (opusData: Buffer) => void;
  onText: (text: string) => void;
  onClose: () => void;
  onError: (err: Error) => void;
}

export interface PersonaPlexConnection {
  ws: WebSocket;
  sendAudio: (data: Buffer) => void;
  sendRawPcm: (pcmBuffer: Buffer) => void;
  close: () => void;
  isReady: () => boolean;
}

// ── Connection factory ────────────────────────────────────────────────────────

/**
 * Connect to a PersonaPlex instance.
 *
 * @param voicePrompt  - Voice checkpoint file (e.g. "NATF2.pt")
 * @param textPrompt   - System prompt for the persona
 * @param callbacks    - Event handlers for protocol messages
 * @param callId       - Twilio Call SID for structured logging
 * @returns Connection handle with send helpers
 */
export function connectToPersonaPlex(
  voicePrompt: string,
  textPrompt: string,
  callbacks: PersonaPlexCallbacks,
  callId?: string,
): PersonaPlexConnection {
  const baseUrl = env.PERSONAPLEX_WS_URL;
  const url = `${baseUrl}?voice_prompt=${encodeURIComponent(voicePrompt)}&text_prompt=${encodeURIComponent(textPrompt)}`;

  let handshakeReceived = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;
  const RECONNECT_DELAY_MS = 2000;

  logger.info('Connecting to PersonaPlex', {
    callId,
    url: baseUrl,
    voicePrompt,
  });

  const ws = new WebSocket(url);

  ws.on('open', () => {
    reconnectAttempts = 0;
    logger.info('PersonaPlex WebSocket open', { callId });
  });

  ws.on('message', (data: WebSocket.RawData) => {
    let buf: Buffer;
    if (Buffer.isBuffer(data)) {
      buf = data;
    } else if (data instanceof ArrayBuffer) {
      buf = Buffer.from(data);
    } else if (Array.isArray(data)) {
      buf = Buffer.concat(data);
    } else {
      logger.warn('Unexpected WebSocket data type', { callId });
      return;
    }

    if (buf.length === 0) return;

    const kind = buf[0];

    if (kind === PP_HANDSHAKE) {
      handshakeReceived = true;
      logger.info('PersonaPlex handshake received, streaming active', {
        callId,
      });
      callbacks.onHandshake();
      return;
    }

    if (kind === PP_AUDIO && handshakeReceived) {
      // Opus-encoded audio payload after the kind byte.
      callbacks.onAudio(buf.subarray(1));
      return;
    }

    if (kind === PP_TEXT) {
      const text = buf.subarray(1).toString('utf8');
      callbacks.onText(text);
      return;
    }

    logger.warn('Unknown PersonaPlex message kind', {
      callId,
      kind: `0x${kind.toString(16).padStart(2, '0')}`,
      length: buf.length,
    });
  });

  ws.on('error', (err: Error) => {
    logger.error('PersonaPlex WebSocket error', {
      callId,
      error: err.message,
    });
    callbacks.onError(err);
  });

  ws.on('close', (code: number, reason: Buffer) => {
    handshakeReceived = false;
    logger.info('PersonaPlex WebSocket closed', {
      callId,
      code,
      reason: reason.toString('utf8'),
    });
    callbacks.onClose();

    // Attempt reconnection for unexpected closures.
    if (
      code !== 1000 &&
      code !== 1001 &&
      reconnectAttempts < MAX_RECONNECT_ATTEMPTS
    ) {
      reconnectAttempts++;
      logger.warn('Scheduling PersonaPlex reconnect', {
        callId,
        attempt: reconnectAttempts,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      });
      // Note: reconnection creates a new WS but the caller holds the
      // original handle. For a full reconnect the session layer should
      // re-establish the connection. This is logged for observability.
    }
  });

  // ── Send helpers ──────────────────────────────────────────────────────────

  const sendAudio = (opusData: Buffer): void => {
    if (ws.readyState !== WebSocket.OPEN || !handshakeReceived) return;
    const frame = Buffer.alloc(1 + opusData.length);
    frame[0] = PP_AUDIO;
    opusData.copy(frame, 1);
    ws.send(frame);
  };

  /**
   * Send raw PCM (16-bit LE) with the custom 0x10 marker.
   * Used when a Python sidecar handles Opus encoding.
   */
  const sendRawPcm = (pcmBuffer: Buffer): void => {
    if (ws.readyState !== WebSocket.OPEN || !handshakeReceived) return;
    const frame = Buffer.alloc(1 + pcmBuffer.length);
    frame[0] = PP_RAW_PCM;
    pcmBuffer.copy(frame, 1);
    ws.send(frame);
  };

  const close = (): void => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, 'bridge session ended');
    }
  };

  const isReady = (): boolean => {
    return ws.readyState === WebSocket.OPEN && handshakeReceived;
  };

  return { ws, sendAudio, sendRawPcm, close, isReady };
}

/**
 * Log orchestrator context for observability.
 * PersonaPlex doesn't support mid-session text injection via WebSocket.
 * Tool results are logged and will be used in post-call analysis.
 * For real-time tool result delivery, a future version could use
 * TTS to speak the result directly to Twilio while PersonaPlex continues.
 */
export function logOrchestratorResult(callId: string, text: string): void {
  logger.info('Orchestrator result', { callId, text });
}
