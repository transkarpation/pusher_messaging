import { ONLINE_CHANNEL, USER_UPDATED_EVENT, type AdminUser, type SessionUser, type User } from "@pm/shared";
import { badRequest, notFound } from "../../shared/errors.js";
import { sniffImageType } from "../../shared/images.js";
import type { RealtimePublisher } from "../realtime/index.js";
import type {
  AccountsQuery,
  AdminUserChanges,
  AdminUserRow,
  Avatar,
  NewUser,
  UserCredentials,
  UsersRepository,
} from "./users.repository.js";

const SEARCH_LIMIT = 20;

const sessionUserOf = ({ id, username, name, avatarUrl, role }: SessionUser): SessionUser => ({
  id,
  username,
  name,
  avatarUrl,
  role,
});
const publicUserOf = ({ id, username, name, avatarUrl }: User): User => ({ id, username, name, avatarUrl });

/** The users module's facade: accounts, profiles and avatars. */
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** A sign-up: a plain user. Null if the username is taken. */
  async create(username: string, passwordHash: string): Promise<SessionUser | null> {
    const user = await this.users.create({ username, passwordHash });
    return user && sessionUserOf(user);
  }

  /** The user of a session, with their role. */
  getSessionUser(id: number): Promise<SessionUser | null> {
    return this.users.findSessionUser(id);
  }

  // ---- Administration (rules about who may do what are in the admin module) ----

  /** An account created by an admin. Null if the username is taken. */
  async createAccount(input: NewUser): Promise<AdminUser | null> {
    const user = await this.users.create(input);
    return user && (await this.toAdminUsers([user]))[0]!;
  }

  async listAccounts(q: AccountsQuery): Promise<{ users: AdminUser[]; total: number }> {
    const { rows, total } = await this.users.listAccounts(q);
    return { users: await this.toAdminUsers(rows), total };
  }

  async getAccount(id: number): Promise<AdminUser | null> {
    const user = await this.users.findAdminUser(id);
    return user && (await this.toAdminUsers([user]))[0]!;
  }

  async updateAccount(id: number, changes: AdminUserChanges): Promise<AdminUser> {
    const user = await this.users.updateAdmin(id, changes);
    if (changes.name !== undefined) this.announce(publicUserOf(user));
    return (await this.toAdminUsers([user]))[0]!;
  }

  private async toAdminUsers(rows: AdminUserRow[]): Promise<AdminUser[]> {
    const creators = await this.getByIds(rows.flatMap((r) => (r.createdById === null ? [] : [r.createdById])));
    return rows.map(({ createdAt, createdById, ...user }) => ({
      ...sessionUserOf(user),
      createdAt: createdAt.toISOString(),
      createdBy: createdById === null ? null : (creators.get(createdById) ?? null),
    }));
  }

  async getById(id: number): Promise<User | null> {
    const [user] = await this.users.findByIds([id]);
    return user ?? null;
  }

  /** Users by id (missing ids are left out), for attaching people to rooms, messages and invites. */
  async getByIds(ids: Iterable<number>): Promise<Map<number, User>> {
    const found = await this.users.findByIds([...new Set(ids)]);
    return new Map(found.map((u) => [u.id, u]));
  }

  /** Ids among `ids` that belong to existing users other than `exclude`, deduplicated. */
  async existingIds(ids: number[], exclude: number): Promise<number[]> {
    const wanted = [...new Set(ids)].filter((id) => id !== exclude);
    return [...(await this.getByIds(wanted)).keys()];
  }

  async findCredentials(username: string): Promise<UserCredentials | null> {
    const [found] = await this.users.findCredentials([username]);
    return found ?? null;
  }

  findManyCredentials(usernames: string[]): Promise<UserCredentials[]> {
    return this.users.findCredentials(usernames);
  }

  search(query: string, me: User): Promise<User[]> {
    return this.users.search(query, me.id, SEARCH_LIMIT);
  }

  async updateName(userId: number, name: string): Promise<User> {
    return this.announce(await this.users.updateName(userId, name));
  }

  /** Stores a PNG, JPEG or WebP avatar; the type is taken from the bytes, not the request. */
  async setAvatar(userId: number, data: unknown): Promise<User> {
    const contentType = Buffer.isBuffer(data) ? sniffImageType(data) : null;
    if (!contentType) throw badRequest("Upload a PNG, JPEG or WebP image");
    return this.announce(await this.users.setAvatar(userId, { contentType, data: data as Buffer }));
  }

  async removeAvatar(userId: number): Promise<User> {
    return this.announce(await this.users.removeAvatar(userId));
  }

  async getAvatar(userId: number): Promise<Avatar> {
    const avatar = await this.users.findAvatar(userId);
    if (!avatar) throw notFound("Not found");
    return avatar;
  }

  /** Presence user_info is fixed at subscribe time, so profile changes are broadcast to everyone. */
  private announce(user: User): User {
    this.realtime.publish(ONLINE_CHANNEL, USER_UPDATED_EVENT, user);
    return user;
  }
}
