import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { AvatarContentType } from "@pm/shared";
import { schema } from "../db/index.js";

type UserTableColumns = Record<"id" | "username" | "name" | "avatarUpdatedAt", AnyPgColumn>;
type UserColumns<T extends UserTableColumns> = Pick<T, "id" | "username" | "name"> & { avatarUrl: SQL<string | null> };

/**
 * Columns that make up a `User`, for `users` or an alias of it.
 * `avatarUrl` carries the upload time, so a new avatar gets a new URL and can be cached forever.
 */
export const userColumnsOf = <T extends UserTableColumns>(t: T): UserColumns<T> => ({
  id: t.id,
  username: t.username,
  name: t.name,
  avatarUrl: sql<string | null>`case when ${t.avatarUpdatedAt} is null then null
    else '/api/users/' || ${t.id} || '/avatar?v=' || floor(extract(epoch from ${t.avatarUpdatedAt}) * 1000)::bigint end`,
});

export const userColumns = userColumnsOf(schema.users);

/** Detects the image type from its first bytes; null if it's none of the accepted ones. */
export function sniffImageType(data: Buffer): AvatarContentType | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}
