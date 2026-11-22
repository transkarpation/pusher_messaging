import { useEffect, useRef, useState } from "react";
import { formatDuration } from "../hooks/useVoiceRecorder";
import { Waveform } from "./Waveform";

/** Only one voice message plays at a time. */
let playingNow: HTMLAudioElement | null = null;

/**
 * A player for voice messages and other audio attachments: play/pause, the waveform
 * (seekable) and the time. `durationMs`/`waveform` come with recorded voice messages.
 */
export function VoicePlayer({
  src,
  name,
  durationMs,
  waveform,
}: {
  src: string;
  name: string;
  durationMs: number | null;
  waveform: number[] | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  /** Recorded WebM files carry no duration; seeking past the end makes the browser work it out. */
  const probing = useRef(false);
  const duration = durationMs !== null ? durationMs / 1000 : mediaDuration;

  useEffect(() => {
    const a = audioRef.current;
    return () => {
      if (a && playingNow === a) playingNow = null;
    };
  }, []);

  const onMetadata = () => {
    const a = audioRef.current!;
    if (Number.isFinite(a.duration)) setMediaDuration(a.duration);
    else if (durationMs === null) {
      probing.current = true;
      a.currentTime = 1e101;
    }
  };

  const onDurationChange = () => {
    const a = audioRef.current!;
    if (!Number.isFinite(a.duration)) return;
    setMediaDuration(a.duration);
    if (probing.current) {
      probing.current = false;
      a.currentTime = 0;
    }
  };

  const toggle = () => {
    const a = audioRef.current!;
    if (a.paused) {
      if (playingNow && playingNow !== a) playingNow.pause();
      playingNow = a;
      void a.play();
    } else a.pause();
  };

  const seek = (fraction: number) => {
    const a = audioRef.current!;
    if (!duration) return;
    a.currentTime = fraction * duration;
    setPosition(a.currentTime);
  };

  const progress = duration ? Math.min(1, position / duration) : 0;

  return (
    <div className="voice-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={onMetadata}
        onDurationChange={onDurationChange}
        onTimeUpdate={(e) => !probing.current && setPosition(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(e) => {
          setPlaying(false);
          setPosition(0);
          e.currentTarget.currentTime = 0;
        }}
      />
      <button
        type="button"
        className="voice-play"
        aria-label={playing ? `Pause ${name}` : `Play ${name}`}
        onClick={toggle}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <Waveform levels={waveform} progress={progress} onSeek={duration ? seek : undefined} />
      <span className="voice-time">{formatDuration(((playing || position > 0 ? position : duration) ?? 0) * 1000)}</span>
    </div>
  );
}
