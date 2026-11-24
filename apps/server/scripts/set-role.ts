/**
 * Gives an existing account a role. The only way to make the first superadmin, since the
 * administration page only hands out roles below the caller's own:
 *
 *   pnpm db:set-role <username> <user|admin|superadmin>
 */
import { eq } from "drizzle-orm";
import { ROLES, type Role } from "@pm/shared";
import { db, schema } from "../src/db/index.js";

async function main() {
  const [username, role] = process.argv.slice(2);
  if (!username || !role || !(ROLES as readonly string[]).includes(role)) {
    throw new Error(`Usage: pnpm db:set-role <username> <${ROLES.join("|")}>`);
  }
  const [user] = await db
    .update(schema.users)
    .set({ role: role as Role })
    .where(eq(schema.users.username, username.toLowerCase()))
    .returning({ id: schema.users.id, username: schema.users.username, role: schema.users.role });
  if (!user) throw new Error(`No user named "${username}"`);
  console.log(`@${user.username} (id ${user.id}) is now ${user.role}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
