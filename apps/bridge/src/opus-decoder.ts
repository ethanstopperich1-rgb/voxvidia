/**
 * Opus decoder via Python sidecar process.
 *
 * PersonaPlex sends Opus-encoded audio at 24kHz. Node.js doesn't have
 * a reliable native Opus decoder for streaming, so we spawn a lightweight
 * Python child process that uses the `sphn` library (same as PersonaPlex)
 * to decode Opus frames into raw PCM.
 *
 * Protocol (stdin/stdout, binary):
 *   Bridge → Python:  4-byte LE length prefix + Opus bytes
 *   Python → Bridge:  4-byte LE length prefix + PCM int16 LE bytes
 */

import { ChildProcess, spawn } from 'node:child_process';
import { createLogger } from '@voxvidia/shared';

const logger = createLogger('bridge:opus');

const PYTHON_SCRIPT = `
import sys, struct, sphn

sample_rate = 24000
reader = sphn.OpusStreamReader(sample_rate)
writer = sphn.OpusStreamWriter(sample_rate)

while True:
    # Read length-prefixed Opus frame
    hdr = sys.stdin.buffer.read(4)
    if not hdr or len(hdr) < 4:
        break
    length = struct.unpack('<I', hdr)[0]
    if length == 0:
        continue
    opus_data = sys.stdin.buffer.read(length)
    if len(opus_data) < length:
        break

    # Decode Opus → PCM float32
    reader.append_bytes(opus_data)
    pcm = reader.read_pcm()
    if pcm.shape[-1] == 0:
        continue

    # Convert float32 → int16
    import numpy as np
    pcm_int16 = (pcm * 32767).clip(-32768, 32767).astype(np.int16)

    # Write length-prefixed PCM bytes
    pcm_bytes = pcm_int16.tobytes()
    sys.stdout.buffer.write(struct.pack('<I', len(pcm_bytes)))
    sys.stdout.buffer.write(pcm_bytes)
    sys.stdout.buffer.flush()
`;

export class OpusDecoder {
  private proc: ChildProcess | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private onPcm: ((pcm: Int16Array) => void) | null = null;
  private started = false;

  /**
   * Start the Python Opus decoder sidecar.
   * Call this once on server startup.
   */
  start(): boolean {
    try {
      this.proc = spawn('python3', ['-c', PYTHON_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.proc.stdout!.on('data', (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.processBuffer();
      });

      this.proc.stderr!.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) logger.warn('Opus decoder stderr', { msg });
      });

      this.proc.on('exit', (code) => {
        logger.warn('Opus decoder process exited', { code });
        this.started = false;
        // Auto-restart after 2s
        setTimeout(() => this.start(), 2000);
      });

      this.started = true;
      logger.info('Opus decoder sidecar started');
      return true;
    } catch (err) {
      logger.error('Failed to start Opus decoder', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Register callback for decoded PCM data.
   */
  onDecodedPcm(cb: (pcm: Int16Array) => void): void {
    this.onPcm = cb;
  }

  /**
   * Feed Opus-encoded bytes from PersonaPlex for decoding.
   */
  decode(opusData: Buffer): void {
    if (!this.proc || !this.started || !this.proc.stdin!.writable) return;

    // Length-prefixed write
    const header = Buffer.alloc(4);
    header.writeUInt32LE(opusData.length);
    this.proc.stdin!.write(header);
    this.proc.stdin!.write(opusData);
  }

  /**
   * Stop the decoder.
   */
  stop(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
      this.started = false;
    }
  }

  get isRunning(): boolean {
    return this.started;
  }

  private processBuffer(): void {
    // Read length-prefixed PCM frames from the buffer
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + length) break;

      const pcmBytes = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);

      // Convert bytes to Int16Array
      const pcm = new Int16Array(pcmBytes.length / 2);
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] = pcmBytes.readInt16LE(i * 2);
      }

      if (this.onPcm) {
        this.onPcm(pcm);
      }
    }
  }
}

/**
 * Fallback: if Python isn't available, provide a no-op decoder
 * that logs but doesn't crash.
 */
export class NoOpDecoder {
  private warned = false;

  start(): boolean {
    logger.warn('Opus decoder not available (Python/sphn not installed). Audio return path disabled.');
    return false;
  }

  onDecodedPcm(_cb: (pcm: Int16Array) => void): void {}

  decode(_data: Buffer): void {
    if (!this.warned) {
      logger.warn('Dropping PersonaPlex audio — no Opus decoder available');
      this.warned = true;
    }
  }

  stop(): void {}

  get isRunning(): boolean { return false; }
}

/**
 * Create the best available decoder.
 */
export function createOpusDecoder(): OpusDecoder | NoOpDecoder {
  const decoder = new OpusDecoder();
  if (decoder.start()) {
    return decoder;
  }
  return new NoOpDecoder();
}
