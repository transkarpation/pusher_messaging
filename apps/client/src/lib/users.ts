import type { User } from "@pm/shared";

export const displayName = (u: Pick<User, "name" | "username">) => u.name ?? u.username;

/** Placeholder for a deleted message, worded the way messengers usually do. */
export const deletedLabel = (own: boolean) => (own ? "You deleted this message" : "This message was deleted");
