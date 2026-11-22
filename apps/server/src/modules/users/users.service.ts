import { ONLINE_CHANNEL, USER_UPDATED_EVENT, type AvatarContentType, type User } from "@pm/shared";
import { badRequest, notFound } from "../../shared/errors.js";
import type { RealtimePublisher } from "../realtime/index.js";
import type { Avatar, UserCredentials, UsersRepository } from "./users.repository.js";

const SEARCH_LIMIT = 20;

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

/** The users module's facade: accounts, profiles and avatars. */
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** Null if the username is taken. */
  create(username: string, passwordHash: string): Promise<User | null> {
    return this.users.create(username, passwordHash);
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
