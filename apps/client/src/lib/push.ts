import { api } from "../api";

/**
 * Web Push: notifications of new messages while this browser has no open connection to the
 * chat. The service worker (public/sw.js) shows them; the API sends them only once the user
 * enabled them here, and only to the session that did (signing out turns them off).
 */

/** - unsupported: the browser can't do Web Push; unavailable: the server has it off. */
export type PushState = "unsupported" | "unavailable" | "denied" | "off" | "on";

const SW_URL = "/sw.js";
/** What the service worker posts when a notification is clicked while a window is open. */
const OPEN_ROOM = "pm:open-room";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

let publicKey: Promise<string | null> | null = null;
const vapidKey = () => {
  publicKey ??= api.getPushConfig().then(
    (c) => c.webPushPublicKey,
    (err) => {
      publicKey = null; // retry next time
      throw err;
    },
  );
  return publicKey;
};

const currentSubscription = async () =>
  (await navigator.serviceWorker.getRegistration(SW_URL))?.pushManager.getSubscription() ?? null;

export async function pushState(): Promise<PushState> {
  if (!supported()) return "unsupported";
  if (!(await vapidKey())) return "unavailable";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && (await currentSubscription()) ? "on" : "off";
}

/** Asks for permission (call it from a click), subscribes this browser and tells the API. */
export async function enablePush(): Promise<PushState> {
  const key = await vapidKey();
  if (!supported() || !key) return pushState();
  if ((await Notification.requestPermission()) !== "granted") return pushState();
  const registration = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  await sendToApi(await subscription(registration, key));
  return "on";
}

/** Unsubscribes this browser and tells the API. */
export async function disablePush(): Promise<PushState> {
  const sub = supported() ? await currentSubscription() : null;
  if (sub) {
    await api.unregisterPush(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
  return pushState();
}

/** On signing out: the API forgets the session's subscription by itself; the browser's goes too. */
export async function forgetPush(): Promise<void> {
  if (supported()) await (await currentSubscription())?.unsubscribe();
}

/**
 * At startup: a subscription this browser already has goes to the API again (it may have
 * expired, or the server's key changed).
 */
export async function syncPush(): Promise<void> {
  if (!supported() || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  const key = await vapidKey();
  if (!registration || !key || !(await registration.pushManager.getSubscription())) return;
  await sendToApi(await subscription(registration, key));
}

/** Calls `open` with the room of a clicked notification; returns a function that stops listening. */
export function onNotificationOpen(open: (roomId: number) => void): () => void {
  if (!supported()) return () => undefined;
  const listener = (e: MessageEvent) => {
    if (e.data?.type === OPEN_ROOM && typeof e.data.roomId === "number") open(e.data.roomId);
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}

/** The registration's subscription for `key`, made anew if missing or made with another key. */
async function subscription(registration: ServiceWorkerRegistration, key: string): Promise<PushSubscription> {
  const applicationServerKey = base64UrlToBytes(key);
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameKey(existing.options.applicationServerKey, applicationServerKey)) return existing;
  await existing?.unsubscribe();
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

async function sendToApi(sub: PushSubscription) {
  const { endpoint, keys } = sub.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error("The browser gave an incomplete push subscription");
  await api.registerPush({ kind: "web", endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array) {
  if (!a || a.byteLength !== b.length) return false;
  const bytes = new Uint8Array(a);
  return bytes.every((x, i) => x === b[i]);
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
