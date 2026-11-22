import type { RoomMember } from "@pm/shared";
import { displayName } from "../lib/users";
import { useBlocks } from "../store/blocks";
import { NO_TYPERS, useTyping } from "../store/typing";

export function TypingIndicator({ roomId, members }: { roomId: number; members: RoomMember[] }) {
  const userIds = useTyping((s) => s.byRoom[roomId] ?? NO_TYPERS);
  const blocked = useBlocks((s) => s.ids);

  const names = userIds
    .filter((id) => !blocked.has(id))
    .map((id) => members.find((m) => m.user.id === id)?.user)
    .filter((u) => u !== undefined)
    .map(displayName);

  let text = "";
  if (names.length === 1) text = `${names[0]} is typing…`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
  else if (names.length > 2) text = "Several people are typing…";

  // Always rendered to reserve the line and avoid layout jumps.
  return (
    <p className="typing muted" aria-live="polite">
      {text}
    </p>
  );
}
