import { useEffect, useState } from "react";
import type { User } from "@pm/shared";
import { useReceiptsReporter } from "../hooks/useReceiptsReporter";
import { useRealtime } from "../hooks/useRealtime";
import { useMessages } from "../store/messages";
import { useRooms } from "../store/rooms";
import { CreateRoomModal } from "./CreateRoomModal";
import { RoomView } from "./RoomView";
import { Sidebar } from "./Sidebar";

export function ChatApp({ user }: { user: User }) {
  const room = useRooms((s) => (s.activeRoomId ? s.rooms[s.activeRoomId] : undefined));
  const loaded = useRooms((s) => s.loaded);
  const error = useRooms((s) => s.error);
  const [creating, setCreating] = useState(false);

  useRealtime(user);
  useReceiptsReporter();

  useEffect(() => {
    void useRooms.getState().fetch();
    return () => {
      useRooms.getState().reset();
      useMessages.getState().reset();
    };
  }, []);

  return (
    <div className={`app ${room ? "has-room" : ""}`}>
      <Sidebar me={user} />
      {room ? (
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
