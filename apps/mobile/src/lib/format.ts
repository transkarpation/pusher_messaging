import type { Message, User } from "@pm/shared";

export const displayName = (u: Pick<User, "name" | "username">) => u.name ?? u.username;

export const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** One line for the room list, like the web client's sidebar. */
export function preview(m: Message, meId: number): string {
  const who = m.author.id === meId ? "You" : displayName(m.author);
  if (m.kind === "member_joined") return `${who} joined the room`;
  if (m.kind === "member_left") return `${who} left the room`;
  if (m.deletedAt) return m.author.id === meId ? "You deleted this message" : "This message was deleted";
  const files = m.attachments.length === 0 ? "" : m.attachments.length === 1 ? `📎 ${m.attachments[0]!.name}` : `📎 ${m.attachments.length} files`;
  return `${who}: ${m.text || files}`;
}
