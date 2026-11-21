import { useMemo, useState } from "react";
import type { Room, User } from "@pm/shared";
import { api } from "../api";
import { displayName } from "../lib/users";
import { useOnline } from "../store/online";
import { useRooms } from "../store/rooms";
import { AddMembersModal } from "./AddMembersModal";

export function MembersPanel({ room, me }: { room: Room; me: User }) {
  const online = useOnline((s) => s.users);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myRole = room.members.find((m) => m.user.id === me.id)?.role;
  // I'm online by definition, even before the presence subscription completes.
  const isOnline = (id: number) => id === me.id || !!online[id];
  const onlineCount = room.members.filter((m) => isOnline(m.user.id)).length;

  // Me first, then online, then alphabetical.
  const sorted = useMemo(
    () =>
      [...room.members].sort((a, b) => {
        if (a.user.id === me.id) return -1;
        if (b.user.id === me.id) return 1;
        const byOnline = Number(isOnline(b.user.id)) - Number(isOnline(a.user.id));
        return byOnline || displayName(a.user).localeCompare(displayName(b.user));
      }),
    [room.members, online, me.id],
  );

  const remove = async (user: User) => {
    const self = user.id === me.id;
    const question = self ? `Leave "${room.name}"?` : `Remove ${displayName(user)} from "${room.name}"?`;
    if (!window.confirm(question)) return;
    try {
      const { members } = await api.removeMember(room.id, user.id);
      if (self) useRooms.getState().remove(room.id);
      else useRooms.getState().setMembers(room.id, members);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <aside className="members">
      <div className="members-header">
        <h3>
          Members · {room.members.length}
          <span className="muted"> · {onlineCount} online</span>
        </h3>
        <button type="button" className="secondary" onClick={() => setAdding(true)}>
          + Add people
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <ul>
        {sorted.map(({ user, role }) => {
          const isMe = user.id === me.id;
          const canRemove = !isMe && myRole === "owner";
          return (
            <li key={user.id}>
              <span className={`dot ${isOnline(user.id) ? "on" : ""}`} title={isOnline(user.id) ? "Online" : "Offline"} />
              <span className="member-name">
                {displayName(user)}
                {isMe && <span className="muted"> (you)</span>}
                {role === "owner" && <span className="tag">owner</span>}
              </span>
              {canRemove && (
                <button
                  type="button"
                  className="ghost icon"
                  aria-label={`Remove ${displayName(user)}`}
                  title="Remove from room"
                  onClick={() => void remove(user)}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {myRole === "member" && (
        <button type="button" className="link danger" onClick={() => void remove(me)}>
          Leave room
        </button>
      )}
      {adding && <AddMembersModal room={room} onClose={() => setAdding(false)} />}
    </aside>
  );
}
