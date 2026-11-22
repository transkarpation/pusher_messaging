import { POLL_MAX_OPTIONS, type Message, type Poll } from "@pm/shared";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import type { Actor } from "../../shared/http.js";
import type { Transactor } from "../../shared/transaction.js";
import type { ChatEvents } from "./chat.events.js";
import type { ChatViews } from "./chat.views.js";
import type { MessagesRepository } from "./messages.repository.js";
import type { NewPoll, PollRow, PollsRepository } from "./polls.repository.js";
import type { RoomAccess } from "./rooms.service.js";

/**
 * Polls in a room the actor belongs to (checked at the HTTP edge). The room owner posts them;
 * members vote, and, if the poll allows it, suggest options and comment. Every change is sent
 * to the room as the poll's new state; the voter's own choice goes to their other tabs.
 */
export class PollsService {
  constructor(
    private readonly tx: Transactor,
    private readonly messages: MessagesRepository,
    private readonly polls: PollsRepository,
    private readonly views: ChatViews,
    private readonly events: ChatEvents,
  ) {}

  async create(actor: Actor, room: RoomAccess, input: NewPoll): Promise<Message> {
    if (room.role !== "owner") throw forbidden("Only the room owner can create polls");
    const row = await this.tx.run(async (tx) => {
      const created = await this.messages.withTx(tx).create(room.id, actor.user.id, "poll", "");
      await this.polls.withTx(tx).create(created.id, actor.user.id, input);
      return created;
    });
    const message = await this.views.message(row, [actor.user], actor.user.id);
    this.events.messageCreated(message, actor.socketId);
    return message;
  }

  /** Replaces the actor's vote with `optionIds` ([] takes it back). */
  async vote(actor: Actor, roomId: number, messageId: number, optionIds: number[]): Promise<Poll> {
    const ids = [...new Set(optionIds)];
    await this.change(roomId, messageId, async (poll, polls) => {
      if (ids.length > 1 && !poll.multiple) throw badRequest("This poll takes one answer");
      if (poll.maxVotes !== null && ids.length > poll.maxVotes) {
        throw badRequest(`You can pick up to ${poll.maxVotes} options`);
      }
      const known = new Set((await polls.options(messageId)).map((o) => o.id));
      if (!ids.every((id) => known.has(id))) throw badRequest("Option not found");
      await polls.setVotes(messageId, actor.user.id, ids);
    });
    const poll = await this.publish(actor, roomId, messageId);
    this.events.pollVoted(actor.user.id, { roomId, messageId, myVotes: poll.myVotes }, actor.socketId);
    return poll;
  }

  /** The poll's author may always add options; others only if it takes suggestions. */
  async addOption(actor: Actor, roomId: number, messageId: number, text: string): Promise<Poll> {
    await this.change(roomId, messageId, async (poll, polls) => {
      if (!poll.allowSuggestions && poll.authorId !== actor.user.id) {
        throw forbidden("This poll doesn't take suggestions");
      }
      const options = await polls.options(messageId);
      if (options.length >= POLL_MAX_OPTIONS) throw badRequest(`A poll has at most ${POLL_MAX_OPTIONS} options`);
      const lower = text.toLocaleLowerCase();
      if (options.some((o) => o.text.toLocaleLowerCase() === lower)) throw conflict("This option is already there");
      await polls.addOption(messageId, text, actor.user.id);
    });
    return this.publish(actor, roomId, messageId);
  }

  async comment(actor: Actor, roomId: number, messageId: number, text: string): Promise<Poll> {
    await this.change(roomId, messageId, async (poll, polls) => {
      if (!poll.allowComments) throw forbidden("Comments are off for this poll");
      await polls.addComment(messageId, actor.user.id, text);
    });
    return this.publish(actor, roomId, messageId);
  }

  /** Runs `fn` with the poll locked (and its version bumped) in one transaction; 404 if there's no such poll. */
  private async change(
    roomId: number,
    messageId: number,
    fn: (poll: PollRow, polls: PollsRepository) => Promise<void>,
  ): Promise<void> {
    await this.tx.run(async (tx) => {
      const polls = this.polls.withTx(tx);
      const poll = await polls.lock(roomId, messageId);
      if (!poll) throw notFound("Poll not found");
      await fn(poll, polls);
    });
  }

  /** Sends the poll's new state to the room and returns it as the actor sees it. */
  private async publish(actor: Actor, roomId: number, messageId: number): Promise<Poll> {
    const poll = await this.views.poll(messageId, actor.user.id);
    if (!poll) throw notFound("Poll not found"); // deleted right after the change
    const { myVotes: _, ...state } = poll;
    this.events.pollUpdated({ roomId, messageId, poll: state }, actor.socketId);
    return poll;
  }
}
