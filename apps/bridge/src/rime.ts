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
    audioFormat: 'mulaw',
    samplingRate: '8000',
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
    // ws3 sends JSON messages, not raw binary
    const raw = data.toString();

    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'chunk') {
        // ws3 sends: {"type": "chunk", "data": "<base64 audio>", "contextId": ...}
        const audioB64 = msg.data || msg.audio;
        if (audioB64) {
          const audioBuf = Buffer.from(audioB64, 'base64');
          if (audioBuf.length > 0) {
            speaking = true;
            callbacks.onAudio(audioBuf);
          }
        }
      }

      if (msg.type === 'done' || msg.type === 'finished') {
        speaking = false;
        callbacks.onDone();
        logger.debug('Rime synthesis done', { callId });
      }

      if (msg.type === 'timestamps') {
        // Word-level timestamps — useful for analytics, ignore for now
      }

      if (msg.type === 'error') {
        logger.error('Rime error', { callId, error: msg });
        callbacks.onError(new Error(msg.message || msg.error || 'Rime TTS error'));
      }
    } catch {
      // Not JSON — likely raw binary audio
      const buf = Buffer.from(data as any);
      if (buf.length > 0) {
        speaking = true;
        callbacks.onAudio(buf);
      }
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

      // ws3 JSON protocol: send text for synthesis
      ws.send(JSON.stringify({ text }));
    },

    /** Force synthesis of any buffered text. Call at end of response. */
    flush(): void {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ operation: 'flush' }));
    },

    clear(): void {
      if (ws.readyState !== WebSocket.OPEN) return;

      speaking = false;
      // ws3 clear operation: cancel current synthesis (barge-in)
      ws.send(JSON.stringify({ operation: 'clear' }));
      logger.debug('Rime clear (barge-in)', { callId });
    },

    close(): void {
      if (ws.readyState === WebSocket.OPEN) {
        // Send end-of-stream before closing
        ws.send(JSON.stringify({ operation: 'eos' }));
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'call ended');
          }
        }, 500);
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
