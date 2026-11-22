import { and, eq, gt } from "drizzle-orm";
import { schema } from "../../db/index.js";
import type { DbExecutor } from "../../shared/transaction.js";

const { sessions } = schema;

export interface SessionsRepository {
  create(idHash: string, userId: number, expiresAt: Date): Promise<void>;
  delete(idHash: string): Promise<void>;
  /** The user of an unexpired session, or null. */
  findUserId(idHash: string, now: Date): Promise<number | null>;
}

export class DrizzleSessionsRepository implements SessionsRepository {
  constructor(private readonly db: DbExecutor) {}

  async create(idHash: string, userId: number, expiresAt: Date) {
    await this.db.insert(sessions).values({ id: idHash, userId, expiresAt });
  }

  async delete(idHash: string) {
    await this.db.delete(sessions).where(eq(sessions.id, idHash));
  }

  async findUserId(idHash: string, now: Date) {
    const [row] = await this.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.id, idHash), gt(sessions.expiresAt, now)))
      .limit(1);
    return row?.userId ?? null;
  }
}
