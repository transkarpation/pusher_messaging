import { BLOCKS_UPDATED_EVENT, userChannel, type BlocksEvent, type User } from "@pm/shared";
import { badRequest, notFound } from "../../shared/errors.js";
import type { Actor } from "../../shared/http.js";
import type { RealtimePublisher } from "../realtime/index.js";
import type { UsersService } from "../users/index.js";
import type { BlocksRepository } from "./blocks.repository.js";

/**
 * The blocks module's facade. Blocking hides someone's messages from the blocker;
 * the blocked user isn't told.
 */
export class BlocksService {
  constructor(
    private readonly blocks: BlocksRepository,
    private readonly users: UsersService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** Ids the user blocked; used by other modules to leave those people's messages out. */
  blockedIds(userId: number): Promise<number[]> {
    return this.blocks.blockedIds(userId);
  }

  /** Which of `userIds` blocked `blockedId` (they don't want to hear from them). */
  blockersAmong(blockedId: number, userIds: number[]): Promise<number[]> {
    return this.blocks.blockersAmong(blockedId, userIds);
  }

  /** People the user blocked, most recently blocked first. */
  async list(userId: number): Promise<User[]> {
    const ids = await this.blocks.blockedIds(userId);
    const users = await this.users.getByIds(ids);
    return ids.flatMap((id) => users.get(id) ?? []);
  }

  async block(actor: Actor, targetId: number): Promise<User[]> {
    if (targetId === actor.user.id) throw badRequest("You can't block yourself");
    if (!(await this.users.getById(targetId))) throw notFound("User not found");
    await this.blocks.add(actor.user.id, targetId);
    return this.listAndNotify(actor);
  }

  async unblock(actor: Actor, targetId: number): Promise<User[]> {
    await this.blocks.remove(actor.user.id, targetId);
    return this.listAndNotify(actor);
  }

  /** The new list, also sent to the user's other tabs. */
  private async listAndNotify(actor: Actor): Promise<User[]> {
    const blocked = await this.list(actor.user.id);
    const event: BlocksEvent = { blocked };
    this.realtime.publish(userChannel(actor.user.id), BLOCKS_UPDATED_EVENT, event, actor.socketId);
    return blocked;
  }
}
