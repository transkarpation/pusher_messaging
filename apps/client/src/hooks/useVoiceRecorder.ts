import { useCallback, useEffect, useRef, useState } from "react";
import { VOICE_MESSAGE_NAME } from "@pm/shared";
import { levelToHeight, setVoiceMeta, toWaveform } from "../lib/voice";

/** Recording formats in order of preference. */
const FORMATS = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
const EXTENSIONS: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" };

/** Recordings shorter than this are dropped (a tap instead of a hold). */
const MIN_MS = 700;
/** How often the microphone level is sampled for the waveform. */
const SAMPLE_MS = 50;

/** MediaRecorder needs a secure context (https or localhost) for the microphone. */
export const voiceSupported = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** What a recording in progress shows: when it started and the bar heights (0–1) so far. */
export interface LiveRecording {
  startedAt: number;
  /** Appended to while recording; read by the live waveform on each animation frame. */
  heights: number[];
}

interface Recording extends LiveRecording {
  recorder: MediaRecorder;
  stream: MediaStream;
  audio: AudioContext;
  chunks: Blob[];
  timer: number;
}

/**
 * Records a voice message from the microphone, sampling its level for a waveform.
 * `stop(true)` resolves with the recording as a File (its length and waveform attached,
 * see `voiceMetaOf`); `stop(false)` (cancel) resolves with null. At `maxMs` it calls `onLimit`.
 */
export function useVoiceRecorder({ maxMs, onLimit }: { maxMs: number; onLimit: () => void }) {
  const [state, setState] = useState<"idle" | "starting" | "recording">("idle");
  const [live, setLive] = useState<LiveRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Recording | null>(null);
  const starting = useRef(false);
  const mounted = useRef(true);
  const onLimitRef = useRef(onLimit);
  onLimitRef.current = onLimit;

  const stop = useCallback((keep: boolean): Promise<File | null> => {
    const r = current.current;
    current.current = null;
    setState(starting.current ? "starting" : "idle");
    setLive(null);
    if (!r) return Promise.resolve(null);
    clearInterval(r.timer);
    void r.audio.close();
    const durationMs = Date.now() - r.startedAt;
    return new Promise((resolve) => {
      r.recorder.onstop = () => {
        r.stream.getTracks().forEach((t) => t.stop());
        if (!keep) return resolve(null);
        if (durationMs < MIN_MS) {
          if (mounted.current) setError("Hold the microphone button to record a voice message");
          return resolve(null);
        }
        const type = (r.recorder.mimeType || r.chunks[0]?.type || "audio/webm").split(";")[0]!;
        const file = new File(r.chunks, `${VOICE_MESSAGE_NAME}.${EXTENSIONS[type] ?? "webm"}`, { type });
        setVoiceMeta(file, { durationMs, waveform: toWaveform(r.heights) });
        resolve(file);
      };
      r.recorder.stop();
    });
  }, []);

  /** Resolves true once recording, false if the microphone couldn't be used. */
  const start = useCallback(async (): Promise<boolean> => {
    if (current.current || starting.current) return false;
    starting.current = true;
    setError(null);
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      starting.current = false;
      if (mounted.current) {
        setError((e as Error).name === "NotAllowedError" ? "Microphone access was denied" : "Couldn't access the microphone");
        setState("idle");
      }
      return false;
    }
    starting.current = false;
    if (!mounted.current) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }

    const format = FORMATS.find((mime) => MediaRecorder.isTypeSupported(mime));
    const recorder = new MediaRecorder(stream, format ? { mimeType: format } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    // The level meter: RMS of the latest samples, every SAMPLE_MS.
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    recorder.start(250);
    const startedAt = Date.now();
    const heights: number[] = [];
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      heights.push(levelToHeight(Math.sqrt(sum / samples.length)));
      if (Date.now() - startedAt >= maxMs) onLimitRef.current();
    }, SAMPLE_MS);

    current.current = { recorder, stream, audio, chunks, startedAt, heights, timer };
    setLive({ startedAt, heights });
    setState("recording");
    return true;
  }, [maxMs]);

  // Leaving the room mid-recording discards it and releases the microphone.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void stop(false);
    };
  }, [stop]);

  return { state, live, error, clearError: useCallback(() => setError(null), []), start, stop };
}

/** "0:07", "1:23". */
export const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
