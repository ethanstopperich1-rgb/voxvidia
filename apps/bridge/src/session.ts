/**
 * Per-call session manager.
 *
 * Tracks all active Twilio <-> AI pipeline bridge sessions
 * and the metadata associated with each call.
 *
 * Pipeline: Deepgram STT -> GPT-4.1 mini -> Rime TTS
 */

import { createLogger } from '@voxvidia/shared';
import { TranscriptAccumulator } from './transcript.js';
import type { DeepgramConnection } from './deepgram.js';
import type { RimeConnection } from './rime.js';
import type { ChatMessage } from './llm.js';

const logger = createLogger('bridge:session');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CallSession {
  /** Twilio Call SID */
  callSid: string;

  /** Twilio Stream SID (set when media-stream "start" arrives) */
  streamSid: string | undefined;

  /** Caller number (E.164) */
  fromNumber: string;

  /** Destination number (E.164) */
  toNumber: string;

  /** When the session object was created */
  startedAt: Date;

  /** Deepgram STT streaming connection */
  deepgramConn: DeepgramConnection | undefined;

  /** Rime TTS streaming connection */
  rimeConn: RimeConnection | undefined;

  /** Conversation messages for GPT-4.1 mini (system + user + assistant + tool) */
  llmMessages: ChatMessage[];

  /** Whether Rime is currently synthesizing/sending audio */
  rimeIsSpeaking: boolean;

  /** CRM contact ID once resolved (via lookup_contact tool) */
  contactId: string | undefined;

  /** Accumulates streaming text tokens into utterances */
  transcript: TranscriptAccumulator;

  /** Database row ID once persisted (null if DB is unavailable) */
  callDbId: string | undefined;

  /** Voice prompt / speaker ID for Rime TTS */
  voicePrompt: string;

  /** Text prompt / system instructions for GPT-4.1 mini */
  textPrompt: string;
}

// ── Session Manager ───────────────────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, CallSession>();

  /**
   * Create a new call session keyed by callSid.
   * Returns the created session.
   */
  create(
    callSid: string,
    fromNumber: string,
    toNumber: string,
    voicePrompt: string,
    textPrompt: string,
  ): CallSession {
    if (this.sessions.has(callSid)) {
      logger.warn('Session already exists, replacing', { callId: callSid });
      this.end(callSid);
    }

    const session: CallSession = {
      callSid,
      streamSid: undefined,
      fromNumber,
      toNumber,
      startedAt: new Date(),
      deepgramConn: undefined,
      rimeConn: undefined,
      llmMessages: [],
      rimeIsSpeaking: false,
      contactId: undefined,
      transcript: new TranscriptAccumulator(),
      callDbId: undefined,
      voicePrompt,
      textPrompt,
    };

    this.sessions.set(callSid, session);
    logger.info('Session created', {
      callId: callSid,
      from: fromNumber,
      to: toNumber,
    });

    return session;
  }

  /** Retrieve a session by Twilio Call SID. */
  get(callSid: string): CallSession | undefined {
    return this.sessions.get(callSid);
  }

  /** Find a session by its Twilio Stream SID. */
  getByStreamSid(streamSid: string): CallSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.streamSid === streamSid) return session;
    }
    return undefined;
  }

  /** Tear down a session: close Deepgram + Rime connections, remove from map. */
  end(callSid: string): void {
    const session = this.sessions.get(callSid);
    if (!session) return;

    // Close Deepgram STT connection
    if (session.deepgramConn) {
      try {
        session.deepgramConn.close();
      } catch (err) {
        logger.warn('Error closing Deepgram connection', {
          callId: callSid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Close Rime TTS connection
    if (session.rimeConn) {
      try {
        session.rimeConn.close();
      } catch (err) {
        logger.warn('Error closing Rime connection', {
          callId: callSid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const duration = Date.now() - session.startedAt.getTime();
    logger.info('Session ended', {
      callId: callSid,
      durationMs: duration,
      utterances: session.transcript.utteranceCount(),
      llmTurns: session.llmMessages.filter(m => m.role === 'assistant').length,
    });

    this.sessions.delete(callSid);
  }

  /** Return all active sessions. */
  all(): CallSession[] {
    return Array.from(this.sessions.values());
  }

  /** Number of active sessions. */
  get count(): number {
    return this.sessions.size;
  }
}
