import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { AdminUserSortField, AvatarContentType, Role, SessionUser, User } from "@pm/shared";
import { schema } from "../../db/index.js";
import type { DbExecutor } from "../../shared/transaction.js";

const { users, userAvatars } = schema;

/**
 * `avatarUrl` carries the upload time, so a new avatar gets a new URL and can be cached forever.
 */
const avatarUrl: SQL<string | null> = sql<string | null>`case when ${users.avatarUpdatedAt} is null then null
  else '/api/users/' || ${users.id} || '/avatar?v=' || floor(extract(epoch from ${users.avatarUpdatedAt}) * 1000)::bigint end`;

const userColumns = { id: users.id, username: users.username, name: users.name, avatarUrl };
const sessionUserColumns = { ...userColumns, role: users.role };
const adminUserColumns = { ...sessionUserColumns, createdAt: users.createdAt, createdById: users.createdBy };

export interface UserCredentials {
  user: SessionUser;
  passwordHash: string;
}

/** An account as the administration page sees it; `createdById` is resolved to a `User` by the service. */
export interface AdminUserRow extends SessionUser {
  createdAt: Date;
  createdById: number | null;
}

export interface NewUser {
  username: string;
  passwordHash: string;
  name?: string | null;
  role?: Role;
  createdBy?: number | null;
}

export interface AccountsQuery {
  roles: Role[];
  query: string;
  sort: AdminUserSortField;
  order: "asc" | "desc";
  limit: number;
  offset: number;
}

export interface AdminUserChanges {
  name?: string | null;
  role?: Role;
  passwordHash?: string;
}

const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export interface Avatar {
  contentType: string;
  data: Buffer;
}

export interface UsersRepository {
  /** Null if the username is taken. */
  create(input: NewUser): Promise<AdminUserRow | null>;
  findByIds(ids: number[]): Promise<User[]>;
  findSessionUser(id: number): Promise<SessionUser | null>;
  /** A page of accounts with one of `roles` matching `query` by username or name, and how many match in all. */
  listAccounts(q: AccountsQuery): Promise<{ rows: AdminUserRow[]; total: number }>;
  findAdminUser(id: number): Promise<AdminUserRow | null>;
  updateAdmin(id: number, changes: AdminUserChanges): Promise<AdminUserRow>;
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

  async create(input: NewUser) {
    const [user] = await this.db
      .insert(users)
      .values(input)
      .onConflictDoNothing({ target: users.username })
      .returning(adminUserColumns);
    return user ?? null;
  }

  async findSessionUser(id: number) {
    const [user] = await this.db.select(sessionUserColumns).from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  async listAccounts({ roles, query, sort, order, limit, offset }: AccountsQuery) {
    if (roles.length === 0) return { rows: [], total: 0 };
    const pattern = likePattern(query);
    const where = and(
      inArray(users.role, roles),
      query ? or(ilike(users.username, pattern), ilike(users.name, pattern)) : undefined,
    );
    const dir = order === "asc" ? asc : desc;
    // Accounts without a name go last either way; usernames are unique, so the order is total.
    // Names sort by ICU Ukrainian rules (Cyrillic in alphabet order, Latin first), not by the
    // database's collation, which on Alpine images compares bytes and misplaces letters like «І».
    const orderBy =
      sort === "name"
        ? [sql`${users.name} is null`, dir(sql`${users.name} collate "uk-UA-x-icu"`), asc(users.username)]
        : sort === "username"
          ? [dir(users.username)]
          : [dir(sort === "role" ? users.role : users.createdAt), asc(users.username)];
    const [rows, [counted]] = await Promise.all([
      this.db.select(adminUserColumns).from(users).where(where).orderBy(...orderBy).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(users).where(where),
    ]);
    return { rows, total: counted?.total ?? 0 };
  }

  async findAdminUser(id: number) {
    const [user] = await this.db.select(adminUserColumns).from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  async updateAdmin(id: number, changes: AdminUserChanges) {
    const [user] = await this.db.update(users).set(changes).where(eq(users.id, id)).returning(adminUserColumns);
    return user!;
  }

  async findByIds(ids: number[]) {
    if (ids.length === 0) return [];
    return this.db.select(userColumns).from(users).where(inArray(users.id, ids));
  }

  async findCredentials(usernames: string[]) {
    if (usernames.length === 0) return [];
    const rows = await this.db
      .select({ ...sessionUserColumns, passwordHash: users.passwordHash })
      .from(users)
      .where(inArray(users.username, usernames));
    return rows.map(({ passwordHash, ...user }) => ({ user, passwordHash }));
  }

  async search(query: string, excludeId: number, limit: number) {
    const pattern = likePattern(query);
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
