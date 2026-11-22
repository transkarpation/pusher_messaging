import { db } from "./db/index.js";
import { AuthService, DrizzleSessionsRepository } from "./modules/auth/index.js";
import { BlocksService, DrizzleBlocksRepository } from "./modules/blocks/index.js";
import {
  AttachmentsService,
  ChatEvents,
  DrizzleAttachmentsRepository,
  ChatViews,
  DrizzleInvitesRepository,
  DrizzleMessagesRepository,
  DrizzleRoomsRepository,
  InvitesService,
  MessagesService,
  RoomsService,
} from "./modules/chat/index.js";
import { PusherGateway, RealtimeService, pusherConfigFromEnv } from "./modules/realtime/index.js";
import { SeedsService } from "./modules/seeds/index.js";
import { DrizzleUsersRepository, UsersService } from "./modules/users/index.js";
import { DrizzleTransactor } from "./shared/transaction.js";

/**
 * Composition root: builds every repository and service and wires them together.
 * Handlers get services, services get repositories (and other modules' services);
 * nothing else constructs them.
 */
export function createContainer() {
  const pusher = new PusherGateway(pusherConfigFromEnv());
  const tx = new DrizzleTransactor(db);

  const users = new UsersService(new DrizzleUsersRepository(db), pusher);
  const auth = new AuthService(new DrizzleSessionsRepository(db), users);
  const blocks = new BlocksService(new DrizzleBlocksRepository(db), users, pusher);

  const roomsRepo = new DrizzleRoomsRepository(db);
  const messagesRepo = new DrizzleMessagesRepository(db);
  const invitesRepo = new DrizzleInvitesRepository(db);
  const attachmentsRepo = new DrizzleAttachmentsRepository(db);
  const views = new ChatViews(roomsRepo, messagesRepo, invitesRepo, attachmentsRepo, users, blocks);
  const events = new ChatEvents(pusher, views);
  const rooms = new RoomsService(tx, roomsRepo, messagesRepo, invitesRepo, users, views, events);
  const invites = new InvitesService(tx, roomsRepo, messagesRepo, invitesRepo, users, views, events);
  const messages = new MessagesService(tx, messagesRepo, attachmentsRepo, views, events);
  const attachments = new AttachmentsService(attachmentsRepo);

  const realtime = new RealtimeService(pusher, rooms);
  const seeds = new SeedsService(users, rooms, process.env.NODE_ENV !== "production");

  return {
    users,
    auth,
    blocks,
    rooms,
    invites,
    messages,
    attachments,
    realtime,
    realtimeConfig: { pusher: { key: pusher.config.key, cluster: pusher.config.cluster } },
    seeds,
  };
}

export type Container = ReturnType<typeof createContainer>;
