import { Router, type Response } from "express";
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import {
  MESSAGES_PAGE_SIZE,
  MESSAGE_CREATED_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_UPDATED_EVENT,
  RECEIPT_UPDATED_EVENT,
  createMessageSchema,
  messagesQuerySchema,
  roomChannel,
  updateMessageSchema,
  updateReceiptSchema,
  type Message,
  type MessagesResponse,
  type Receipt,
} from "@pm/shared";
import { db, schema } from "../db/index.js";
import { broadcast } from "../lib/pusher.js";
import { messageColumns, toMessage } from "../lib/rooms.js";
import { parseBody } from "../lib/validate.js";

/** Mounted under /api/rooms/:roomId after `requireRoomMember`, so `req.room` is set. */
export const messagesRouter = Router();

const receiptColumns = {
  roomId: schema.receipts.roomId,
  userId: schema.receipts.userId,
  deliveredUpTo: schema.receipts.deliveredUpTo,
  readUpTo: schema.receipts.readUpTo,
};

messagesRouter.get("/messages", async (req, res) => {
  const query = parseBody(messagesQuerySchema, req.query, res);
  if (!query) return;
  const roomId = req.room!.id;
  const { before, after } = query;
  const { messages } = schema;
  const forward = after !== undefined;

  const [rows, receipts] = await Promise.all([
    db
      .select(messageColumns)
      .from(messages)
      .innerJoin(schema.users, eq(schema.users.id, messages.userId))
      .where(
        and(
          eq(messages.roomId, roomId),
          before !== undefined ? lt(messages.id, before) : undefined,
          after !== undefined ? gt(messages.id, after) : undefined,
        ),
      )
      // Backwards (latest page, `before`): newest first, reversed below. Catch-up: oldest after `after` first.
      .orderBy(forward ? asc(messages.id) : desc(messages.id))
      // One extra row tells whether there's more beyond this page.
      .limit(MESSAGES_PAGE_SIZE + 1),
    db.select(receiptColumns).from(schema.receipts).where(eq(schema.receipts.roomId, roomId)),
  ]);

  const hasMore = rows.length > MESSAGES_PAGE_SIZE;
  const page = rows.slice(0, MESSAGES_PAGE_SIZE);
  if (!forward) page.reverse();
  const body: MessagesResponse = { messages: page.map(toMessage), receipts, hasMore };
  res.json(body);
});

messagesRouter.post("/messages", async (req, res) => {
  const input = parseBody(createMessageSchema, req.body, res);
  if (!input) return;
  const user = req.user!;
  const roomId = req.room!.id;

  const [row] = await db
    .insert(schema.messages)
    .values({ roomId, userId: user.id, text: input.text })
    .returning();

  const message: Message = {
    id: row!.id,
    roomId,
    kind: "text",
    text: row!.text,
    createdAt: row!.createdAt.toISOString(),
    editedAt: null,
    deletedAt: null,
    author: user,
  };
  res.status(201).json(message);
  // The sender already has it from the response.
  broadcast(roomChannel(roomId), MESSAGE_CREATED_EVENT, message, req);
});

/** Parses `:messageId`; on failure sends 400 and returns null. */
function messageIdParam(req: { params: Record<string, string | undefined> }, res: Response) {
  const id = Number(req.params.messageId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid message id" });
    return null;
  }
  return id;
}

/** Author of a live (regular, not deleted) message in this room, or null if there is none. */
async function messageAuthor(roomId: number, messageId: number) {
  const [row] = await db
    .select({ userId: schema.messages.userId })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.id, messageId),
        eq(schema.messages.roomId, roomId),
        eq(schema.messages.kind, "text"),
        isNull(schema.messages.deletedAt),
      ),
    )
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Updates a live message in this room, returning it as a `Message`, or null if nothing matched.
 * System messages never match, so they can't be edited or deleted.
 */
async function updateMessage(
  roomId: number,
  messageId: number,
  onlyAuthorId: number | null,
  set: PgUpdateSetSource<typeof schema.messages>,
): Promise<Message | null> {
  const { messages, users } = schema;
  const [row] = await db
    .update(messages)
    .set(set)
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.roomId, roomId),
        eq(messages.kind, "text"),
        isNull(messages.deletedAt),
        onlyAuthorId === null ? undefined : eq(messages.userId, onlyAuthorId),
      ),
    )
    .returning({ id: messages.id });
  if (!row) return null;
  const [full] = await db
    .select(messageColumns)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.userId))
    .where(eq(messages.id, row.id));
  return full ? toMessage(full) : null;
}

/** Only the author may edit a message, and only while it isn't deleted. */
messagesRouter.patch("/messages/:messageId", async (req, res) => {
  const messageId = messageIdParam(req, res);
  if (!messageId) return;
  const input = parseBody(updateMessageSchema, req.body, res);
  if (!input) return;
  const roomId = req.room!.id;

  const message = await updateMessage(roomId, messageId, req.user!.id, {
    text: input.text,
    editedAt: sql`now()`,
  });
  if (!message) {
    const author = await messageAuthor(roomId, messageId);
    if (author === null) res.status(404).json({ error: "Message not found" });
    else res.status(403).json({ error: "You can only edit your own messages" });
    return;
  }
  res.json(message);
  broadcast(roomChannel(roomId), MESSAGE_UPDATED_EVENT, message, req);
});

/**
 * The author, or the room owner, may delete a message. It's kept as a placeholder
 * ("This message was deleted") with its text wiped, so the history keeps its shape.
 */
messagesRouter.delete("/messages/:messageId", async (req, res) => {
  const messageId = messageIdParam(req, res);
  if (!messageId) return;
  const { id: roomId, role } = req.room!;

  const message = await updateMessage(roomId, messageId, role === "owner" ? null : req.user!.id, {
    text: "",
    deletedAt: sql`now()`,
  });
  if (!message) {
    const author = await messageAuthor(roomId, messageId);
    if (author === null) res.status(404).json({ error: "Message not found" });
    else res.status(403).json({ error: "You can only delete your own messages" });
    return;
  }
  res.json(message);
  broadcast(roomChannel(roomId), MESSAGE_DELETED_EVENT, message, req);
});

/**
 * Moves the caller's delivered/read watermarks in this room forward (never back).
 * Read implies delivered; values are capped at the room's newest message.
 */
messagesRouter.post("/receipts", async (req, res) => {
  const input = parseBody(updateReceiptSchema, req.body, res);
  if (!input) return;
  const roomId = req.room!.id;

  const maxId = sql`(select coalesce(max(${schema.messages.id}), 0) from ${schema.messages} where ${schema.messages.roomId} = ${roomId})`;
  const read = input.readUpTo ?? 0;
  const delivered = Math.max(input.deliveredUpTo ?? 0, read);

  const [row] = await db
    .insert(schema.receipts)
    .values({
      roomId,
      userId: req.user!.id,
      deliveredUpTo: sql`least(${delivered}::int, ${maxId})`,
      readUpTo: sql`least(${read}::int, ${maxId})`,
    })
    .onConflictDoUpdate({
      target: [schema.receipts.roomId, schema.receipts.userId],
      set: {
        deliveredUpTo: sql`greatest(${schema.receipts.deliveredUpTo}, excluded.delivered_up_to)`,
        readUpTo: sql`greatest(${schema.receipts.readUpTo}, excluded.read_up_to)`,
        updatedAt: sql`now()`,
      },
    })
    .returning(receiptColumns);

  const receipt: Receipt = row!;
  res.json(receipt);
  broadcast(roomChannel(roomId), RECEIPT_UPDATED_EVENT, receipt, req);
});
