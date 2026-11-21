import { useState } from "react";
import type { Message, User } from "@pm/shared";
import { displayName } from "../lib/users";
import { useMessages } from "../store/messages";
import { Modal } from "./Modal";

export function DeleteMessageModal({ message, me, onClose }: { message: Message; me: User; onClose: () => void }) {
  const remove = useMessages((s) => s.remove);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = message.author.id === me.id;

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await remove(message.roomId, message.id, me.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Delete message?" onClose={busy ? undefined : onClose}>
      <div className="stack">
        <p className="muted">
          {own ? "It will be deleted for everyone in the room." : `${displayName(message.author)}'s message will be deleted for everyone in the room.`}
        </p>
        <blockquote className="quote">{message.text}</blockquote>
        {error && <p className="error">{error}</p>}
        <div className="row modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={() => void onDelete()} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
