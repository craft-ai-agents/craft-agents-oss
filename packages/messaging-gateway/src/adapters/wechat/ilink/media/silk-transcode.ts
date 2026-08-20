// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.
import { logger } from "../util/logger";

/** Default sample rate for Weixin voice messages. */
const SILK_SAMPLE_RATE = 24_000;

/**
 * Wrap raw pcm_s16le bytes in a WAV container.
 * Mono channel, 16-bit signed little-endian.
 */
function pcmBytesToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const pcmBytes = pcm.byteLength;
  const totalSize = 44 + pcmBytes;
  const buf = Buffer.allocUnsafe(totalSize);
  let offset = 0;

  buf.write("RIFF", offset);
  offset += 4;
  buf.writeUInt32LE(totalSize - 8, offset);
  offset += 4;
  buf.write("WAVE", offset);
  offset += 4;

  buf.write("fmt ", offset);
  offset += 4;
  buf.writeUInt32LE(16, offset);
  offset += 4; // fmt chunk size
  buf.writeUInt16LE(1, offset);
  offset += 2; // PCM format
  buf.writeUInt16LE(1, offset);
  offset += 2; // mono
  buf.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buf.writeUInt32LE(sampleRate * 2, offset);
  offset += 4; // byte rate (mono 16-bit)
  buf.writeUInt16LE(2, offset);
  offset += 2; // block align
  buf.writeUInt16LE(16, offset);
  offset += 2; // bits per sample

  buf.write("data", offset);
  offset += 4;
  buf.writeUInt32LE(pcmBytes, offset);
  offset += 4;

  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset);

  return buf;
}

/**
 * Try to transcode a SILK audio buffer to WAV using silk-wasm.
 * silk-wasm's decode() returns { data: Uint8Array (pcm_s16le), duration: number }.
 *
 * Returns a WAV Buffer on success, or null if silk-wasm is unavailable or decoding fails.
 * Callers should fall back to passing the raw SILK file when null is returned.
 */
export async function silkToWav(silkBuf: Buffer): Promise<Buffer | null> {
  try {
    // Optional voice-transcoding dependency; loaded via a non-literal specifier
    // so its types aren't required at build time. Falls back to raw SILK below.
    const silkModule: string = "silk-wasm";
    const { decode } = (await import(silkModule)) as {
      decode: (
        input: Uint8Array | Buffer,
        sampleRate: number,
      ) => Promise<{ data: Uint8Array; duration: number }>;
    };

    logger.debug(`silkToWav: decoding ${silkBuf.length} bytes of SILK`);
    const result = await decode(silkBuf, SILK_SAMPLE_RATE);
    logger.debug(
      `silkToWav: decoded duration=${result.duration}ms pcmBytes=${result.data.byteLength}`,
    );

    const wav = pcmBytesToWav(result.data, SILK_SAMPLE_RATE);
    logger.debug(`silkToWav: WAV size=${wav.length}`);
    return wav;
  } catch (err) {
    logger.warn(`silkToWav: transcode failed, will use raw silk err=${String(err)}`);
    return null;
  }
}
