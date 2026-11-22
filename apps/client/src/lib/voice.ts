import { WAVEFORM_BARS, WAVEFORM_MAX } from "@pm/shared";

/** Length and waveform of a voice message recorded here, sent along with the upload. */
export interface VoiceMeta {
  durationMs: number;
  waveform: number[];
}

/** Recorded files' metadata, kept beside the File so it can travel through the send queue unchanged. */
const metaByFile = new WeakMap<File, VoiceMeta>();
export const setVoiceMeta = (file: File, meta: VoiceMeta) => metaByFile.set(file, meta);
export const voiceMetaOf = (file: File) => metaByFile.get(file);

/** A microphone RMS level (0–1) as a bar height (0–1); the square root lifts quiet speech. */
export const levelToHeight = (rms: number) => Math.min(1, Math.sqrt(rms) * 1.8);

/**
 * Bar heights sampled during a recording, squeezed into `WAVEFORM_BARS` bars and scaled so
 * the loudest is `WAVEFORM_MAX`.
 */
export function toWaveform(heights: number[]): number[] {
  if (heights.length === 0) return Array(WAVEFORM_BARS).fill(0);
  const bars = Array.from({ length: WAVEFORM_BARS }, (_, i) => {
    const from = Math.floor((i * heights.length) / WAVEFORM_BARS);
    const to = Math.max(from + 1, Math.floor(((i + 1) * heights.length) / WAVEFORM_BARS));
    const slice = heights.slice(from, Math.min(to, heights.length));
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  });
  const max = Math.max(...bars);
  return bars.map((b) => (max > 0 ? Math.round((b / max) * WAVEFORM_MAX) : 0));
}
