# pusher-messaging

Real-time chat with rooms, invitations, messages (editable and deletable) with file attachments, polls, typing indicators, delivered/read receipts, online presence, profiles with avatars and blocking users. Real-time updates go through the server's own WebSocket endpoint, [Pusher Channels](https://pusher.com/channels) or a Phoenix server, switched with one environment variable (see [Realtime transport](#realtime-transport)).

## Stack

- **Server** (`apps/server`): Express 5, Drizzle ORM, PostgreSQL, `ws` for the own realtime endpoint, `pusher` for the Pusher driver
- **Client** (`apps/client`): React 19, Zustand, Vite, pusher-js / phoenix.js (each loaded only with its driver)
- **Mobile** (`apps/mobile`): Expo (React Native), Expo Router, pusher-js / phoenix.js (each only with its driver). See [Mobile app](#mobile-app)
- **Realtime server, Phoenix** (`apps/realtime-server-phoenix`): Elixir, Phoenix channels and Presence, for the Phoenix driver. See [its README](apps/realtime-server-phoenix/README.md)
- **Shared** (`packages/shared`): zod schemas, types, channel and event names, the realtime protocol
- **Realtime client** (`packages/realtime-client`): one connection interface for the web and mobile apps, with the own WebSocket client and pusher-js and phoenix.js adapters behind it

## Requirements

- Node.js 22+
- pnpm. The version is pinned in `packageManager` in `package.json`; `corepack enable` is the easiest way to get it.
- Docker, for PostgreSQL
- For the Pusher driver only: a Pusher Channels app (the free plan is enough)
- For the Phoenix driver only: Docker (or Elixir 1.15+) to run `apps/realtime-server-phoenix`

## Getting started

1. **Install dependencies**

   ```sh
   pnpm install
   ```

2. **Configure the environment**

   ```sh
   cp apps/server/.env.example apps/server/.env
   ```

   | Variable | Description |
   |---|---|
   | `DATABASE_URL` | points to the database from `docker-compose.yml` by default |
   | `PORT` | API port, `3000` by default |
   | `REALTIME_DRIVER` | `ws` (default): the server's own WebSocket endpoint; `pusher`: Pusher Channels; `phoenix`: the Phoenix server |
   | `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | only for `REALTIME_DRIVER=pusher`: from **App Keys** of a Channels app in the [Pusher Dashboard](https://dashboard.pusher.com/) |
   | `PHOENIX_SHARED_SECRET`, `PHOENIX_URL`, `PHOENIX_SOCKET_URL` | only for `REALTIME_DRIVER=phoenix`, see [its README](apps/realtime-server-phoenix/README.md) |

   The clients need no `.env` for realtime. They ask `GET /api/realtime/config` which transport to use (and get the Pusher key and cluster, or the Phoenix socket URL, from it).

3. **Start the database and run migrations**

   ```sh
   pnpm db:up
   pnpm db:migrate
   ```

   PostgreSQL listens on host port `5433`, so it doesn't clash with a local Postgres on `5432`.

4. **Run the server and the client**

   ```sh
   pnpm dev
   ```

   - Client: http://localhost:5173
   - API: http://localhost:3000. Vite proxies `/api` to it.
   - API docs (Swagger UI): http://localhost:5173/api/docs. The OpenAPI document is at `/api/openapi.json`. To try authenticated endpoints, call `POST /auth/login` there first; the session cookie then goes with every request.

   To try it out, register two users in different browsers (or a normal and a private window). Then create a room and add the second user. Or load the demo data (below).

## Demo data

```sh
pnpm db:seed
```

Creates 8 demo users (`olena`, `andriy`, `iryna`, `maksym`, `sofia`, `taras`, `dmytro`, `kateryna`, all with the password `password123`), 4 rooms with a few days of conversation, and prints the logins. The data also covers unread messages, a pending invite, a block, edited and deleted messages, join/leave lines and a room with more than one page of messages.

The same accounts, with their passwords, rooms and a "Log in as" button, are on the **http://localhost:5173/seeds** page. It needs no login, and the sign-in form links to it. The page lists only demo accounts that still have the demo password. `GET /api/seeds` behind it isn't served when `NODE_ENV=production`.

- `pnpm db:seed --reset` deletes the demo data and creates it again, with timestamps relative to now.
- `pnpm db:seed --clean` only deletes it.

Demo users are recognized by username. Deleting them also deletes the rooms they created, and their messages in other rooms.

## Mobile app

`apps/mobile` is an Expo app in the same workspace: it uses `@pm/shared` directly, so API changes show up as type errors in both clients. So far it covers signing in, the room list and a room's messages (reading, sending, live updates).

```sh
pnpm dev                  # the API has to be running
cd apps/mobile
cp .env.example .env      # optional, see below
pnpm start                # then press a for Android, i for iOS, or scan the QR code with Expo Go
```

`EXPO_PUBLIC_API_URL` in `apps/mobile/.env` is the address of the API server. Without it the app uses `http://10.0.2.2:3000` on the Android emulator and `http://localhost:3000` on the iOS simulator. On a phone, set it to your computer's LAN address, e.g. `http://192.168.1.20:3000`.

Building an APK to install on a phone: see [apps/mobile/README.md](apps/mobile/README.md).

How it differs from the web client:

- **Auth.** It signs in with `session: "token"` and sends `Authorization: Bearer <token>` instead of the cookie. The token is kept in `expo-secure-store`. Realtime uses the same header: in the WebSocket handshake, or for Pusher channel authorization.
- **Links.** `avatarUrl` and attachment `url` are paths on the API server. The app turns them into full URLs with `resolveApiUrl` from `@pm/shared` and loads images with the Bearer header, because attachments are served only to room members.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | runs the server (`tsx watch`) and the client (Vite) in parallel |
| `pnpm typecheck` | type-checks all packages |
| `pnpm build` | builds all packages |
| `pnpm db:up` | starts PostgreSQL in Docker |
| `pnpm db:generate` | generates a migration after changing `apps/server/src/db/schema.ts` |
| `pnpm db:migrate` | applies migrations |
| `pnpm db:seed` | creates demo users and conversations (see [Demo data](#demo-data)) |
| `pnpm db:studio` | opens Drizzle Studio to browse the database |
| `pnpm realtime:phoenix` | builds and runs the Phoenix realtime server in Docker (for `REALTIME_DRIVER=phoenix`) |

## Server structure

`apps/server/src` is split by domain into modules. Each module has three layers:

- **handlers** (`*.routes.ts`) parse and validate the request with the zod schemas from `@pm/shared`, call a service and send the response;
- **services** (`*.service.ts`) hold the rules (who may do what) and publish realtime events. They throw `AppError`s (`shared/errors.ts`), which become `{ error }` responses with the right status;
- **repositories** (`*.repository.ts`) are the only code that queries the database (Drizzle). Each is an interface plus a Drizzle implementation, so services can be tested with fakes.

| Module | Owns |
|---|---|
| `users` | accounts, profiles, avatars |
| `auth` | sessions, sign up / sign in, `requireAuth` |
| `blocks` | the block list |
| `chat` | rooms, members, invitations, messages, receipts, typing |
| `realtime` | publishing events (`RealtimePublisher`) through `WsGateway`, `PusherGateway` or `PhoenixGateway`, channel authorization, `/api/realtime` routes |
| `seeds` | demo accounts for `/seeds` |
| `docs` | OpenAPI document and Swagger UI |

Modules use each other only through the facade exported from their `index.ts`, never through another module's repository or tables. For example, `chat` stores people as ids and gets the `User`s from `UsersService`. Writes that span tables of one module run in one transaction through `Transactor` (`shared/transaction.ts`). `container.ts` creates and wires all repositories and services, `app.ts` mounts the routes, and `index.ts` starts the server.

## Real-time channels

| Channel | Events |
|---|---|
| `presence-online` | who is online, profile updates |
| `private-user-{id}` | invitations received or gone, the user joined or was removed from a room, their own poll votes (for their other tabs) |
| `private-room-{id}` | new, edited and deleted messages, poll results, typing, receipts, member and invite changes |

Each `subscribe` is checked by `RealtimeService`: anyone signed in may join `presence-online`, only the user their own `private-user-{id}`, only members of a room its `private-room-{id}`. Each connection has a socket id; clients send it back as `X-Socket-Id` on API calls, so events their request causes skip the connection that already has the result.

The client loads its initial state over REST: `GET /api/rooms` for the room list, and `GET /api/rooms/:id/messages` when a room is first opened. After that it keeps the state current from channel events.

## Realtime transport

`REALTIME_DRIVER` in `apps/server/.env` picks how events travel; restart the server after changing it. Nothing else changes: services publish through the `RealtimePublisher` interface, and the apps use the `RealtimeConnection` interface from `@pm/realtime-client`, with the same channel and event names either way. On start, the apps call `GET /api/realtime/config` and open the matching connection.

| | `ws` (default) | `pusher` | `phoenix` |
|---|---|---|---|
| Server | `WsGateway`: WebSocket endpoint at `/api/realtime/ws` on the API server | `PusherGateway`: Pusher HTTP API; signs subscriptions at `POST /api/realtime/pusher/auth` | `PhoenixGateway`: posts events to `apps/realtime-server-phoenix`, issues its connect tokens, answers its join checks |
| Clients | `RealtimeClient` | `createPusherConnection` wrapping pusher-js | `createPhoenixConnection` wrapping phoenix.js |
| Scaling | one API process (subscriptions live in its memory) | any number of API processes | any number of API processes; Phoenix itself can be clustered |
| Needs | nothing extra | a Pusher Channels app and the `PUSHER_*` variables | the Phoenix server running (`pnpm realtime:phoenix`) and `PHOENIX_SHARED_SECRET` |

**Own WebSocket.** Clients open a WebSocket to `/api/realtime/ws` on the API server. It is authenticated like HTTP requests: the session cookie for browsers (accepted only when `Origin` is the server's own host), `Authorization: Bearer` for mobile. The frames are defined in `packages/shared` (`ClientFrame`, `ServerFrame`). Running several server instances would need a shared bus (e.g. Redis pub/sub) between them.

**Pusher.** pusher-js connects to Pusher and gets private and presence channels signed by `POST /api/realtime/pusher/auth` (cookie on the web, Bearer on mobile). The adapter turns pusher-js's `pusher:subscription_succeeded`, `pusher:member_added` and so on into the same `realtime:*` events the own client emits. The apps load pusher-js only when this driver is on.

**Phoenix.** A separate Phoenix server holds the connections. The API publishes to it over HTTP, it asks the API whether a user may join a channel, and clients connect with a short-lived token from `GET /api/realtime/phoenix/token`. Details and how to run it: [apps/realtime-server-phoenix/README.md](apps/realtime-server-phoenix/README.md).

## Invitations

People don't join a room the moment they're added: they get an invitation and join once they accept it.

- `POST /api/rooms/:id/invites` with `{ "userIds": [...] }`. Any member can invite. Current members and people already invited are skipped. Creating a room with `inviteIds` invites those people the same way.
- `DELETE /api/rooms/:id/invites/:userId` cancels an invite. Only the room owner or whoever sent it can do that.
- `GET /api/invites` lists the current user's pending invitations: room name, who invited them, member count. An invited user can't read the room until they accept.
- `POST /api/invites/:roomId/accept` makes the user a member, posts a "joined the room" system message, and returns the `Room`. `POST /api/invites/:roomId/decline` drops the invitation.

Messages have a `kind`: `text` for regular ones, and system lines `member_joined` (someone accepted an invite) and `member_left` (someone left the room; being removed by the owner posts nothing). System messages arrive as `message:created` like any other, appear centered in the chat and as the room preview, don't count as unread, and can't be edited or deleted.

The invitee gets `invitation:added` / `invitation:removed` on their user channel and sees invitations at the top of the sidebar with Accept and Decline. Room members get `room:invites` on the room channel and see pending invites, with who sent them, in the member list. After a reconnect the client refetches invitations along with the room list.

## Editing and deleting messages

- `PATCH /api/rooms/:id/messages/:messageId` with `{ "text": "..." }`. Only the author can edit. The message gets `editedAt`, and the UI shows it as "edited".
- `DELETE /api/rooms/:id/messages/:messageId`. The author can delete their own messages, and the room owner can delete any message in the room. Deletion is soft: the row stays, with `deletedAt` set and the text wiped. The UI shows a placeholder ("This message was deleted", or "You deleted this message" for the author). Deleted messages can't be edited and don't count as unread.

Both endpoints return the updated `Message` and broadcast it on the room channel as `message:updated` or `message:deleted`. Since a message may arrive from a fetch and from an event in either order, the client keeps the most recent copy: a deletion beats any edit, and otherwise the later `editedAt` wins (`latestVersion` in `apps/client/src/lib/messageVersion.ts`).

## Polls

The room owner posts a poll with the 📊 button next to the composer. The form takes a question and 2–12 options (drag the handle to reorder them), plus:

| Setting | Effect |
|---|---|
| Multiple votes | voters may pick more than one option |
| Limit votes per person | with multiple votes: at most 2–10 options each |
| Anonymous poll | nobody, the owner included, sees who voted for what; only the counts |
| Suggest an option | members may add options of their own (the owner always can) |
| Add a comment | members may comment under the poll |

A poll is a message of kind `poll` with the poll in `Message.poll`. It shows up in the timeline, the room preview and the unread count like any message, and is deleted like one: by the owner, which also deletes its votes and comments. It can't be edited.

- `POST /api/rooms/:id/polls` creates it (owner only, `403` otherwise) and broadcasts `message:created`.
- `PUT /api/rooms/:id/polls/:messageId/votes` with `{ "optionIds": [...] }` replaces the caller's vote; `[]` takes it back.
- `POST /api/rooms/:id/polls/:messageId/options` and `.../comments` add an option or a comment, when the poll allows it.

Each of the last three returns the `Poll` as the caller sees it, with their own choice in `myVotes`, and sends the poll's new state to the room as `poll:updated` (`PollState`: the same for everyone, so without `myVotes`). A vote also goes to the voter's own channel as `poll:voted`, for their other tabs. Every change bumps `poll.version` under a row lock, and clients keep the copy with the higher version, so a stale fetch or a late event can't roll the results back.

Voters see the results (percentages of the people who voted, and who voted unless the poll is anonymous) once they have voted. The mobile app shows polls read-only for now.

## Recovering missed events after a reconnect

Neither transport stores events. Anything published while a client is disconnected (network loss, a laptop waking from sleep) never reaches it. `@pm/realtime-client` reconnects and resubscribes to every channel on its own, but the events from the gap are gone. Without a fix, the user would see holes in the message history, stale unread counts, and rooms they were added to or removed from that never show up or never go away.

The client fixes this by refetching the affected state once realtime is back.

**When it runs.** On reconnect, the client resubscribes every channel and fires `realtime:subscribed` on each one again. The client ignores the first subscription and treats any later one as a reconnect (`onResubscribed` in `apps/client/src/hooks/useRealtime.ts`). Because the refetch starts only after the channel is live again, every event published after the refetch arrives over the channel. Duplicates between the two sources are harmless, since merges are keyed by message id.

**User channel resubscribed → refresh the room list.** `useRooms.fetch()` reloads `GET /api/rooms`. That brings back rooms added or removed while offline, current members, last messages, unread counts and the user's own receipts. The result is merged with the local state (`keepNewer` in `apps/client/src/store/rooms.ts`). If a newer message arrived over realtime while the request was in flight, it is kept, and read/delivered watermarks only move forward. If the refresh fails, the current list stays instead of switching to an error screen.

**Room channel resubscribed → fetch the missed messages.** `useMessages.catchUp(roomId)` runs only for rooms whose messages are already loaded. It takes the id of the newest message it has and requests what came after it:

```
GET /api/rooms/:id/messages?after=<last id>
```

With `after`, the server returns the *oldest* page (up to 100) of messages with `id > after`, in ascending order. Without it, the endpoint returns the latest page, as on a first load. The client keeps requesting pages until it gets a short one, and merges each page by id along with the room's receipts.

Paging by `after` only finds new messages, not edits or deletions of ones the client already has. So once it has caught up, the client also refetches the latest page and merges it in. Edits and deletions in that page show up; older messages keep the version the client had.

**Edge cases.**

- **Far behind.** After 5 full pages (500+ missed messages) the client stops paging and reloads the room from its latest page, like a first open. Unsent messages are kept.
- **Never opened.** Rooms that were never opened are skipped. They load the latest page when the user opens them.
- **Failed first load.** A room whose first load failed is fetched again.
- **Repeated reconnects.** Catch-ups for the same room don't overlap.
- **Left room.** If the user leaves the room during a catch-up, the result is dropped.

**Limitation.** Recovery depends on the client noticing the dropped connection. The own client pings the server after 25 s of silence and reconnects if nothing comes back within 10 s, so a drop can go unnoticed for up to ~35 s; pusher-js and phoenix.js do the same with their own timeouts. Very short drops it doesn't detect cause no resubscription, so no refetch.
