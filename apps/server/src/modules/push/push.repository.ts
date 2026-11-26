import { and, eq, inArray } from "drizzle-orm";
import { schema } from "../../db/index.js";
import type { DbExecutor } from "../../shared/transaction.js";

const { pushSubscriptions } = schema;

export type PushTarget =
  | { id: number; userId: number; kind: "web"; endpoint: string; p256dh: string; auth: string }
  | { id: number; userId: number; kind: "expo"; endpoint: string };

export interface NewPushSubscription {
  sessionId: string;
  userId: number;
  kind: "web" | "expo";
  /** The Web Push endpoint, or the Expo push token. */
  endpoint: string;
  p256dh?: string;
  auth?: string;
}

export interface PushRepository {
  /** Saves the subscription; an endpoint seen before moves to this session (and user). */
  upsert(sub: NewPushSubscription): Promise<void>;
  /** Removes the user's subscription with this endpoint, if any. */
  deleteOwn(userId: number, endpoint: string): Promise<void>;
  /** Removes subscriptions the push service reported as gone. */
  deleteIds(ids: number[]): Promise<void>;
  /** Where to reach the users. */
  targetsOf(userIds: number[]): Promise<PushTarget[]>;
}

export class DrizzlePushRepository implements PushRepository {
  constructor(private readonly db: DbExecutor) {}

  async upsert(sub: NewPushSubscription) {
    const values = { ...sub, p256dh: sub.p256dh ?? null, auth: sub.auth ?? null };
    await this.db
      .insert(pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { sessionId: values.sessionId, userId: values.userId, kind: values.kind, p256dh: values.p256dh, auth: values.auth },
      });
  }

  async deleteOwn(userId: number, endpoint: string) {
    await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  }

  async deleteIds(ids: number[]) {
    if (ids.length === 0) return;
    await this.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, ids));
  }

  async targetsOf(userIds: number[]): Promise<PushTarget[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: pushSubscriptions.id,
        userId: pushSubscriptions.userId,
        kind: pushSubscriptions.kind,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds));
    return rows.flatMap((r): PushTarget[] => {
      if (r.kind === "expo") return [{ id: r.id, userId: r.userId, kind: "expo", endpoint: r.endpoint }];
      return r.p256dh && r.auth ? [{ id: r.id, userId: r.userId, kind: "web", endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }] : [];
    });
  }
}
