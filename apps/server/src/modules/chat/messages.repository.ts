import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { SYSTEM_MESSAGE_KINDS, type MessageKind, type Receipt } from "@pm/shared";
import { schema } from "../../db/index.js";
import { executorOf, type DbExecutor, type TxScope } from "../../shared/transaction.js";

const { messages, receipts } = schema;

/** Kinds someone wrote, as opposed to system lines: they count as unread and can be deleted. */
const AUTHORED_KINDS: MessageKind[] = ["text", "poll"];
const SYSTEM_KINDS: MessageKind[] = [...SYSTEM_MESSAGE_KINDS];

/** A message as stored: the author is an id, attached by the service. */
export interface MessageRow {
  id: number;
  roomId: number;
  userId: number;
  kind: MessageKind;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

const messageColumns = {
  id: messages.id,
  roomId: messages.roomId,
  userId: messages.userId,
  kind: messages.kind,
  text: messages.text,
  createdAt: messages.createdAt,
  editedAt: messages.editedAt,
  deletedAt: messages.deletedAt,
};

const receiptColumns = {
  roomId: receipts.roomId,
  userId: receipts.userId,
  deliveredUpTo: receipts.deliveredUpTo,
  readUpTo: receipts.readUpTo,
};

export interface PageCursor {
  /** Messages with id < before (newest of them). */
  before?: number;
  /** Messages with id > after (oldest of them). */
  after?: number;
}

export interface MessagesRepository {
  withTx(tx: TxScope): MessagesRepository;
  /** Up to `size` messages by the cursor, in id order, and whether more lie past them. */
  page(roomId: number, cursor: PageCursor, size: number): Promise<{ rows: MessageRow[]; hasMore: boolean }>;
  create(roomId: number, userId: number, kind: MessageKind, text: string): Promise<MessageRow>;
  /**
   * Changes a live (not deleted, not a system line) message, optionally only if `onlyAuthorId`
   * wrote it. Only text messages can be edited; polls can be deleted. Null if nothing matched.
   */
  updateLive(
    roomId: number,
    messageId: number,
    onlyAuthorId: number | null,
    change: { type: "edit"; text: string } | { type: "delete" },
  ): Promise<MessageRow | null>;
  /** Author and kind of a live (not deleted, not system) message in the room, or null if there is none. */
  live(roomId: number, messageId: number): Promise<{ userId: number; kind: MessageKind } | null>;
  /** Latest message per room, skipping messages written by `hiddenAuthorIds`. */
  latest(roomIds: number[], hiddenAuthorIds: number[]): Promise<MessageRow[]>;
  /**
   * Per room: live text messages and polls by others (not `hiddenAuthorIds`) newer than the user's read watermark.
   */
  unreadCounts(userId: number, roomIds: number[], hiddenAuthorIds: number[]): Promise<Map<number, number>>;
  roomReceipts(roomId: number): Promise<Receipt[]>;
  userReceipts(userId: number, roomIds: number[]): Promise<Receipt[]>;
  /** Moves watermarks forward only, capped at the room's newest message. */
  advanceReceipt(roomId: number, userId: number, deliveredUpTo: number, readUpTo: number): Promise<Receipt>;
}

export class DrizzleMessagesRepository implements MessagesRepository {
  constructor(private readonly db: DbExecutor) {}

  withTx(tx: TxScope) {
    return new DrizzleMessagesRepository(executorOf(tx));
  }

  async page(roomId: number, { before, after }: PageCursor, size: number) {
    const forward = after !== undefined;
    const rows = await this.db
      .select(messageColumns)
      .from(messages)
      .where(
        and(
          eq(messages.roomId, roomId),
          before !== undefined ? lt(messages.id, before) : undefined,
          after !== undefined ? gt(messages.id, after) : undefined,
        ),
      )
      // Backwards (latest page, `before`): newest first, reversed below. Forward: oldest first.
      .orderBy(forward ? asc(messages.id) : desc(messages.id))
      // One extra row tells whether there's more beyond this page.
      .limit(size + 1);
    const hasMore = rows.length > size;
    const page = rows.slice(0, size);
    if (!forward) page.reverse();
    return { rows: page, hasMore };
  }

  async create(roomId: number, userId: number, kind: MessageKind, text: string) {
    const [row] = await this.db.insert(messages).values({ roomId, userId, kind, text }).returning(messageColumns);
    return row!;
  }

  async updateLive(
    roomId: number,
    messageId: number,
    onlyAuthorId: number | null,
    change: { type: "edit"; text: string } | { type: "delete" },
  ) {
    const [row] = await this.db
      .update(messages)
      .set(change.type === "edit" ? { text: change.text, editedAt: sql`now()` } : { text: "", deletedAt: sql`now()` })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.roomId, roomId),
          change.type === "edit" ? eq(messages.kind, "text") : inArray(messages.kind, AUTHORED_KINDS),
          isNull(messages.deletedAt),
          onlyAuthorId === null ? undefined : eq(messages.userId, onlyAuthorId),
        ),
      )
      .returning(messageColumns);
    return row ?? null;
  }

  async live(roomId: number, messageId: number) {
    const [row] = await this.db
      .select({ userId: messages.userId, kind: messages.kind })
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.roomId, roomId),
          inArray(messages.kind, AUTHORED_KINDS),
          isNull(messages.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async latest(roomIds: number[], hiddenAuthorIds: number[]) {
    if (roomIds.length === 0) return [];
    return (
      this.db
        .selectDistinctOn([messages.roomId], messageColumns)
        .from(messages)
        // System lines stay visible even when they're about a hidden author.
        .where(
          and(
            inArray(messages.roomId, roomIds),
            or(inArray(messages.kind, SYSTEM_KINDS), notInArray(messages.userId, hiddenAuthorIds)),
          ),
        )
        .orderBy(messages.roomId, desc(messages.id))
    );
  }

  async unreadCounts(userId: number, roomIds: number[], hiddenAuthorIds: number[]) {
    if (roomIds.length === 0) return new Map<number, number>();
    const rows = await this.db
      .select({ roomId: messages.roomId, count: count() })
      .from(messages)
      .leftJoin(receipts, and(eq(receipts.roomId, messages.roomId), eq(receipts.userId, userId)))
      .where(
        and(
          inArray(messages.roomId, roomIds),
          ne(messages.userId, userId),
          notInArray(messages.userId, hiddenAuthorIds),
          inArray(messages.kind, AUTHORED_KINDS),
          isNull(messages.deletedAt),
          gt(messages.id, sql`coalesce(${receipts.readUpTo}, 0)`),
        ),
      )
      .groupBy(messages.roomId);
    return new Map(rows.map((r) => [r.roomId, r.count]));
  }

  async roomReceipts(roomId: number) {
    return this.db.select(receiptColumns).from(receipts).where(eq(receipts.roomId, roomId));
  }

  async userReceipts(userId: number, roomIds: number[]) {
    if (roomIds.length === 0) return [];
    return this.db
      .select(receiptColumns)
      .from(receipts)
      .where(and(eq(receipts.userId, userId), inArray(receipts.roomId, roomIds)));
  }

  async advanceReceipt(roomId: number, userId: number, deliveredUpTo: number, readUpTo: number) {
    const maxId = sql`(select coalesce(max(${messages.id}), 0) from ${messages} where ${messages.roomId} = ${roomId})`;
    const [row] = await this.db
      .insert(receipts)
      .values({
        roomId,
        userId,
        deliveredUpTo: sql`least(${deliveredUpTo}::int, ${maxId})`,
        readUpTo: sql`least(${readUpTo}::int, ${maxId})`,
      })
      .onConflictDoUpdate({
        target: [receipts.roomId, receipts.userId],
        set: {
          deliveredUpTo: sql`greatest(${receipts.deliveredUpTo}, excluded.delivered_up_to)`,
          readUpTo: sql`greatest(${receipts.readUpTo}, excluded.read_up_to)`,
          updatedAt: sql`now()`,
        },
      })
      .returning(receiptColumns);
    return row!;
  }
}
