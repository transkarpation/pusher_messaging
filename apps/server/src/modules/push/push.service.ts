import { isVoiceMessage, type Message, type PushConfig, type PushPayload, type RegisterPushInput } from "@pm/shared";
import type { PresenceSource } from "../realtime/index.js";
import type { WebPushConfig } from "./push.config.js";
import type { PushRepository, PushTarget } from "./push.repository.js";
import type { PushSender } from "./push.senders.js";

/** Longest notification text; push services cap the payload at about 4 KB. */
const BODY_MAX = 180;

/** What the chat module tells about new messages (see `PushService.messageCreated`). */
export interface MessageNotifier {
  messageCreated(message: Message, roomName: string, recipientIds: number[]): Promise<void>;
}

/**
 * Push notifications of new messages to people who aren't connected: the realtime server is
 * asked who of the recipients has an open connection, and the rest get a push on every device
 * that subscribed (browsers through Web Push, the mobile app through Expo).
 */
export class PushService implements MessageNotifier {
  constructor(
    private readonly subscriptions: PushRepository,
    private readonly presence: PresenceSource,
    private readonly web: { config: WebPushConfig; sender: PushSender<"web"> } | null,
    private readonly expo: PushSender<"expo">,
  ) {}

  config(): PushConfig {
    return { webPushPublicKey: this.web?.config.publicKey ?? null };
  }

  /** Sends this session's notifications to the subscription (moving it here if another session had it). */
  async register(userId: number, sessionId: string, input: RegisterPushInput): Promise<void> {
    await this.subscriptions.upsert(
      input.kind === "web"
        ? { sessionId, userId, kind: "web", endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth }
        : { sessionId, userId, kind: "expo", endpoint: input.token },
    );
  }

  async unregister(userId: number, endpoint: string): Promise<void> {
    await this.subscriptions.deleteOwn(userId, endpoint);
  }

  /** `recipientIds`: who may see the message, the author left out. */
  async messageCreated(message: Message, roomName: string, recipientIds: number[]): Promise<void> {
    const offline = await this.offlineAmong(recipientIds);
    const targets = await this.subscriptions.targetsOf(offline);
    if (targets.length === 0) return;

    const payload: PushPayload = { roomId: message.roomId, messageId: message.id, title: roomName, body: bodyOf(message) };
    const web = targets.filter((t): t is Extract<PushTarget, { kind: "web" }> => t.kind === "web");
    const expo = targets.filter((t): t is Extract<PushTarget, { kind: "expo" }> => t.kind === "expo");
    const gone = await Promise.all([
      this.web && web.length > 0 ? this.web.sender.send(web, payload) : [],
      expo.length > 0 ? this.expo.send(expo, payload) : [],
    ]);
    await this.subscriptions.deleteIds(gone.flat());
  }

  /** If the realtime server can't be asked, everyone counts as offline: a missed message is worse than an extra push. */
  private async offlineAmong(userIds: number[]): Promise<number[]> {
    try {
      const online = await this.presence.onlineUserIds(userIds);
      return userIds.filter((id) => !online.has(id));
    } catch (err) {
      console.error("Presence lookup failed, notifying everyone:", err);
      return userIds;
    }
  }
}

/** "Author: text", or what the message holds when it has no text. */
function bodyOf(m: Message): string {
  const author = m.author.name ?? m.author.username;
  let what: string;
  if (m.kind === "poll") what = `📊 ${m.poll?.question ?? "Poll"}`;
  else if (m.text) what = m.text;
  else if (isVoiceMessage(m)) what = "🎤 Voice message";
  else if (m.attachments.length > 0 && m.attachments.every((a) => a.contentType.startsWith("image/"))) {
    what = m.attachments.length === 1 ? "🖼 Photo" : `🖼 ${m.attachments.length} photos`;
  } else what = m.attachments.length === 1 ? `📎 ${m.attachments[0]!.name}` : `📎 ${m.attachments.length} files`;
  const text = what.replace(/\s+/g, " ").trim();
  return `${author}: ${text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1)}…` : text}`;
}
