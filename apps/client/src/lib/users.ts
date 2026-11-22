import type { Message, User } from "@pm/shared";
import { attachmentSummary } from "./files";

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

/** The text of a regular message, or a summary of its files when it has no text. */
export const messagePreview = (message: Pick<Message, "text" | "attachments">) =>
  message.text || attachmentSummary(message.attachments);
