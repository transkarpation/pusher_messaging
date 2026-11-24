import { useMemo, useState } from "react";
import { LogOut, ShieldUser } from "lucide-react";
import { isAdminRole, isSystemMessage, type SessionUser } from "@pm/shared";
import { ADMIN_PATH, PROFILE_PATH, navigate } from "../lib/router";
import { deletedLabel, displayName, messagePreview, systemText } from "../lib/users";
import { useAuth } from "../store/auth";
import { sortRooms, useRooms } from "../store/rooms";
import { Avatar, RoomAvatar } from "./Avatar";
import { CreateRoomModal } from "./CreateRoomModal";
import { Invitations } from "./Invitations";
import { ThemeToggle } from "./ThemeToggle";

export function Sidebar({ me, onProfile }: { me: SessionUser; onProfile: boolean }) {
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
        <button
          type="button"
          className={`profile-button ${onProfile ? "active" : ""}`}
          title="Profile"
          aria-current={onProfile ? "page" : undefined}
          onClick={() => navigate(PROFILE_PATH)}
        >
          <Avatar user={me} size={36} />
          <span className="profile-button-text">
            <strong>{displayName(me)}</strong>
            <span className="muted small">@{me.username}</span>
          </span>
        </button>
        <div className="sidebar-header-actions">
          <ThemeToggle />
          {isAdminRole(me.role) && (
            <a
              href={ADMIN_PATH}
              className="icon-link"
              title="Administration"
              aria-label="Administration"
              onClick={(e) => {
                e.preventDefault();
                navigate(ADMIN_PATH);
              }}
            >
              <ShieldUser size={18} aria-hidden="true" />
            </a>
          )}
          <button type="button" className="ghost icon" title="Log out" aria-label="Log out" onClick={() => void logout()}>
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="sidebar-actions">
        <button type="button" onClick={() => setCreating(true)}>
          + New room
        </button>
      </div>

      <Invitations />

      <ul className="room-list">
        {loaded && rooms.length === 0 && <li className="muted empty">No rooms yet</li>}
        {rooms.map((room) => {
          const last = room.lastMessage;
          const preview = last
            ? isSystemMessage(last)
              ? systemText(last, me.id)
              : last.deletedAt
              ? deletedLabel(last.author.id === me.id)
              : `${last.author.id === me.id ? "You" : displayName(last.author)}: ${messagePreview(last)}`
            : `${room.members.length} member${room.members.length === 1 ? "" : "s"}`;
          return (
            <li key={room.id}>
              <button
                type="button"
                className={`room-item ${room.id === activeRoomId && !onProfile ? "active" : ""}`}
                onClick={() => {
                  setActive(room.id);
                  navigate("/");
                }}
              >
                <RoomAvatar room={room} size={40} />
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
