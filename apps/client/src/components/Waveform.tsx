import { useEffect, useRef, type PointerEvent } from "react";
import { WAVEFORM_BARS, WAVEFORM_MAX } from "@pm/shared";
import type { LiveRecording } from "../hooks/useVoiceRecorder";

/** Bars shown for audio without a stored waveform. */
const FLAT = Array<number>(WAVEFORM_BARS).fill(WAVEFORM_MAX * 0.3);

/**
 * A voice message's waveform: bars up to `progress` (0–1) are drawn as played. Clicking or
 * dragging across it seeks (`onSeek` gets the position, 0–1).
 */
export function Waveform({
  levels,
  progress,
  onSeek,
}: {
  levels: number[] | null;
  progress: number;
  onSeek?: (fraction: number) => void;
}) {
  const bars = levels ?? FLAT;
  const seekTo = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek?.(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  };
  return (
    <div
      className={`waveform ${onSeek ? "seekable" : ""}`}
      aria-hidden="true"
      onPointerDown={(e) => {
        if (!onSeek) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e);
      }}
      onPointerMove={(e) => {
        if (onSeek && e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e);
      }}
    >
      {bars.map((level, i) => (
        <span
          key={i}
          className={(i + 0.5) / bars.length <= progress ? "played" : undefined}
          style={{ height: `${Math.max(10, (level / WAVEFORM_MAX) * 100)}%` }}
        />
      ))}
    </div>
  );
}

const BAR = 3;
const GAP = 2;

/** The waveform of a recording in progress: the latest levels scroll in from the right. */
export function LiveWaveform({ recording }: { recording: LiveRecording }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let frame = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = getComputedStyle(canvas).color;
      const count = Math.floor((width + GAP) / (BAR + GAP));
      const heights = recording.heights.slice(-count);
      // Newest at the right edge; older bars to its left.
      const offset = width - heights.length * (BAR + GAP) + GAP;
      heights.forEach((h, i) => {
        const barHeight = Math.max(2, h * height);
        ctx.beginPath();
        ctx.roundRect(offset + i * (BAR + GAP), (height - barHeight) / 2, BAR, barHeight, 1.5);
        ctx.fill();
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [recording]);

  return <canvas ref={canvasRef} className="live-waveform" aria-hidden="true" />;
}
