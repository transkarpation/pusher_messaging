import { useEffect, useMemo, useRef, useState } from "react";
import { LogOut, ShieldUser } from "lucide-react";
import { isAdminRole, isSystemMessage, type SessionUser } from "@pm/shared";
import { ADMIN_PATH, PROFILE_PATH, navigate } from "../lib/router";
import { deletedLabel, displayName, messagePreview, systemText } from "../lib/users";
import { useAuth } from "../store/auth";
import { unreadRoomCount, useRooms, visibleRooms, type RoomFilter } from "../store/rooms";
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
  const filter = useRooms((s) => s.filter);
  const list = useRooms((s) => s.lists[s.filter]);
  const setFilter = useRooms((s) => s.setFilter);
  const loadingMore = useRooms((s) => s.loadingMore);
  const unreadRooms = useRooms(unreadRoomCount);
  const hasMore = !list.loaded || list.cursor !== null;
  const [creating, setCreating] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const moreRef = useRef<HTMLLIElement>(null);
  /**
   * Rooms shown under "Unread" since it was switched on. They stay when read, so the list
   * doesn't shift under the pointer (as in Telegram); switching the filter clears them.
   */
  const [kept, setKept] = useState<ReadonlySet<number>>(() => new Set());

  const rooms = useMemo(() => visibleRooms(roomsById, list, filter, kept), [roomsById, list, filter, kept]);

  useEffect(() => {
    if (filter !== "unread") return;
    const shown = rooms.filter((r) => !kept.has(r.id));
    if (shown.length > 0) setKept(new Set([...kept, ...shown.map((r) => r.id)]));
  }, [filter, rooms, kept]);

  const chooseFilter = (next: RoomFilter) => {
    setKept(new Set());
    setFilter(next);
    listRef.current?.scrollTo({ top: 0 });
  };

  // Loads the next page when the end of the list scrolls into view. Observing again after each
  // change keeps loading while the end is still visible (a list shorter than the sidebar).
  useEffect(() => {
    const list = listRef.current;
    const more = moreRef.current;
    if (!list || !more || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void useRooms.getState().fetchMore();
      },
      { root: list, rootMargin: "200px 0px" },
    );
    observer.observe(more);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, rooms.length, filter]);

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

      <div className="room-filter" role="group" aria-label="Show rooms">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? "active" : ""}
            aria-pressed={filter === f}
            onClick={() => chooseFilter(f)}
          >
            {f === "all" ? "All" : "Unread"}
            {f === "unread" && unreadRooms > 0 && (
              <span className="filter-badge" aria-label={`${unreadRooms} rooms with unread messages`}>
                {unreadRooms > 99 ? "99+" : unreadRooms}
              </span>
            )}
          </button>
        ))}
      </div>

      <ul className="room-list" ref={listRef}>
        {loaded && list.loaded && rooms.length === 0 && (
          <li className="muted empty">{filter === "unread" ? "No unread messages" : "No rooms yet"}</li>
        )}
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
        {hasMore && (
          <li ref={moreRef} className="muted small room-list-more" aria-live="polite">
            {loadingMore ? "Loading more rooms…" : ""}
          </li>
        )}
      </ul>

      {creating && <CreateRoomModal onClose={() => setCreating(false)} />}
    </nav>
  );
}
