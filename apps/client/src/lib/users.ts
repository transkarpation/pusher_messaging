import { systemMessageText, type Message, type User } from "@pm/shared";
import { attachmentSummary } from "./files";

export const displayName = (u: Pick<User, "name" | "username">) => u.name ?? u.username;

/** Placeholder for a deleted message, worded the way messengers usually do. */
export const deletedLabel = (own: boolean) => (own ? "You deleted this message" : "This message was deleted");

/** Text of a system message ("Bob joined the room"), or null for a regular message. */
export const systemText = (message: Message, meId: number): string | null =>
  systemMessageText(message, message.author.id === meId ? "You" : displayName(message.author));

/** The text of a regular message (or a summary of its files when it has no text), or a poll's question. */
export const messagePreview = (message: Pick<Message, "text" | "attachments" | "poll">) =>
  message.poll ? `📊 ${message.poll.question}` : message.text || attachmentSummary(message.attachments);
