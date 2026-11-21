import type { User } from "@pm/shared";

export const displayName = (u: Pick<User, "name" | "username">) => u.name ?? u.username;
