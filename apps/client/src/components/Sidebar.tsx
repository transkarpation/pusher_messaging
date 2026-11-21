import { useMemo, useState } from "react";
import type { User } from "@pm/shared";
import { displayName } from "../lib/users";
import { useAuth } from "../store/auth";
import { sortRooms, useRooms } from "../store/rooms";
import { CreateRoomModal } from "./CreateRoomModal";
import { ThemeToggle } from "./ThemeToggle";

export function Sidebar({ me }: { me: User }) {
  const logout = useAuth((s) => s.logout);
  const roomsById = useRooms((s) => s.rooms);
  const activeRoomId = useRooms((s) => s.activeRoomId);
  const setActive = useRooms((s) => s.setActive);
  const loaded = useRooms((s) => s.loaded);
  const [creating, setCreating] = useState(false);

  const rooms = useMemo(() => sortRooms(roomsById), [roomsById]);

  return (
    <nav className="sidebar">
      <header className="sidebar-header">
        <div>
          <strong>{displayName(me)}</strong>
          <div className="muted small">@{me.username}</div>
        </div>
        <div className="sidebar-header-actions">
          <ThemeToggle />
          <button type="button" className="link" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      <div className="sidebar-actions">
        <button type="button" onClick={() => setCreating(true)}>
          + New room
        </button>
      </div>

      <ul className="room-list">
        {loaded && rooms.length === 0 && <li className="muted empty">No rooms yet</li>}
        {rooms.map((room) => {
          const last = room.lastMessage;
          const preview = last
            ? `${last.author.id === me.id ? "You" : displayName(last.author)}: ${last.text}`
            : `${room.members.length} member${room.members.length === 1 ? "" : "s"}`;
          return (
            <li key={room.id}>
              <button
                type="button"
                className={`room-item ${room.id === activeRoomId ? "active" : ""}`}
                onClick={() => setActive(room.id)}
              >
                <span className="room-name">{room.name}</span>
                <span className="room-preview">{preview}</span>
                {room.unreadCount > 0 && (
                  <span className="badge" aria-label={`${room.unreadCount} unread`}>
                    {room.unreadCount > 99 ? "99+" : room.unreadCount}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {creating && <CreateRoomModal onClose={() => setCreating(false)} />}
    </nav>
  );
}
