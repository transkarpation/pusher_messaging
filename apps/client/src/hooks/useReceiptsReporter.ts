import { useEffect, useRef } from "react";
import type { UpdateReceiptInput } from "@pm/shared";
import { api } from "../api";
import { useWindowActive } from "../lib/activity";
import { useMessages } from "../store/messages";
import { useRooms } from "../store/rooms";

const DEBOUNCE_MS = 300;

/**
 * Reports, per room, which messages reached this client (delivered: any room we
 * know the latest message of) and which the user has seen (read: the open room,
 * once its messages are loaded and the window is active).
 */
export function useReceiptsReporter() {
  const rooms = useRooms((s) => s.rooms);
  const activeRoomId = useRooms((s) => s.activeRoomId);
  const activeLoaded = useMessages((s) => (activeRoomId ? !!s.byRoom[activeRoomId]?.loaded : false));
  const windowActive = useWindowActive();

  // Highest watermarks already sent per room (optimistic, reverted on failure).
  const sent = useRef(new Map<number, { delivered: number; read: number }>());

  useEffect(() => {
    const timer = setTimeout(() => {
      for (const room of Object.values(rooms)) {
        const latest = room.lastMessage?.id ?? 0;
        if (!latest) continue;

        const prev = sent.current.get(room.id) ?? { delivered: 0, read: 0 };
        const known = {
          delivered: Math.max(prev.delivered, room.myReceipt.deliveredUpTo),
          read: Math.max(prev.read, room.myReceipt.readUpTo),
        };
        const canRead = room.id === activeRoomId && activeLoaded && windowActive;

        const input: UpdateReceiptInput = {};
        if (latest > known.delivered) input.deliveredUpTo = latest;
        if (canRead && latest > known.read) input.readUpTo = latest;
        if (input.deliveredUpTo === undefined && input.readUpTo === undefined) continue;

        sent.current.set(room.id, {
          delivered: Math.max(known.delivered, latest),
          read: input.readUpTo ?? known.read,
        });
        api
          .updateReceipt(room.id, input)
          .then((r) => {
            useRooms.getState().applyMyReceipt(r);
            useMessages.getState().applyReceipt(r);
          })
          .catch((err) => {
            sent.current.set(room.id, prev); // retried on the next change
            console.error("Failed to update receipts:", err);
          });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rooms, activeRoomId, activeLoaded, windowActive]);
}
