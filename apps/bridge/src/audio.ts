/**
 * Audio codec utilities for the Twilio <-> Deepgram bridge.
 *
 * Twilio Media Streams deliver 8 kHz mu-law (G.711).
 * Deepgram Nova-3 expects 16 kHz linear16 PCM.
 *
 * This module provides:
 *   - mu-law decode (byte -> 16-bit signed PCM)
 *   - mu-law encode (16-bit signed PCM -> byte)
 *   - linear-interpolation resampler
 *
 * Lookup tables are built once at import time.
 */

// ── Mu-law decode table (256 entries) ─────────────────────────────────────────

const MULAW_DECODE = new Int16Array(256);

for (let i = 0; i < 256; i++) {
  let mu = ~i & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  MULAW_DECODE[i] = sign ? -sample : sample;
}

// ── Mu-law encode table (65 536 entries, indexed by unsigned 16-bit value) ────

const MULAW_ENCODE = new Uint8Array(65536);

for (let i = 0; i < 65536; i++) {
  let sample = i < 32768 ? i : i - 65536; // convert to signed
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > 32635) sample = 32635;
  sample += 0x84;
  let exponent = 7;
  let mask = 0x4000;
  while (exponent > 0 && !(sample & mask)) {
    exponent--;
    mask >>= 1;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  MULAW_ENCODE[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Decode a buffer of mu-law bytes into 16-bit signed PCM samples.
 */
export function decodeMulaw(mulawBuf: Buffer | Uint8Array): Int16Array {
  const pcm = new Int16Array(mulawBuf.length);
  for (let i = 0; i < mulawBuf.length; i++) {
    pcm[i] = MULAW_DECODE[mulawBuf[i]];
  }
  return pcm;
}

/**
 * Encode 16-bit signed PCM samples into a mu-law byte buffer.
 */
export function encodeMulaw(pcm: Int16Array): Buffer {
  const mulaw = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const sample = pcm[i];
    // Map signed int16 to unsigned 16-bit index for the lookup table.
    const idx = sample < 0 ? sample + 65536 : sample;
    mulaw[i] = MULAW_ENCODE[idx];
  }
  return mulaw;
}

/**
 * Linear-interpolation resampler.
 *
 * Converts PCM samples from one sample rate to another.
 * Works for both upsampling (8k -> 24k) and downsampling (24k -> 8k).
 */
export function resample(
  pcm: Int16Array,
  fromRate: number,
  toRate: number,
): Int16Array {
  if (fromRate === toRate) return pcm;

  const ratio = fromRate / toRate;
  const outLen = Math.floor(pcm.length / ratio);
  const out = new Int16Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const idx = Math.floor(srcIdx);
    const frac = srcIdx - idx;

    if (idx + 1 < pcm.length) {
      out[i] = Math.round(pcm[idx] * (1 - frac) + pcm[idx + 1] * frac);
    } else {
      out[i] = pcm[idx] ?? 0;
    }
  }

  return out;
}

/**
 * Convert 16-bit signed PCM to a raw byte buffer (little-endian).
 * Useful for sending PCM over WebSocket as binary.
 */
export function pcmToBuffer(pcm: Int16Array): Buffer {
  const buf = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    buf.writeInt16LE(pcm[i], i * 2);
  }
  return buf;
}

/**
 * Convert a raw little-endian byte buffer back to 16-bit signed PCM.
 */
export function bufferToPcm(buf: Buffer): Int16Array {
  const pcm = new Int16Array(buf.length / 2);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = buf.readInt16LE(i * 2);
  }
  return pcm;
}
