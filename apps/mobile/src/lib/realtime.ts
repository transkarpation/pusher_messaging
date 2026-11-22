import Pusher from "pusher-js/react-native";
import { api, authHeaders, setSocketId } from "./api";
import { API_URL } from "./config";

let client: Promise<Pusher> | null = null;

/** One Pusher connection, with the key and cluster served by the API; private channels are authorized with the Bearer token. */
export function getPusher(): Promise<Pusher> {
  client ??= api
    .getRealtimeConfig()
    .then(({ pusher }) => {
      const p = new Pusher(pusher.key, {
        cluster: pusher.cluster,
        channelAuthorization: {
          endpoint: `${API_URL}/api/realtime/pusher/auth`,
          transport: "ajax",
          headersProvider: authHeaders,
        },
      });
      p.connection.bind("state_change", ({ current }: { current: string }) => {
        setSocketId(current === "connected" ? p.connection.socket_id : undefined);
      });
      return p;
    })
    .catch((err) => {
      client = null; // allow a retry
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
