/**
 * PersonaPlex Session Pool
 *
 * Keeps pre-warmed WebSocket connections to PersonaPlex so incoming calls
 * get an already-initialized session instead of waiting 20-30s for cold start.
 *
 * Pool behavior:
 *   - On startup, creates `poolSize` connections with the default voice/prompt
 *   - Each connection goes through the full handshake + system prompt processing
 *   - When a call comes in, `acquire()` returns a warm, ready connection
 *   - After acquiring, a new replacement connection starts warming in the background
 *   - If no warm sessions available, falls back to cold-start (same as before)
 */

import WebSocket from 'ws';
import { createLogger, env } from '@voxvidia/shared';

const logger = createLogger('bridge:pool');

export interface WarmSession {
  id: string;
  ws: WebSocket;
  ready: boolean;
  createdAt: number;
  voicePrompt: string;
  textPrompt: string;
}

export class SessionPool {
  private pool: WarmSession[] = [];
  private warming: number = 0;
  private poolSize: number;
  private voicePrompt: string;
  private textPrompt: string;
  private idCounter: number = 0;

  constructor(opts?: { poolSize?: number; voicePrompt?: string; textPrompt?: string }) {
    this.poolSize = opts?.poolSize ?? 2;
    this.voicePrompt = opts?.voicePrompt ?? env.DEFAULT_VOICE;
    this.textPrompt = opts?.textPrompt ?? env.DEFAULT_PROMPT;
  }

  /**
   * Start the pool — creates initial warm sessions.
   * Call this once on server startup.
   */
  async start(): Promise<void> {
    logger.info('Starting session pool', {
      poolSize: this.poolSize,
      voicePrompt: this.voicePrompt,
    });

    for (let i = 0; i < this.poolSize; i++) {
      this.warmOne();
    }
  }

  /**
   * Acquire a warm, ready session for an incoming call.
   * Returns null if no warm sessions are available (caller should cold-start).
   */
  acquire(): WarmSession | null {
    const readyIndex = this.pool.findIndex(s => s.ready && s.ws.readyState === WebSocket.OPEN);

    if (readyIndex === -1) {
      logger.warn('No warm sessions available', {
        poolTotal: this.pool.length,
        warming: this.warming,
      });
      return null;
    }

    const session = this.pool.splice(readyIndex, 1)[0];
    logger.info('Acquired warm session', {
      sessionId: session.id,
      warmupDuration: Date.now() - session.createdAt,
      remainingPool: this.pool.length,
    });

    // Backfill: start warming a replacement
    this.warmOne();

    return session;
  }

  /**
   * Return a session to the pool (e.g., if the call was abandoned before using it).
   */
  release(session: WarmSession): void {
    if (session.ws.readyState === WebSocket.OPEN) {
      this.pool.push(session);
      logger.info('Session returned to pool', { sessionId: session.id });
    }
  }

  /**
   * Get pool status for health checks.
   */
  status(): { ready: number; warming: number; total: number } {
    const ready = this.pool.filter(s => s.ready && s.ws.readyState === WebSocket.OPEN).length;
    return { ready, warming: this.warming, total: this.pool.length };
  }

  /**
   * Shut down the pool — close all connections.
   */
  shutdown(): void {
    logger.info('Shutting down session pool');
    for (const session of this.pool) {
      if (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING) {
        session.ws.close(1000, 'pool shutdown');
      }
    }
    this.pool = [];
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private warmOne(): void {
    if (this.warming + this.pool.length >= this.poolSize) return;

    this.warming++;
    const id = `warm-${++this.idCounter}`;
    const baseUrl = env.PERSONAPLEX_WS_URL;
    const url = `${baseUrl}?voice_prompt=${encodeURIComponent(this.voicePrompt)}&text_prompt=${encodeURIComponent(this.textPrompt)}`;

    logger.info('Warming new session', { sessionId: id, url: baseUrl });
    const startTime = Date.now();

    const ws = new WebSocket(url);

    const session: WarmSession = {
      id,
      ws,
      ready: false,
      createdAt: Date.now(),
      voicePrompt: this.voicePrompt,
      textPrompt: this.textPrompt,
    };

    ws.on('open', () => {
      logger.info('Warm session WebSocket open', { sessionId: id });
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
        return;
      }

      if (buf.length === 0) return;

      // We only care about the handshake (0x00) during warmup.
      // Once handshake is received, the session is ready.
      if (buf[0] === 0x00 && !session.ready) {
        session.ready = true;
        this.warming--;
        this.pool.push(session);
        const warmupMs = Date.now() - startTime;
        logger.info('Warm session READY', {
          sessionId: id,
          warmupMs,
          poolSize: this.pool.length,
        });
      }

      // Discard any audio/text during warmup — nobody is listening
    });

    ws.on('error', (err: Error) => {
      logger.error('Warm session error', { sessionId: id, error: err.message });
      this.warming--;
      // Try again after a delay
      setTimeout(() => this.warmOne(), 5000);
    });

    ws.on('close', () => {
      // If session was in the pool (not acquired), remove it
      const idx = this.pool.indexOf(session);
      if (idx !== -1) {
        this.pool.splice(idx, 1);
        logger.warn('Warm session closed unexpectedly, replacing', { sessionId: id });
        this.warmOne();
      }
      if (!session.ready) {
        this.warming--;
      }
    });

    // Timeout: if handshake doesn't arrive in 60s, discard and retry
    setTimeout(() => {
      if (!session.ready) {
        logger.warn('Warm session timed out waiting for handshake', { sessionId: id });
        ws.close();
        this.warming--;
        setTimeout(() => this.warmOne(), 2000);
      }
    }, 60000);
  }
}
