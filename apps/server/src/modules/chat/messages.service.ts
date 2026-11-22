import { MESSAGES_PAGE_SIZE, type Message, type MessagesResponse, type Receipt, type UpdateReceiptInput } from "@pm/shared";
import { badRequest, forbidden, notFound } from "../../shared/errors.js";
import type { Actor } from "../../shared/http.js";
import type { Transactor } from "../../shared/transaction.js";
import type { AttachmentsRepository } from "./attachments.repository.js";
import type { ChatEvents } from "./chat.events.js";
import type { ChatViews } from "./chat.views.js";
import type { MessagesRepository, PageCursor } from "./messages.repository.js";
import type { RoomAccess } from "./rooms.service.js";

/** Messages and receipts in a room the actor belongs to (checked at the HTTP edge). */
export class MessagesService {
  constructor(
    private readonly tx: Transactor,
    private readonly messages: MessagesRepository,
    private readonly attachments: AttachmentsRepository,
    private readonly views: ChatViews,
    private readonly events: ChatEvents,
  ) {}

  /** A page of messages (see `PageCursor`) plus all receipts in the room. */
  async page(roomId: number, cursor: PageCursor): Promise<MessagesResponse> {
    const [{ rows, hasMore }, receipts] = await Promise.all([
      this.messages.page(roomId, cursor, MESSAGES_PAGE_SIZE),
      this.messages.roomReceipts(roomId),
    ]);
    return { messages: await this.views.messageList(rows), receipts, hasMore };
  }

  /** `attachmentIds`: the actor's uploads to this room not sent with another message yet. */
  async send(actor: Actor, roomId: number, text: string, attachmentIds: number[] = []): Promise<Message> {
    const ids = [...new Set(attachmentIds)];
    const row = await this.tx.run(async (tx) => {
      const created = await this.messages.withTx(tx).create(roomId, actor.user.id, "text", text);
      const linked = await this.attachments.withTx(tx).link(ids, roomId, actor.user.id, created.id);
      if (linked !== ids.length) throw badRequest("Attachment not found");
      return created;
    });
    const message = await this.views.message(row, [actor.user]);
    // The sender already has it from the response.
    this.events.messageCreated(message, actor.socketId);
    return message;
  }

  /**
   * Only the author may edit, and only a regular message that isn't deleted.
   * The text may be emptied only if the message has attachments.
   */
  async edit(actor: Actor, roomId: number, messageId: number, text: string): Promise<Message> {
    if (text === "" && (await this.attachments.forMessages([messageId])).length === 0) {
      throw badRequest("Message is empty");
    }
    const row = await this.messages.updateLive(roomId, messageId, actor.user.id, { type: "edit", text });
    if (!row) throw await this.whyNot(roomId, messageId, "You can only edit your own messages");
    const message = await this.views.message(row, [actor.user]);
    this.events.messageUpdated(message, actor.socketId);
    return message;
  }

  /**
   * The author, or the room owner, may delete a message. It's kept as a placeholder
   * ("This message was deleted") with its text and files wiped, so the history keeps its shape.
   */
  async remove(actor: Actor, room: RoomAccess, messageId: number): Promise<Message> {
    const onlyAuthor = room.role === "owner" ? null : actor.user.id;
    const row = await this.tx.run(async (tx) => {
      const deleted = await this.messages.withTx(tx).updateLive(room.id, messageId, onlyAuthor, { type: "delete" });
      if (deleted) await this.attachments.withTx(tx).deleteForMessage(messageId);
      return deleted;
    });
    if (!row) throw await this.whyNot(room.id, messageId, "You can only delete your own messages");
    const message = await this.views.message(row, [actor.user]);
    this.events.messageDeleted(message, actor.socketId);
    return message;
  }

  /**
   * Moves the actor's watermarks forward (never back). Read implies delivered; values are
   * capped at the room's newest message.
   */
  async advanceReceipt(actor: Actor, roomId: number, input: UpdateReceiptInput): Promise<Receipt> {
    const read = input.readUpTo ?? 0;
    const delivered = Math.max(input.deliveredUpTo ?? 0, read);
    const receipt = await this.messages.advanceReceipt(roomId, actor.user.id, delivered, read);
    this.events.receiptUpdated(receipt, actor.socketId);
    return receipt;
  }

  /** 404 if there's no such live message, else 403 (someone else's). */
  private async whyNot(roomId: number, messageId: number, forbiddenMessage: string) {
    return (await this.messages.liveAuthor(roomId, messageId)) === null
      ? notFound("Message not found")
      : forbidden(forbiddenMessage);
  }
}
