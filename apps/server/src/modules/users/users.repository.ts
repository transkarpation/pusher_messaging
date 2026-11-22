import { and, asc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { AvatarContentType, User } from "@pm/shared";
import { schema } from "../../db/index.js";
import type { DbExecutor } from "../../shared/transaction.js";

const { users, userAvatars } = schema;

/**
 * `avatarUrl` carries the upload time, so a new avatar gets a new URL and can be cached forever.
 */
const avatarUrl: SQL<string | null> = sql<string | null>`case when ${users.avatarUpdatedAt} is null then null
  else '/api/users/' || ${users.id} || '/avatar?v=' || floor(extract(epoch from ${users.avatarUpdatedAt}) * 1000)::bigint end`;

const userColumns = { id: users.id, username: users.username, name: users.name, avatarUrl };

export interface UserCredentials {
  user: User;
  passwordHash: string;
}

export interface Avatar {
  contentType: string;
  data: Buffer;
}

export interface UsersRepository {
  /** Null if the username is taken. */
  create(username: string, passwordHash: string): Promise<User | null>;
  findByIds(ids: number[]): Promise<User[]>;
  findCredentials(usernames: string[]): Promise<UserCredentials[]>;
  /** Other users matching `query` by username or name (case-insensitive), by username. */
  search(query: string, excludeId: number, limit: number): Promise<User[]>;
  updateName(id: number, name: string): Promise<User>;
  setAvatar(id: number, avatar: { contentType: AvatarContentType; data: Buffer }): Promise<User>;
  removeAvatar(id: number): Promise<User>;
  findAvatar(id: number): Promise<Avatar | null>;
}

export class DrizzleUsersRepository implements UsersRepository {
  constructor(private readonly db: DbExecutor) {}

  async create(username: string, passwordHash: string) {
    const [user] = await this.db
      .insert(users)
      .values({ username, passwordHash })
      .onConflictDoNothing({ target: users.username })
      .returning(userColumns);
    return user ?? null;
  }

  async findByIds(ids: number[]) {
    if (ids.length === 0) return [];
    return this.db.select(userColumns).from(users).where(inArray(users.id, ids));
  }

  async findCredentials(usernames: string[]) {
    if (usernames.length === 0) return [];
    const rows = await this.db
      .select({ ...userColumns, passwordHash: users.passwordHash })
      .from(users)
      .where(inArray(users.username, usernames));
    return rows.map(({ passwordHash, ...user }) => ({ user, passwordHash }));
  }

  async search(query: string, excludeId: number, limit: number) {
    const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.db
      .select(userColumns)
      .from(users)
      .where(
        and(
          ne(users.id, excludeId),
          query ? or(ilike(users.username, pattern), ilike(users.name, pattern)) : undefined,
        ),
      )
      .orderBy(asc(users.username))
      .limit(limit);
  }

  async updateName(id: number, name: string) {
    const [user] = await this.db.update(users).set({ name }).where(eq(users.id, id)).returning(userColumns);
    return user!;
  }

  async setAvatar(id: number, { contentType, data }: { contentType: AvatarContentType; data: Buffer }) {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(userAvatars)
        .values({ userId: id, contentType, data })
        .onConflictDoUpdate({ target: userAvatars.userId, set: { contentType, data } });
      const [user] = await tx
        .update(users)
        .set({ avatarUpdatedAt: new Date() })
        .where(eq(users.id, id))
        .returning(userColumns);
      return user!;
    });
  }

  async removeAvatar(id: number) {
    return this.db.transaction(async (tx) => {
      await tx.delete(userAvatars).where(eq(userAvatars.userId, id));
      const [user] = await tx
        .update(users)
        .set({ avatarUpdatedAt: null })
        .where(eq(users.id, id))
        .returning(userColumns);
      return user!;
    });
  }

  async findAvatar(id: number) {
    const [avatar] = await this.db
      .select({ contentType: userAvatars.contentType, data: userAvatars.data })
      .from(userAvatars)
      .where(eq(userAvatars.userId, id))
      .limit(1);
    return avatar ?? null;
  }
}
