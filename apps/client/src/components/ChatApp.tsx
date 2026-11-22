import { useEffect, useState } from "react";
import type { User } from "@pm/shared";
import { useReceiptsReporter } from "../hooks/useReceiptsReporter";
import { useRealtime } from "../hooks/useRealtime";
import { PROFILE_PATH, usePath } from "../lib/router";
import { useBlocks } from "../store/blocks";
import { useInvitations } from "../store/invitations";
import { useMessages } from "../store/messages";
import { useRooms } from "../store/rooms";
import { CreateRoomModal } from "./CreateRoomModal";
import { ProfilePage } from "./ProfilePage";
import { RoomView } from "./RoomView";
import { Sidebar } from "./Sidebar";

export function ChatApp({ user }: { user: User }) {
  const room = useRooms((s) => (s.activeRoomId ? s.rooms[s.activeRoomId] : undefined));
  const loaded = useRooms((s) => s.loaded);
  const error = useRooms((s) => s.error);
  const [creating, setCreating] = useState(false);
  const onProfile = usePath() === PROFILE_PATH;

  useRealtime(user);
  useReceiptsReporter();

  useEffect(() => {
    void useRooms.getState().fetch();
    void useInvitations.getState().fetch();
    void useBlocks.getState().fetch();
    // Blocking or unblocking changes which messages count as last and unread, so reload those.
    const unsubscribeBlocks = useBlocks.subscribe((s, prev) => {
      if (prev.loaded && s.ids !== prev.ids) void useRooms.getState().fetch({ trustServer: true });
    });
    return () => {
      unsubscribeBlocks();
      useRooms.getState().reset();
      useMessages.getState().reset();
      useInvitations.getState().reset();
      useBlocks.getState().reset();
    };
  }, []);

  return (
    <div className={`app ${room || onProfile ? "has-room" : ""}`}>
      <Sidebar me={user} onProfile={onProfile} />
      {onProfile ? (
        <ProfilePage me={user} />
      ) : room ? (
        <RoomView key={room.id} room={room} me={user} />
      ) : (
        <section className="room-empty">
          {error ? (
            <p className="error">{error}</p>
          ) : !loaded ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="stack center-text">
              <h2>No room selected</h2>
              <p className="muted">Pick a room on the left or start a new one.</p>
              <button type="button" onClick={() => setCreating(true)}>
                + New room
              </button>
            </div>
          )}
          {creating && <CreateRoomModal onClose={() => setCreating(false)} />}
        </section>
      )}
    </div>
  );
}
