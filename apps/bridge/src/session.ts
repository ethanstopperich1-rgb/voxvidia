/**
 * Per-call session manager.
 *
 * Tracks all active Twilio <-> PersonaPlex bridge sessions
 * and the metadata associated with each call.
 */

import WebSocket from 'ws';
import { createLogger } from '@voxvidia/shared';
import { TranscriptAccumulator } from './transcript.js';

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

  /** PersonaPlex WebSocket connection */
  personaplexWs: WebSocket | undefined;

  /** Whether the 0x00 handshake byte has been received from PersonaPlex */
  handshakeReceived: boolean;

  /** Accumulates streaming text tokens from PersonaPlex */
  transcript: TranscriptAccumulator;

  /** Database row ID once persisted (null if DB is unavailable) */
  callDbId: string | undefined;

  /** Voice prompt file sent to PersonaPlex */
  voicePrompt: string;

  /** Text prompt sent to PersonaPlex */
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
      personaplexWs: undefined,
      handshakeReceived: false,
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

  /** Tear down a session: close PersonaPlex WS, remove from map. */
  end(callSid: string): void {
    const session = this.sessions.get(callSid);
    if (!session) return;

    if (
      session.personaplexWs &&
      session.personaplexWs.readyState === WebSocket.OPEN
    ) {
      session.personaplexWs.close();
    }

    const duration = Date.now() - session.startedAt.getTime();
    logger.info('Session ended', {
      callId: callSid,
      durationMs: duration,
      utterances: session.transcript.utteranceCount(),
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
