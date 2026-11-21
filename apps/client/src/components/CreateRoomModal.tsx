import { useState, type FormEvent } from "react";
import { createRoomSchema, type User } from "@pm/shared";
import { api } from "../api";
import { useRooms } from "../store/rooms";
import { Modal } from "./Modal";
import { UserPicker } from "./UserPicker";

export function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [invitees, setInvitees] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createRoomSchema.safeParse({ name, inviteIds: invitees.map((u) => u.id) });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const room = await api.createRoom(parsed.data);
      const rooms = useRooms.getState();
      rooms.upsert(room);
      rooms.setActive(room.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title="New room" onClose={onClose}>
      <form onSubmit={onSubmit} className="stack">
        <label>
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekend plans" />
        </label>
        <div className="stack">
          <span className="label">Invite people</span>
          <UserPicker selected={invitees} onChange={setInvitees} />
          <span className="muted small">They'll join once they accept the invite.</span>
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "…" : "Create room"}
        </button>
      </form>
    </Modal>
  );
}
