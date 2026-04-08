/**
 * Rime AI Mist v3 Streaming TTS Client (ws3 JSON protocol)
 *
 * Connects to Rime's ws3 WebSocket endpoint for real-time text-to-speech.
 * Uses the JSON protocol with operations: text, flush, clear, eos.
 *
 * Protocol:
 *   Send: {"text": "..."} — queue text for synthesis
 *   Send: {"operation": "flush"} — force synthesis of buffered text
 *   Send: {"operation": "clear"} — cancel current synthesis (barge-in)
 *   Send: {"operation": "eos"} — end of stream
 *   Recv: {"type": "chunk", "data": "<base64 audio>"} — audio data
 *   Recv: {"type": "done"} — synthesis complete
 *
 * Audio: mulaw 8kHz output — directly compatible with Twilio (zero transcoding)
 */

import WebSocket from 'ws';
import { createLogger } from '@voxvidia/shared';
import { encodeMulaw, resample, bufferToPcm } from './audio.js';

const logger = createLogger('bridge:rime');

const RIME_WS_BASE = 'wss://users-ws.rime.ai/ws3';

export interface RimeCallbacks {
  /** Called with mulaw audio bytes — send directly to Twilio. */
  onAudio: (mulawBuffer: Buffer) => void;
  /** Called when TTS finishes speaking the current text. */
  onDone: () => void;
  /** Called on error. */
  onError: (err: Error) => void;
  /** Called when connection closes. */
  onClose: () => void;
}

export interface RimeConnection {
  /** Send text to be spoken. Rime synthesizes and streams audio back. */
  speak: (text: string) => void;
  /** Force synthesis of any buffered text. Call at end of a response. */
  flush: () => void;
  /** Clear the current synthesis — use for barge-in interruption. */
  clear: () => void;
  /** Close the connection. */
  close: () => void;
  /** Check if connected and ready. */
  isReady: () => boolean;
  /** Track whether audio is currently being sent (TTS is "speaking"). */
  isSpeaking: boolean;
}

/**
 * Create a streaming connection to Rime Mist v3.
 *
 * @param apiKey - Rime API key
 * @param voice - Speaker ID (e.g., 'cove', 'abbie')
 * @param callbacks - Event handlers for audio data
 * @param callId - Call SID for structured logging
 */
export function createRimeConnection(
  apiKey: string,
  voice: string,
  callbacks: RimeCallbacks,
  callId?: string,
): RimeConnection {
  const params = new URLSearchParams({
    speaker: voice,
    modelId: 'mistv3',
    audioFormat: 'pcm',
    samplingRate: '22050',
  });

  const url = `${RIME_WS_BASE}?${params.toString()}`;

  let connected = false;
  let speaking = false;

  logger.info('Connecting to Rime Mist v3', { callId, voice });

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  ws.on('open', () => {
    connected = true;
    logger.info('Rime connected', { callId, voice });
  });

  ws.on('message', (data: WebSocket.RawData) => {
    // ws3 sends BINARY frames for audio, TEXT frames for control
    let buf: Buffer | null = null;
    if (Buffer.isBuffer(data)) buf = data;
    else if (data instanceof ArrayBuffer) buf = Buffer.from(data);
    else if (Array.isArray(data)) buf = Buffer.concat(data);

    // Binary frame with substantial data = raw PCM int16 at 22050Hz
    if (buf !== null && buf.length > 100) {
      try {
        const pcm22k = bufferToPcm(buf);
        const pcm8k = resample(pcm22k, 22050, 8000);
        const mulaw = encodeMulaw(pcm8k);
        speaking = true;
        callbacks.onAudio(mulaw);
      } catch (_e) {
        // conversion error — skip this chunk
      }
      return;
    }

    // Text or small buffer = JSON control message
    try {
      const raw = typeof data === 'string' ? data : data.toString();
      const msg = JSON.parse(raw);
      if (msg.type === 'chunk' && msg.data) {
        // JSON-wrapped base64 audio (fallback)
        const pcmBytes = Buffer.from(msg.data, 'base64');
        const pcm22k = bufferToPcm(pcmBytes);
        const pcm8k = resample(pcm22k, 22050, 8000);
        const mulaw = encodeMulaw(pcm8k);
        speaking = true;
        callbacks.onAudio(mulaw);
      } else if (msg.type === 'done' || msg.type === 'finished') {
        speaking = false;
        callbacks.onDone();
        logger.debug('Rime synthesis done', { callId });
      } else if (msg.type === 'error') {
        callbacks.onError(new Error(msg.message || 'Rime error'));
      }
    } catch (_e) {
      // Not JSON, small binary — ignore
    }
  });

  ws.on('error', (err: Error) => {
    logger.error('Rime WebSocket error', { callId, error: err.message });
    callbacks.onError(err);
  });

  ws.on('close', (code: number, reason: Buffer) => {
    connected = false;
    speaking = false;
    logger.info('Rime WebSocket closed', {
      callId,
      code,
      reason: reason.toString(),
    });
    callbacks.onClose();
  });

  const connection: RimeConnection = {
    speak(text: string): void {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (text.trim().length === 0) return;

      logger.debug('Rime speak', { callId, text: text.substring(0, 80) });

      ws.send(JSON.stringify({ text }));
    },

    flush(): void {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ operation: 'flush' }));
    },

    clear(): void {
      if (ws.readyState !== WebSocket.OPEN) return;
      speaking = false;
      ws.send(JSON.stringify({ operation: 'clear' }));
      logger.debug('Rime clear (barge-in)', { callId });
    },

    close(): void {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ operation: 'eos' })); } catch (_e) { /* */ }
        setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.close(1000); }, 300);
      }
    },

    isReady(): boolean {
      return connected && ws.readyState === WebSocket.OPEN;
    },

    get isSpeaking(): boolean {
      return speaking;
    },
    set isSpeaking(val: boolean) {
      speaking = val;
    },
  };

  return connection;
}

/**
 * Split text into sentence-level chunks for optimal TTS latency.
 * Rime synthesizes best with 50-140 character chunks ending at
 * natural boundaries (periods, commas, question marks).
 */
export function chunkTextForTTS(text: string): string[] {
  const chunks: string[] = [];
  // Split on sentence-ending punctuation, keeping the punctuation
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.length <= 140) {
      chunks.push(trimmed);
    } else {
      // Split long sentences on commas or semicolons
      const parts = trimmed.match(/[^,;]+[,;]?/g) || [trimmed];
      let current = '';
      for (const part of parts) {
        if ((current + part).length > 140 && current.length > 0) {
          chunks.push(current.trim());
          current = part;
        } else {
          current += part;
        }
      }
      if (current.trim().length > 0) {
        chunks.push(current.trim());
      }
    }
  }

  return chunks;
}
