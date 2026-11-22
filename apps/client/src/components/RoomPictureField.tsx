import { useEffect, useRef } from "react";
import { prepareAvatar } from "../lib/image";
import { RoomAvatar } from "./Avatar";

/** A newly picked picture, "removed", or null to keep the current one. */
export type PictureChoice = { blob: Blob; url: string } | "removed" | null;

interface Props {
  /** For the default avatar: the room's id (its color) and name (its letter). */
  roomId: number;
  name: string;
  /** The room's current picture, if it has one. */
  currentUrl: string | null;
  value: PictureChoice;
  onChange: (value: PictureChoice) => void;
  onError: (message: string) => void;
}

/** Preview of a room's picture with buttons to pick a new one or remove it. */
export function RoomPictureField({ roomId, name, currentUrl, value, onChange, onError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = value === "removed" ? null : (value?.url ?? currentUrl);

  // Free a picked picture's object URL when it's replaced or the form closes.
  const pickedUrl = value && value !== "removed" ? value.url : null;
  useEffect(() => (pickedUrl ? () => URL.revokeObjectURL(pickedUrl) : undefined), [pickedUrl]);

  const onFile = async (file: File) => {
    try {
      const blob = await prepareAvatar(file);
      onChange({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <div className="room-picture">
      <RoomAvatar room={{ id: roomId, name: name.trim() || "?", avatarUrl: shown }} size={64} />
      <div className="room-picture-actions">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // so picking the same file again still fires change
            if (file) void onFile(file);
          }}
        />
        <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
          {shown ? "Change picture" : "Add picture"}
        </button>
        {shown && (
          <button type="button" className="ghost" onClick={() => onChange(currentUrl ? "removed" : null)}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
