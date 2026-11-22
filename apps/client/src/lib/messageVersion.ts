import type { Message } from "@pm/shared";

/** Deletion is final and outranks any edit; otherwise the later edit wins. */
const rank = (m: Message) =>
  m.deletedAt ? Number.POSITIVE_INFINITY : m.editedAt ? Date.parse(m.editedAt) : 0;

/**
 * Of two copies of the same message, the more recent one, so a stale fetch or an
 * out-of-order event can't undo an edit, a deletion or a poll's votes. On a tie, `b` wins.
 */
export const latestVersion = (a: Message, b: Message): Message => {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return rb > ra ? b : a;
  return a.poll && b.poll && a.poll.version > b.poll.version ? a : b;
};
