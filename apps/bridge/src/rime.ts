/**
 * Rime AI Mist v3 Streaming TTS Client
 *
 * Connects to Rime's WebSocket API for real-time text-to-speech.
 * Sends text chunks, receives mulaw 8kHz audio — directly compatible
 * with Twilio Media Streams (zero transcoding needed).
 *
 * Key features:
 * - <CLEAR> command for barge-in interruption
 * - Sentence-level chunking for optimal latency
 * - mulaw 8kHz output eliminates all audio processing on return path
 */

import WebSocket from 'ws';
import { createLogger } from '@voxvidia/shared';

const logger = createLogger('bridge:rime');

const RIME_WS_BASE = 'wss://users-east-ws.rime.ai/ws';

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
    // Rime sends binary audio frames directly
    if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length > 0) {
        speaking = true;
        callbacks.onAudio(buf);
      }
      return;
    }

    // Rime may also send JSON control messages
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'chunk') {
        // Audio chunk — binary data should have been caught above
        // but some implementations send base64 in JSON
        if (msg.audio) {
          const audioBuf = Buffer.from(msg.audio, 'base64');
          speaking = true;
          callbacks.onAudio(audioBuf);
        }
      }

      if (msg.type === 'done' || msg.type === 'finished') {
        speaking = false;
        callbacks.onDone();
        logger.debug('Rime synthesis done', { callId });
      }

      if (msg.type === 'error') {
        logger.error('Rime error', { callId, error: msg });
        callbacks.onError(new Error(msg.message || 'Rime TTS error'));
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

      // Send text as a JSON message
      ws.send(JSON.stringify({
        text: text,
      }));
    },

    clear(): void {
      if (ws.readyState !== WebSocket.OPEN) return;

      speaking = false;
      // Send clear command to stop current synthesis
      ws.send(JSON.stringify({ type: 'clear' }));
      logger.debug('Rime clear (barge-in)', { callId });
    },

    close(): void {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'call ended');
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
