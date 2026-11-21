import { useState, type FormEvent } from "react";
import type { Room, User } from "@pm/shared";
import { api } from "../api";
import { useRooms } from "../store/rooms";
import { Modal } from "./Modal";
import { UserPicker } from "./UserPicker";

export function InviteModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const [selected, setSelected] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (selected.length === 0) return;
    setSubmitting(true);
    try {
      const { invites } = await api.invite(room.id, { userIds: selected.map((u) => u.id) });
      useRooms.getState().setInvites(room.id, invites);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Invite people to ${room.name}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="stack">
        <UserPicker
          selected={selected}
          onChange={setSelected}
          // Members and people already invited can't be invited again.
          excludeIds={[...room.members.map((m) => m.user.id), ...room.invites.map((i) => i.user.id)]}
        />
        <p className="muted small">They'll join once they accept the invite.</p>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting || selected.length === 0}>
          {submitting ? "…" : selected.length > 1 ? `Send ${selected.length} invites` : "Send invite"}
        </button>
      </form>
    </Modal>
  );
}
