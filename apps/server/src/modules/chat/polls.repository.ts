import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { schema } from "../../db/index.js";
import { executorOf, type DbExecutor, type TxScope } from "../../shared/transaction.js";

const { messages, polls, pollOptions, pollVotes, pollComments } = schema;

/** A poll's settings as stored, with the author of its message. */
export interface PollRow {
  messageId: number;
  authorId: number;
  question: string;
  multiple: boolean;
  maxVotes: number | null;
  anonymous: boolean;
  allowSuggestions: boolean;
  allowComments: boolean;
  version: number;
}

export interface PollOptionRow {
  id: number;
  messageId: number;
  text: string;
  addedBy: number | null;
}

export interface PollVoteRow {
  messageId: number;
  optionId: number;
  userId: number;
}

export interface PollCommentRow {
  id: number;
  messageId: number;
  userId: number;
  text: string;
  createdAt: Date;
}

export interface NewPoll {
  question: string;
  options: string[];
  multiple: boolean;
  maxVotes: number | null;
  anonymous: boolean;
  allowSuggestions: boolean;
  allowComments: boolean;
}

/** Everything needed to build the polls of some messages. */
export interface PollData {
  polls: PollRow[];
  options: PollOptionRow[];
  votes: PollVoteRow[];
  comments: PollCommentRow[];
}

const pollColumns = {
  messageId: polls.messageId,
  authorId: messages.userId,
  question: polls.question,
  multiple: polls.multiple,
  maxVotes: polls.maxVotes,
  anonymous: polls.anonymous,
  allowSuggestions: polls.allowSuggestions,
  allowComments: polls.allowComments,
  version: polls.version,
};

export interface PollsRepository {
  withTx(tx: TxScope): PollsRepository;
  /** Adds the poll (and its options, by `authorId`) to an existing "poll" message. */
  create(messageId: number, authorId: number, poll: NewPoll): Promise<void>;
  /**
   * Bumps the version of the poll in message `messageId` of room `roomId` and returns it.
   * Inside a transaction this also locks the poll, so changes to one poll run one at a time.
   * Null if there's no such poll (or its message was deleted).
   */
  lock(roomId: number, messageId: number): Promise<PollRow | null>;
  options(messageId: number): Promise<PollOptionRow[]>;
  /** Replaces the user's votes in the poll. */
  setVotes(messageId: number, userId: number, optionIds: number[]): Promise<void>;
  /** Appends an option. */
  addOption(messageId: number, text: string, addedBy: number): Promise<void>;
  addComment(messageId: number, userId: number, text: string): Promise<void>;
  /** Removes the poll with its options, votes and comments (its message is being deleted). */
  deleteForMessage(messageId: number): Promise<void>;
  /** Polls of these messages with their options, votes and comments, in display order. */
  load(messageIds: number[]): Promise<PollData>;
}

export class DrizzlePollsRepository implements PollsRepository {
  constructor(private readonly db: DbExecutor) {}

  withTx(tx: TxScope) {
    return new DrizzlePollsRepository(executorOf(tx));
  }

  async create(messageId: number, authorId: number, poll: NewPoll) {
    const { options, ...settings } = poll;
    await this.db.insert(polls).values({ messageId, ...settings });
    await this.db
      .insert(pollOptions)
      .values(options.map((text, position) => ({ messageId, text, position, addedBy: authorId })));
  }

  async lock(roomId: number, messageId: number) {
    const [bumped] = await this.db
      .update(polls)
      .set({ version: sql`${polls.version} + 1` })
      .where(
        and(
          eq(polls.messageId, messageId),
          // Only a poll in this room.
          sql`exists (select 1 from ${messages} where ${messages.id} = ${polls.messageId} and ${messages.roomId} = ${roomId})`,
        ),
      )
      .returning({ messageId: polls.messageId });
    if (!bumped) return null;
    const [row] = await this.db
      .select(pollColumns)
      .from(polls)
      .innerJoin(messages, eq(messages.id, polls.messageId))
      .where(eq(polls.messageId, messageId));
    return row ?? null;
  }

  async options(messageId: number) {
    return this.db
      .select({ id: pollOptions.id, messageId: pollOptions.messageId, text: pollOptions.text, addedBy: pollOptions.addedBy })
      .from(pollOptions)
      .where(eq(pollOptions.messageId, messageId))
      .orderBy(asc(pollOptions.position), asc(pollOptions.id));
  }

  async setVotes(messageId: number, userId: number, optionIds: number[]) {
    await this.db.delete(pollVotes).where(and(eq(pollVotes.messageId, messageId), eq(pollVotes.userId, userId)));
    if (optionIds.length > 0) {
      await this.db.insert(pollVotes).values(optionIds.map((optionId) => ({ optionId, messageId, userId })));
    }
  }

  async addOption(messageId: number, text: string, addedBy: number) {
    const [last] = await this.db
      .select({ n: count() })
      .from(pollOptions)
      .where(eq(pollOptions.messageId, messageId));
    await this.db.insert(pollOptions).values({ messageId, text, position: last?.n ?? 0, addedBy });
  }

  async addComment(messageId: number, userId: number, text: string) {
    await this.db.insert(pollComments).values({ messageId, userId, text });
  }

  async deleteForMessage(messageId: number) {
    await this.db.delete(polls).where(eq(polls.messageId, messageId));
  }

  async load(messageIds: number[]): Promise<PollData> {
    if (messageIds.length === 0) return { polls: [], options: [], votes: [], comments: [] };
    const [pollRows, options, votes, comments] = await Promise.all([
      this.db
        .select(pollColumns)
        .from(polls)
        .innerJoin(messages, eq(messages.id, polls.messageId))
        .where(inArray(polls.messageId, messageIds)),
      this.db
        .select({ id: pollOptions.id, messageId: pollOptions.messageId, text: pollOptions.text, addedBy: pollOptions.addedBy })
        .from(pollOptions)
        .where(inArray(pollOptions.messageId, messageIds))
        .orderBy(asc(pollOptions.position), asc(pollOptions.id)),
      this.db
        .select({ messageId: pollVotes.messageId, optionId: pollVotes.optionId, userId: pollVotes.userId })
        .from(pollVotes)
        .where(inArray(pollVotes.messageId, messageIds))
        .orderBy(asc(pollVotes.createdAt)),
      this.db
        .select({
          id: pollComments.id,
          messageId: pollComments.messageId,
          userId: pollComments.userId,
          text: pollComments.text,
          createdAt: pollComments.createdAt,
        })
        .from(pollComments)
        .where(inArray(pollComments.messageId, messageIds))
        .orderBy(asc(pollComments.id)),
    ]);
    return { polls: pollRows, options, votes, comments };
  }
}
