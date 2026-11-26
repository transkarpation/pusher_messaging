import { WebPushError, sendNotification } from "web-push";
import type { PushPayload } from "@pm/shared";
import type { WebPushConfig } from "./push.config.js";
import type { PushTarget } from "./push.repository.js";

/** How long a notification waits at the push service for an offline device. */
const TTL_SECONDS = 24 * 60 * 60;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo takes up to 100 messages per request. */
const EXPO_BATCH = 100;
const TIMEOUT_MS = 10_000;

/** Sends one payload to many targets of a kind; returns the ids of targets that are gone for good. */
export interface PushSender<K extends PushTarget["kind"]> {
  send(targets: Extract<PushTarget, { kind: K }>[], payload: PushPayload): Promise<number[]>;
}

/** Web Push (VAPID) to browsers' push services. */
export class WebPushSender implements PushSender<"web"> {
  constructor(private readonly config: WebPushConfig) {}

  async send(targets: Extract<PushTarget, { kind: "web" }>[], payload: PushPayload) {
    const body = JSON.stringify(payload);
    const gone: number[] = [];
    await Promise.all(
      targets.map(async (t) => {
        try {
          await sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, body, {
            vapidDetails: this.config,
            TTL: TTL_SECONDS,
            urgency: "high",
            topic: `room-${payload.roomId}`,
            timeout: TIMEOUT_MS,
          });
        } catch (err) {
          // 404/410: the browser unsubscribed or the subscription expired.
          if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) gone.push(t.id);
          else console.error(`Web Push to subscription ${t.id} failed:`, err);
        }
      }),
    );
    return gone;
  }
}

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

/** Expo's push service, which forwards to FCM (Android) and APNs (iOS). */
export class ExpoPushSender implements PushSender<"expo"> {
  /** `accessToken`: needed only when the Expo project requires it for sending (EXPO_ACCESS_TOKEN). */
  constructor(private readonly accessToken?: string) {}

  async send(targets: Extract<PushTarget, { kind: "expo" }>[], payload: PushPayload) {
    const gone: number[] = [];
    for (let i = 0; i < targets.length; i += EXPO_BATCH) {
      const batch = targets.slice(i, i + EXPO_BATCH);
      const messages = batch.map((t) => ({
        to: t.endpoint,
        title: payload.title,
        body: payload.body,
        data: payload,
        sound: "default",
        priority: "high",
        channelId: "messages",
        ttl: TTL_SECONDS,
      }));
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(messages),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          console.error(`Expo push failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
          continue;
        }
        const { data } = (await res.json()) as { data: ExpoTicket[] };
        data.forEach((ticket, j) => {
          if (ticket.status !== "error") return;
          if (ticket.details?.error === "DeviceNotRegistered") gone.push(batch[j]!.id);
          else console.error(`Expo push to subscription ${batch[j]!.id} failed: ${ticket.message}`);
        });
      } catch (err) {
        console.error("Expo push failed:", err);
      }
    }
    return gone;
  }
}
