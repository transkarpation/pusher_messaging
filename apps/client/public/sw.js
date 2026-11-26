// Service worker: shows the push notifications the API sends while the user has no open
// connection (a PushPayload from @pm/shared), and opens the room when one is clicked.

/** Posted to an open window to switch it to the room (see src/lib/push.ts). */
const OPEN_ROOM = "pm:open-room";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  if (!payload || typeof payload.roomId !== "number") return;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // One notification per room: a newer message replaces the older one and alerts again.
      tag: `room-${payload.roomId}`,
      renotify: true,
      data: { roomId: payload.roomId },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;
  if (typeof roomId !== "number") return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        open.postMessage({ type: OPEN_ROOM, roomId });
        await open.focus();
      } else {
        await self.clients.openWindow(`/?room=${roomId}`);
      }
    })(),
  );
});
