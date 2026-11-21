import { Router } from "express";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import {
  MESSAGES_PAGE_SIZE,
  MESSAGE_CREATED_EVENT,
  RECEIPT_UPDATED_EVENT,
  createMessageSchema,
  messagesQuerySchema,
  roomChannel,
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
  const { after } = query;
  const { messages } = schema;

  const [rows, receipts] = await Promise.all([
    db
      .select(messageColumns)
      .from(messages)
      .innerJoin(schema.users, eq(schema.users.id, messages.userId))
      .where(
        after === undefined
          ? eq(messages.roomId, roomId)
          : and(eq(messages.roomId, roomId), gt(messages.id, after)),
      )
      // Latest page: newest first, reversed below. Catch-up: oldest after `after` first.
      .orderBy(after === undefined ? desc(messages.id) : asc(messages.id))
      .limit(MESSAGES_PAGE_SIZE),
    db.select(receiptColumns).from(schema.receipts).where(eq(schema.receipts.roomId, roomId)),
  ]);

  if (after === undefined) rows.reverse();
  const body: MessagesResponse = { messages: rows.map(toMessage), receipts };
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
    text: row!.text,
    createdAt: row!.createdAt.toISOString(),
    author: user,
  };
  res.status(201).json(message);
  // The sender already has it from the response.
  broadcast(roomChannel(roomId), MESSAGE_CREATED_EVENT, message, req);
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
