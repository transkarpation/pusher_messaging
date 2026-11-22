import { useState, type FormEvent } from "react";
import { updateRoomSchema, type Room, type UpdateRoomInput } from "@pm/shared";
import { api } from "../api";
import { toBase64 } from "../lib/image";
import { useRooms } from "../store/rooms";
import { Modal } from "./Modal";
import { RoomPictureField, type PictureChoice } from "./RoomPictureField";

/** The owner's form for renaming the room and changing or removing its picture. */
export function EditRoomModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const [name, setName] = useState(room.name);
  const [picture, setPicture] = useState<PictureChoice>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const input: UpdateRoomInput = {};
    if (name.trim() !== room.name) input.name = name;
    if (picture === "removed") input.avatar = null;
    if (input.name === undefined && input.avatar === undefined && !picture) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      if (picture && picture !== "removed") input.avatar = await toBase64(picture.blob);
      const parsed = updateRoomSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
      useRooms.getState().setDetails(await api.updateRoom(room.id, parsed.data));
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit room" onClose={onClose}>
      <form onSubmit={onSubmit} className="stack">
        <RoomPictureField
          roomId={room.id}
          name={name}
          currentUrl={room.avatarUrl}
          value={picture}
          onChange={(p) => {
            setPicture(p);
            setError(null);
          }}
          onError={setError}
        />
        <label>
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={saving}>
          {saving ? "…" : "Save"}
        </button>
      </form>
    </Modal>
  );
}
