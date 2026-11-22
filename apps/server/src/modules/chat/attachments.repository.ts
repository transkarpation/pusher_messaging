import { and, asc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { schema } from "../../db/index.js";
import { executorOf, type DbExecutor, type TxScope } from "../../shared/transaction.js";

const { attachments, attachmentData, messages } = schema;

export interface AttachmentRow {
  id: number;
  roomId: number;
  messageId: number | null;
  name: string;
  contentType: string;
  size: number;
  durationMs: number | null;
  waveform: number[] | null;
}

const attachmentColumns = {
  id: attachments.id,
  roomId: attachments.roomId,
  messageId: attachments.messageId,
  name: attachments.name,
  contentType: attachments.contentType,
  size: attachments.size,
  durationMs: attachments.durationMs,
  waveform: attachments.waveform,
};

export interface NewAttachment {
  roomId: number;
  uploaderId: number;
  name: string;
  contentType: string;
  durationMs: number | null;
  waveform: number[] | null;
  size: number;
  /** The bytes, kept in Postgres, or the key of the S3 object already holding them. */
  content: { data: Buffer } | { storageKey: string };
}

/** Where a visible attachment's bytes are: inline, or in S3 under `storageKey`. */
export interface StoredFile {
  name: string;
  contentType: string;
  data: Buffer | null;
  storageKey: string | null;
}

export interface AttachmentsRepository {
  withTx(tx: TxScope): AttachmentsRepository;
  create(input: NewAttachment): Promise<AttachmentRow>;
  /**
   * Links the uploader's not yet sent attachments in the room to a message.
   * Returns how many were linked (fewer than `ids` if some aren't theirs or are taken).
   */
  link(ids: number[], roomId: number, uploaderId: number, messageId: number): Promise<number>;
  /** Attachments of the messages, in upload order. */
  forMessages(messageIds: number[]): Promise<AttachmentRow[]>;
  /** Returns the S3 keys of the deleted attachments, for removing their objects. */
  deleteForMessage(messageId: number): Promise<string[]>;
  /**
   * Deletes the uploader's attachments never sent with a message and uploaded before `before`.
   * Returns the S3 keys of the deleted attachments.
   */
  deleteUnsent(uploaderId: number, before: Date): Promise<string[]>;
  /**
   * An attachment of the room with its bytes, if `viewerId` may see it: it's on a live
   * message, or it's their own upload that isn't sent yet.
   */
  findVisible(
    roomId: number,
    id: number,
    viewerId: number,
  ): Promise<StoredFile | null>;
}

export class DrizzleAttachmentsRepository implements AttachmentsRepository {
  constructor(private readonly db: DbExecutor) {}

  withTx(tx: TxScope) {
    return new DrizzleAttachmentsRepository(executorOf(tx));
  }

  async create({ content, ...meta }: NewAttachment) {
    return this.db.transaction(async (tx) => {
      const storageKey = "storageKey" in content ? content.storageKey : null;
      const [row] = await tx
        .insert(attachments)
        .values({ ...meta, storageKey })
        .returning(attachmentColumns);
      if ("data" in content) await tx.insert(attachmentData).values({ attachmentId: row!.id, data: content.data });
      return row!;
    });
  }

  async link(ids: number[], roomId: number, uploaderId: number, messageId: number) {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(attachments)
      .set({ messageId })
      .where(
        and(
          inArray(attachments.id, ids),
          eq(attachments.roomId, roomId),
          eq(attachments.uploaderId, uploaderId),
          isNull(attachments.messageId),
        ),
      )
      .returning({ id: attachments.id });
    return rows.length;
  }

  async forMessages(messageIds: number[]) {
    if (messageIds.length === 0) return [];
    return this.db
      .select(attachmentColumns)
      .from(attachments)
      .where(inArray(attachments.messageId, messageIds))
      .orderBy(asc(attachments.id));
  }

  async deleteForMessage(messageId: number) {
    const rows = await this.db
      .delete(attachments)
      .where(eq(attachments.messageId, messageId))
      .returning({ storageKey: attachments.storageKey });
    return storageKeys(rows);
  }

  async deleteUnsent(uploaderId: number, before: Date) {
    const rows = await this.db
      .delete(attachments)
      .where(and(eq(attachments.uploaderId, uploaderId), isNull(attachments.messageId), lt(attachments.createdAt, before)))
      .returning({ storageKey: attachments.storageKey });
    return storageKeys(rows);
  }

  async findVisible(roomId: number, id: number, viewerId: number) {
    const [row] = await this.db
      .select({
        name: attachments.name,
        contentType: attachments.contentType,
        data: attachmentData.data,
        storageKey: attachments.storageKey,
      })
      .from(attachments)
      .leftJoin(attachmentData, eq(attachmentData.attachmentId, attachments.id))
      .leftJoin(messages, eq(messages.id, attachments.messageId))
      .where(
        and(
          eq(attachments.id, id),
          eq(attachments.roomId, roomId),
          or(
            and(isNull(attachments.messageId), eq(attachments.uploaderId, viewerId)),
            and(isNotNull(attachments.messageId), isNull(messages.deletedAt)),
          ),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

const storageKeys = (rows: { storageKey: string | null }[]) =>
  rows.flatMap((r) => (r.storageKey ? [r.storageKey] : []));
