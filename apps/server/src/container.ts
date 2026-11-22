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
import type { RealtimeConfig } from "@pm/shared";
import {
  PhoenixGateway,
  PusherGateway,
  RealtimeService,
  WsGateway,
  phoenixConfigFromEnv,
  pusherConfigFromEnv,
  realtimeDriverFromEnv,
  type RealtimePublisher,
} from "./modules/realtime/index.js";
import { SeedsService } from "./modules/seeds/index.js";
import { DrizzleUsersRepository, UsersService } from "./modules/users/index.js";
import { DrizzleTransactor } from "./shared/transaction.js";

/**
 * Composition root: builds every repository and service and wires them together.
 * Handlers get services, services get repositories (and other modules' services);
 * nothing else constructs them.
 */
export function createContainer() {
  // Realtime transport, chosen by REALTIME_DRIVER: the own WebSocket gateway, Pusher or the Phoenix server.
  const driver = realtimeDriverFromEnv();
  const pusher = driver === "pusher" ? new PusherGateway(pusherConfigFromEnv()) : null;
  const phoenix = driver === "phoenix" ? new PhoenixGateway(phoenixConfigFromEnv()) : null;
  const gateway = driver === "ws" ? new WsGateway() : null;
  const publisher: RealtimePublisher = (pusher ?? phoenix ?? gateway)!;
  const realtimeConfig: RealtimeConfig = pusher
    ? { driver: "pusher", key: pusher.config.key, cluster: pusher.config.cluster }
    : phoenix
      ? { driver: "phoenix", socketUrl: phoenix.config.socketUrl }
      : { driver: "ws" };
  const tx = new DrizzleTransactor(db);

  const users = new UsersService(new DrizzleUsersRepository(db), publisher);
  const auth = new AuthService(new DrizzleSessionsRepository(db), users);
  const blocks = new BlocksService(new DrizzleBlocksRepository(db), users, publisher);

  const roomsRepo = new DrizzleRoomsRepository(db);
  const messagesRepo = new DrizzleMessagesRepository(db);
  const invitesRepo = new DrizzleInvitesRepository(db);
  const attachmentsRepo = new DrizzleAttachmentsRepository(db);
  const views = new ChatViews(roomsRepo, messagesRepo, invitesRepo, attachmentsRepo, users, blocks);
  const events = new ChatEvents(publisher, views);
  const rooms = new RoomsService(tx, roomsRepo, messagesRepo, invitesRepo, users, views, events);
  const invites = new InvitesService(tx, roomsRepo, messagesRepo, invitesRepo, users, views, events);
  const messages = new MessagesService(tx, messagesRepo, attachmentsRepo, views, events);
  const attachments = new AttachmentsService(attachmentsRepo);

  const realtime = new RealtimeService(rooms, users);
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
    /** The WebSocket gateway to attach to the HTTP server; null with the Pusher driver. */
    gateway,
    pusher,
    phoenix,
    realtimeConfig,
    seeds,
  };
}

export type Container = ReturnType<typeof createContainer>;
