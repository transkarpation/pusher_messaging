import { createHash, randomBytes } from "node:crypto";
import type { Credentials, User } from "@pm/shared";
import { conflict, unauthorized } from "../../shared/errors.js";
import type { UsersService } from "../users/index.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { SessionsRepository } from "./sessions.repository.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A new session: the token goes to the client (in a cookie, or as a Bearer token); only its hash is stored. */
export interface Session {
  user: User;
  token: string;
  expiresAt: Date;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The auth module's facade: accounts' credentials and sessions. */
export class AuthService {
  constructor(
    private readonly sessions: SessionsRepository,
    private readonly users: UsersService,
  ) {}

  /** Creates the account (username stored lowercase) and signs in. */
  async register(input: Credentials): Promise<Session> {
    const user = await this.users.create(input.username.toLowerCase(), await hashPassword(input.password));
    if (!user) throw conflict("Username is already taken");
    return this.startSession(user);
  }

  async login(input: Credentials): Promise<Session> {
    const found = await this.users.findCredentials(input.username.toLowerCase());
    if (!found || !(await verifyPassword(input.password, found.passwordHash))) {
      throw unauthorized("Invalid username or password");
    }
    return this.startSession(found.user);
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.sessions.delete(hashToken(token));
  }

  /** The user a session token belongs to, or null if it's unknown or expired. */
  async authenticate(token: string): Promise<User | null> {
    const userId = await this.sessions.findUserId(hashToken(token), new Date());
    return userId === null ? null : this.users.getById(userId);
  }

  private async startSession(user: User): Promise<Session> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.sessions.create(hashToken(token), user.id, expiresAt);
    return { user, token, expiresAt };
  }
}
