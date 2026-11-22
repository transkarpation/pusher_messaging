import { useEffect, useState } from "react";
import { voiceMetaOf } from "../lib/voice";
import { VoicePlayer } from "./VoicePlayer";

/** A finished recording waiting to be sent or deleted; it can be played back first. */
export function VoiceDraft({ file, onDelete }: { file: File; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const meta = voiceMetaOf(file);

  return (
    <div className="voice-draft">
      <button type="button" className="ghost icon danger" aria-label="Delete recording" title="Delete (Esc)" onClick={onDelete}>
        🗑
      </button>
      {url && <VoicePlayer src={url} name={file.name} durationMs={meta?.durationMs ?? null} waveform={meta?.waveform ?? null} />}
    </div>
  );
}
