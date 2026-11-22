import { systemMessageText, type Message, type User } from "@pm/shared";

export const displayName = (u: Pick<User, "name" | "username">) => u.name ?? u.username;

export const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** One line for the room list, like the web client's sidebar. */
export function preview(m: Message, meId: number): string {
  const who = m.author.id === meId ? "You" : displayName(m.author);
  const system = systemMessageText(m, who);
  if (system) return system;
  if (m.deletedAt) return m.author.id === meId ? "You deleted this message" : "This message was deleted";
  const files = m.attachments.length === 0 ? "" : m.attachments.length === 1 ? `📎 ${m.attachments[0]!.name}` : `📎 ${m.attachments.length} files`;
  return `${who}: ${m.poll ? `📊 ${m.poll.question}` : m.text || files}`;
}
