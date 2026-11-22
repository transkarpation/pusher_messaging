import { and, desc, eq } from "drizzle-orm";
import { schema } from "../../db/index.js";
import type { DbExecutor } from "../../shared/transaction.js";

const { userBlocks } = schema;

export interface BlocksRepository {
  /** Ids the user blocked, most recently blocked first. */
  blockedIds(blockerId: number): Promise<number[]>;
  /** No-op if already blocked. */
  add(blockerId: number, blockedId: number): Promise<void>;
  remove(blockerId: number, blockedId: number): Promise<void>;
}

export class DrizzleBlocksRepository implements BlocksRepository {
  constructor(private readonly db: DbExecutor) {}

  async blockedIds(blockerId: number) {
    const rows = await this.db
      .select({ id: userBlocks.blockedId })
      .from(userBlocks)
      .where(eq(userBlocks.blockerId, blockerId))
      .orderBy(desc(userBlocks.createdAt));
    return rows.map((r) => r.id);
  }

  async add(blockerId: number, blockedId: number) {
    await this.db.insert(userBlocks).values({ blockerId, blockedId }).onConflictDoNothing();
  }

  async remove(blockerId: number, blockedId: number) {
    await this.db
      .delete(userBlocks)
      .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)));
  }
}
