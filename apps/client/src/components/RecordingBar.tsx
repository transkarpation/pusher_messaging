import { useEffect, useState } from "react";
import { formatDuration, type LiveRecording } from "../hooks/useVoiceRecorder";
import { LiveWaveform } from "./Waveform";

/** Shown in place of the text field while the microphone button is held. */
export function RecordingBar({ recording, cancelling }: { recording: LiveRecording | null; cancelling: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [recording]);

  return (
    <div className={`recording-bar ${cancelling ? "cancelling" : ""}`} role="status">
      <span className="recording-dot" aria-hidden="true" />
      <span className="recording-time">{recording ? formatDuration(now - recording.startedAt) : "0:00"}</span>
      {recording ? <LiveWaveform recording={recording} /> : <span className="live-waveform" />}
      <span className="recording-hint">{cancelling ? "Release to cancel" : "‹ Slide left to cancel"}</span>
    </div>
  );
}
