import { Router } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import type { SeedAccount, SeedsResponse } from "@pm/shared";
import { db, schema } from "../db/index.js";
import { DEMO_PASSWORD, DEMO_USERNAMES, DEMO_USERS } from "../lib/demo.js";
import { verifyPassword } from "../lib/password.js";

const { users, rooms, roomMembers } = schema;

/**
 * Public (no login) list of the demo accounts from `pnpm db:seed`, with their password.
 * Not served when NODE_ENV=production: it hands out working credentials.
 */
export const seedsRouter = Router();

seedsRouter.get("/", async (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const rows = await db
    .select({ id: users.id, username: users.username, name: users.name, passwordHash: users.passwordHash })
    .from(users)
    .where(inArray(users.username, DEMO_USERNAMES));

  // Only accounts that still have the demo password: someone may have registered "olena" by hand.
  // The seed gives all accounts the same hash, so this is usually a single (slow, scrypt) check.
  const checked = new Map<string, Promise<boolean>>();
  const isDemo = (hash: string) => {
    if (!checked.has(hash)) checked.set(hash, verifyPassword(DEMO_PASSWORD, hash));
    return checked.get(hash)!;
  };
  const verified = await Promise.all(rows.map(async (r) => ((await isDemo(r.passwordHash)) ? r : null)));
  const demo = verified.filter((r) => r !== null);

  const memberships =
    demo.length === 0
      ? []
      : await db
          .select({ userId: roomMembers.userId, room: rooms.name })
          .from(roomMembers)
          .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
          .where(inArray(roomMembers.userId, demo.map((r) => r.id)))
          .orderBy(asc(rooms.id));

  // In the order of DEMO_USERS, not the database's.
  const accounts: SeedAccount[] = DEMO_USERS.flatMap((spec) => {
    const row = demo.find((r) => r.username === spec.username);
    if (!row) return [];
    return [
      {
        id: row.id,
        username: row.username,
        name: row.name,
        password: DEMO_PASSWORD,
        rooms: memberships.filter((m) => m.userId === row.id).map((m) => m.room),
        note: spec.note,
      },
    ];
  });

  const body: SeedsResponse = { accounts };
  res.json(body);
});
