import { useState, type FormEvent } from "react";
import type { Room, User } from "@pm/shared";
import { api } from "../api";
import { useRooms } from "../store/rooms";
import { Modal } from "./Modal";
import { UserPicker } from "./UserPicker";

export function AddMembersModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const [selected, setSelected] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (selected.length === 0) return;
    setSubmitting(true);
    try {
      const { members } = await api.addMembers(room.id, { userIds: selected.map((u) => u.id) });
      useRooms.getState().setMembers(room.id, members);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Add people to ${room.name}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="stack">
        <UserPicker
          selected={selected}
          onChange={setSelected}
          excludeIds={room.members.map((m) => m.user.id)}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting || selected.length === 0}>
          {submitting ? "…" : selected.length > 1 ? `Add ${selected.length} people` : "Add"}
        </button>
      </form>
    </Modal>
  );
}
