/**
 * Streaming text-token accumulator.
 *
 * Buffers streaming text into complete utterances.
 * Used to accumulate Deepgram transcripts before sending to the LLM.
 */

export interface Utterance {
  text: string;
  timestamp: number;
}

export class TranscriptAccumulator {
  private buffer = '';
  private utterances: Utterance[] = [];
  private lastTokenTimestamp = 0;
  private onUtteranceCb?: (text: string) => void;

  /** Silence threshold in ms — if no token arrives for this long, auto-flush. */
  private static readonly SILENCE_THRESHOLD_MS = 1500;

  constructor(opts?: { onUtterance?: (text: string) => void }) {
    this.onUtteranceCb = opts?.onUtterance;
  }

  /** Set or replace the utterance callback (allows wiring after construction). */
  setOnUtterance(cb: (text: string) => void): void {
    this.onUtteranceCb = cb;
  }

  /**
   * Append a text token to the buffer.
   * Auto-flushes if enough silence has elapsed since the last token.
   */
  onToken(text: string): void {
    const now = Date.now();

    // If enough silence has passed since the last token, flush first.
    if (
      this.buffer.length > 0 &&
      this.lastTokenTimestamp > 0 &&
      now - this.lastTokenTimestamp > TranscriptAccumulator.SILENCE_THRESHOLD_MS
    ) {
      this.flush();
    }

    this.buffer += text;
    this.lastTokenTimestamp = now;
  }

  /**
   * Force-flush the buffer into a completed utterance.
   * Call this on silence detection, session end, or periodically.
   */
  flush(): void {
    const trimmed = this.buffer.trim();
    if (trimmed.length === 0) return;

    this.utterances.push({
      text: trimmed,
      timestamp: this.lastTokenTimestamp || Date.now(),
    });

    this.buffer = '';

    // Notify listener of completed utterance.
    if (this.onUtteranceCb) {
      this.onUtteranceCb(trimmed);
    }
  }

  /** Return the full transcript (all flushed utterances joined). */
  getFullTranscript(): string {
    // Include any unflushed buffer content.
    const pending = this.buffer.trim();
    const parts = this.utterances.map((u) => u.text);
    if (pending.length > 0) parts.push(pending);
    return parts.join(' ');
  }

  /** Return the most recent completed utterance, or null if none. */
  getLastUtterance(): Utterance | null {
    if (this.utterances.length === 0) return null;
    return this.utterances[this.utterances.length - 1];
  }

  /** Return all completed utterances. */
  getAllUtterances(): Utterance[] {
    return [...this.utterances];
  }

  /** Number of completed utterances. */
  utteranceCount(): number {
    return this.utterances.length;
  }

  /** Current unflushed buffer content. */
  getPendingText(): string {
    return this.buffer;
  }
}
