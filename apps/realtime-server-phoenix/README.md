# realtime-server-phoenix

The app's realtime server: a Phoenix app that holds the clients' WebSocket connections, channels and presence, while the Node API (`apps/server`) stays the source of truth.

## How it fits together

```
 web / mobile ──phoenix.js──▶ Phoenix :4000 /socket ◀──POST /api/broadcast── Node API :3000
      │                         │      ▲                                           ▲
      │ GET /api/realtime/      │      └── join: POST /api/realtime/phoenix/ ──────┘
      └──── phoenix/token ──────┼──────────────── authorize (shared secret)
            (to the Node API)   │
```

1. **Connecting.** The client gets a token from the API (`GET /api/realtime/phoenix/token`, with its session cookie or Bearer token) and connects with `token` and a `socket_id` it makes up for this connection. The token is `base64url({"sub": userId, "exp": …})` plus an HMAC-SHA256 signature with the shared secret. Phoenix checks it itself (`RealtimeServer.Token`), with no call to the API. Tokens live 15 minutes and are checked only on connect; the client keeps a fresh one ready for reconnects.
2. **Joining a channel.** The topics are the app's channel names (`presence-online`, `private-user-{id}`, `private-room-{id}`). On every join Phoenix asks the API, `POST /api/realtime/phoenix/authorize` with `{userId, channel}`. The API answers with the grant from `RealtimeService.authorize`, or 403. Room membership stays in one place.
3. **Presence.** A presence grant carries the member (`{id, info}`). The channel tracks it in `Phoenix.Presence` and pushes `presence_state`. The join reply says `{presence: true}`, so the client waits for that state.
4. **Publishing.** The API's `PhoenixGateway` posts `{channel, event, data, exceptSocketId}` to `POST /api/broadcast` with the shared secret. Phoenix pushes the event to everyone on the channel, except the connection whose `socket_id` the client sent to the API as `X-Socket-Id`.

The client side is `createPhoenixConnection` in `packages/realtime-client`. It turns all of this into the app's `RealtimeConnection` interface.

Compared with the original push service this is based on:
- The connect token is verified locally instead of calling the API on every connect.
- One authorization callback covers every channel, using the API's existing rules.
- Your own events don't echo back (`X-Socket-Id`), and presence counts users rather than connections.
- The secret is compared in constant time and never logged.

## Running it

It needs the same secret on both sides. In `apps/server/.env`:

```sh
PHOENIX_SHARED_SECRET=some-long-random-string   # e.g. openssl rand -hex 32
# PHOENIX_URL=http://localhost:4000             # where the API reaches Phoenix (default)
# PHOENIX_SOCKET_URL=ws://localhost:4000/socket # what clients connect to (default)
```

**With Docker** (no Elixir needed). From the repo root:

```sh
pnpm realtime:phoenix   # builds and runs it on :4000; reads PHOENIX_SHARED_SECRET from apps/server/.env
pnpm dev                # the API and the web client, as usual
```

**With Elixir installed** (1.15+):

```sh
cd apps/realtime-server-phoenix
mix deps.get
PHOENIX_SHARED_SECRET=… mix phx.server
```

The clients learn the socket URL from `GET /api/realtime/config`.

| Variable | Default | |
|---|---|---|
| `PHOENIX_SHARED_SECRET` | (required) | the same value as in `apps/server/.env` |
| `API_URL` | `http://localhost:3000` | the Node API, for channel authorization. Docker Compose sets `http://host.docker.internal:3000` |
| `PORT` | `4000` | |
| `CHECK_ORIGIN` | any origin | comma-separated allowed origins. Clients authenticate with the token, not cookies, so this is optional hardening |

A `ws://localhost…` socket URL is rewritten by the clients to the host they reach the API at, so the Android emulator (`10.0.2.2`) and phones on the LAN work with the defaults. For production, set `PHOENIX_SOCKET_URL` to the public `wss://` address.

## Tests

```sh
mix test
# without Elixir:
docker run --rm -v "$PWD":/app -w /app elixir:1.19-alpine sh -c "mix local.hex --force && mix local.rebar --force && mix deps.get && mix test"
```

The tests use `RealtimeServer.BackendStub` instead of calling the API.

## Scaling

Phoenix PubSub and Presence work across a cluster of nodes, so this can run as several instances. Connect them into an Erlang cluster (e.g. with `libcluster`) and point `PHOENIX_URL` at any of them.
