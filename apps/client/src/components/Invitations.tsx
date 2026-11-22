import { useState } from "react";
import type { Invitation } from "@pm/shared";
import { displayName } from "../lib/users";
import { RoomAvatar } from "./Avatar";
import { useInvitations } from "../store/invitations";

/** "just now", "5m", "3h", "2d", then a date. */
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function InvitationCard({ invitation }: { invitation: Invitation }) {
  const accept = useInvitations((s) => s.accept);
  const decline = useInvitations((s) => s.decline);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: "accept" | "decline") => {
    setBusy(action);
    setError(null);
    try {
      await (action === "accept" ? accept : decline)(invitation.roomId);
      // On success the card unmounts.
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const { invitedBy, memberCount } = invitation;
  return (
    <li className="invitation">
      <div className="invitation-room">
        <RoomAvatar room={{ id: invitation.roomId, name: invitation.roomName, avatarUrl: invitation.roomAvatarUrl }} size={32} />
        <span className="room-name">{invitation.roomName}</span>
      </div>
      <span className="muted small">
        {invitedBy ? `${displayName(invitedBy)} invited you` : "You were invited"} · {ago(invitation.createdAt)}
      </span>
      <span className="muted small">
        {memberCount} member{memberCount === 1 ? "" : "s"}
      </span>
      {error && <p className="error small">{error}</p>}
      <div className="invitation-actions">
        <button type="button" disabled={busy !== null} onClick={() => void run("accept")}>
          {busy === "accept" ? "Joining…" : "Accept"}
        </button>
        <button type="button" className="secondary" disabled={busy !== null} onClick={() => void run("decline")}>
          {busy === "decline" ? "…" : "Decline"}
        </button>
      </div>
    </li>
  );
}

export function Invitations() {
  const list = useInvitations((s) => s.list);
  if (list.length === 0) return null;
  return (
    <section className="invitations" aria-label="Invitations">
      <h3>Invitations · {list.length}</h3>
      <ul>
        {list.map((i) => (
          <InvitationCard key={i.roomId} invitation={i} />
        ))}
      </ul>
    </section>
  );
}
