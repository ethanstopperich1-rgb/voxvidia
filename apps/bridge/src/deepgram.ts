/**
 * Deepgram Nova-3 Streaming STT Client
 *
 * Connects to Deepgram's WebSocket API for real-time speech-to-text.
 * Receives 16kHz linear16 PCM audio, returns transcript text.
 *
 * Config: model=nova-3, endpointing=300ms, interim_results=true,
 *         utterance_end_ms=1000, vad_events=true
 */

import WebSocket from 'ws';
import { createLogger } from '@voxvidia/shared';

const logger = createLogger('bridge:deepgram');

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

export interface DeepgramCallbacks {
  /** Called with transcript text. isFinal=true means end of utterance. */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** Called when Deepgram detects end of an utterance (silence after speech). */
  onUtteranceEnd: () => void;
  /** Called on interim results — useful for barge-in detection. */
  onInterim: (text: string) => void;
  /** Called on error. */
  onError: (err: Error) => void;
  /** Called when connection closes. */
  onClose: () => void;
}

export interface DeepgramConnection {
  /** Send 16kHz linear16 PCM audio bytes. */
  send: (audio: Buffer) => void;
  /** Gracefully close the connection. */
  close: () => void;
  /** Check if connected and ready. */
  isReady: () => boolean;
}

/**
 * Create a streaming connection to Deepgram Nova-3.
 *
 * @param apiKey - Deepgram API key
 * @param callbacks - Event handlers for transcripts
 * @param callId - Call SID for structured logging
 */
export function createDeepgramConnection(
  apiKey: string,
  callbacks: DeepgramCallbacks,
  callId?: string,
): DeepgramConnection {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en-US',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    endpointing: '300',
    interim_results: 'true',
    utterance_end_ms: '1000',
    vad_events: 'true',
    smart_format: 'true',
    punctuate: 'true',
  });

  const url = `${DEEPGRAM_WS_URL}?${params.toString()}`;

  let connected = false;

  logger.info('Connecting to Deepgram Nova-3', { callId });

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Token ${apiKey}`,
    },
  });

  ws.on('open', () => {
    connected = true;
    logger.info('Deepgram connected', { callId });
  });

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString());

      // Transcript result
      if (msg.type === 'Results') {
        const alt = msg.channel?.alternatives?.[0];
        if (!alt) return;

        const transcript = alt.transcript || '';
        const isFinal = msg.is_final === true;
        const speechFinal = msg.speech_final === true;

        if (transcript.length === 0) return;

        if (isFinal && speechFinal) {
          // Complete utterance — caller finished speaking
          callbacks.onTranscript(transcript, true);
          logger.debug('Deepgram final transcript', { callId, text: transcript });
        } else if (isFinal) {
          // Final for this segment but utterance continues
          callbacks.onTranscript(transcript, false);
        } else {
          // Interim result — use for barge-in detection
          callbacks.onInterim(transcript);
        }
      }

      // Utterance end event (silence detected after speech)
      if (msg.type === 'UtteranceEnd') {
        callbacks.onUtteranceEnd();
        logger.debug('Deepgram utterance end', { callId });
      }

      // Speech started event
      if (msg.type === 'SpeechStarted') {
        logger.debug('Deepgram speech started', { callId });
      }

      // Error from Deepgram
      if (msg.type === 'Error') {
        logger.error('Deepgram error', { callId, error: msg });
        callbacks.onError(new Error(msg.description || 'Deepgram error'));
      }
    } catch (err) {
      logger.error('Failed to parse Deepgram message', {
        callId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ws.on('error', (err: Error) => {
    logger.error('Deepgram WebSocket error', { callId, error: err.message });
    callbacks.onError(err);
  });

  ws.on('close', (code: number, reason: Buffer) => {
    connected = false;
    logger.info('Deepgram WebSocket closed', {
      callId,
      code,
      reason: reason.toString(),
    });
    callbacks.onClose();
  });

  return {
    send(audio: Buffer): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(audio);
      }
    },

    close(): void {
      if (ws.readyState === WebSocket.OPEN) {
        // Send empty buffer to signal end of audio
        ws.send(Buffer.alloc(0));
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
  };
}
