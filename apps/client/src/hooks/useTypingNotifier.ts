import { useCallback, useEffect, useRef } from "react";
import { api } from "../api";

/** Re-send "typing" at most this often while the user keeps typing. */
const TYPING_THROTTLE_MS = 2000;

/** Throttled "typing" notifications for one room, relayed by the server over the realtime connection. */
export function useTypingNotifier(roomId: number) {
  const lastSentAt = useRef(0);

  const send = useCallback(
    (typing: boolean) =>
      api.sendTyping(roomId, { typing }).catch((err) => console.error("Failed to send typing:", err)),
    [roomId],
  );

  const stop = useCallback(() => {
    if (lastSentAt.current === 0) return;
    lastSentAt.current = 0;
    void send(false);
  }, [send]);

  const onInput = useCallback(
    (value: string) => {
      if (!value.trim()) return stop();
      const now = Date.now();
      if (now - lastSentAt.current >= TYPING_THROTTLE_MS) {
        lastSentAt.current = now;
        void send(true);
      }
    },
    [send, stop],
  );

  // Leaving the room (or unmounting) ends typing there.
  useEffect(() => stop, [stop]);

  return { onInput, stop };
}
