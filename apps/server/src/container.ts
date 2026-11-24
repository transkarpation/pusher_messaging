import { db } from "./db/index.js";
import { AdminService } from "./modules/admin/index.js";
import { AuthService, DrizzleSessionsRepository } from "./modules/auth/index.js";
import { BlocksService, DrizzleBlocksRepository } from "./modules/blocks/index.js";
import {
  AttachmentsService,
  ChatEvents,
  DrizzleAttachmentsRepository,
  ChatViews,
  DrizzleInvitesRepository,
  DrizzleMessagesRepository,
  DrizzlePollsRepository,
  DrizzleRoomsRepository,
  InvitesService,
  MessagesService,
  PollsService,
  RoomsService,
} from "./modules/chat/index.js";
import type { RealtimeConfig } from "@pm/shared";
import { PusherGateway, RealtimeService, pusherConfigFromEnv } from "./modules/realtime/index.js";
import { S3Store, s3ConfigFromEnv, type AttachmentStorage } from "./modules/storage/index.js";
import { SeedsService } from "./modules/seeds/index.js";
import { DrizzleUsersRepository, UsersService } from "./modules/users/index.js";
import { DrizzleTransactor } from "./shared/transaction.js";

/**
 * Composition root: builds every repository and service and wires them together.
 * Handlers get services, services get repositories (and other modules' services);
 * nothing else constructs them.
 */
export function createContainer() {
  // Realtime events go through Pusher Channels.
  const pusher = new PusherGateway(pusherConfigFromEnv());
  const realtimeConfig: RealtimeConfig = { key: pusher.config.key, cluster: pusher.config.cluster };
  const tx = new DrizzleTransactor(db);

  const users = new UsersService(new DrizzleUsersRepository(db), pusher);
  const auth = new AuthService(new DrizzleSessionsRepository(db), users);
  const admin = new AdminService(users, auth);
  const blocks = new BlocksService(new DrizzleBlocksRepository(db), users, pusher);

  const roomsRepo = new DrizzleRoomsRepository(db);
  const messagesRepo = new DrizzleMessagesRepository(db);
  const invitesRepo = new DrizzleInvitesRepository(db);
  const attachmentsRepo = new DrizzleAttachmentsRepository(db);
  const pollsRepo = new DrizzlePollsRepository(db);
  const views = new ChatViews(roomsRepo, messagesRepo, invitesRepo, attachmentsRepo, pollsRepo, users, blocks);
  const events = new ChatEvents(pusher, views);
  const rooms = new RoomsService(tx, roomsRepo, messagesRepo, invitesRepo, users, views, events);
  const invites = new InvitesService(tx, roomsRepo, messagesRepo, invitesRepo, users, views, events);
  // Attachment bytes go to the S3 bucket when S3_BUCKET is set, else to Postgres.
  const s3Config = s3ConfigFromEnv();
  const attachmentStorage: AttachmentStorage = s3Config ? "s3" : "db";
  const attachments = new AttachmentsService(attachmentsRepo, attachmentStorage, s3Config && new S3Store(s3Config));
  const messages = new MessagesService(tx, messagesRepo, attachmentsRepo, pollsRepo, views, events, attachments);
  const polls = new PollsService(tx, messagesRepo, pollsRepo, views, events);

  const realtime = new RealtimeService(rooms);
  const seeds = new SeedsService(users, rooms, process.env.NODE_ENV !== "production");

  return {
    users,
    auth,
    admin,
    blocks,
    rooms,
    invites,
    messages,
    attachments,
    polls,
    realtime,
    pusher,
    realtimeConfig,
    attachmentStorage,
    seeds,
  };
}

export type Container = ReturnType<typeof createContainer>;
