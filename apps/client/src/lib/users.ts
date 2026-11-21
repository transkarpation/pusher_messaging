import type { Message, User } from "@pm/shared";

export const displayName = (u: Pick<User, "name" | "username">) => u.name ?? u.username;

/** Placeholder for a deleted message, worded the way messengers usually do. */
export const deletedLabel = (own: boolean) => (own ? "You deleted this message" : "This message was deleted");

/** Text of a system message ("Bob joined the room"), or null for a regular message. */
export function systemText(message: Message, meId: number): string | null {
  const who = message.author.id === meId ? "You" : displayName(message.author);
  switch (message.kind) {
    case "member_joined":
      return `${who} joined the room`;
    case "member_left":
      return `${who} left the room`;
    case "text":
      return null;
  }
}
