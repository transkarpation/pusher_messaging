import Pusher from "pusher-js";
import { api } from "./api";
import { setSocketId } from "./lib/socket";

let client: Promise<Pusher> | null = null;

/** Lazily creates a single Pusher connection using key/cluster served by the backend. */
export function getPusher(): Promise<Pusher> {
  client ??= api
    .getRealtimeConfig()
    .then(({ pusher }) => {
      const p = new Pusher(pusher.key, {
        cluster: pusher.cluster,
        channelAuthorization: { endpoint: "/api/realtime/pusher/auth", transport: "ajax" },
      });
      p.connection.bind("state_change", ({ current }: { current: string }) => {
        setSocketId(current === "connected" ? p.connection.socket_id : undefined);
      });
      p.connection.bind("message", (msg: { event: string; data: unknown }) => {
        if (msg.event === "pusher:error") console.warn("Pusher error:", msg.data);
      });
      return p;
    })
    .catch((err) => {
      client = null; // allow retry
      throw err;
    });
  return client;
}

export async function disconnectPusher() {
  const current = client;
  client = null;
  setSocketId(undefined);
  if (current) (await current.catch(() => null))?.disconnect();
}
