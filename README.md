# pusher-messaging

Real-time chat with rooms, messages (editable and deletable), typing indicators, delivered/read receipts and online presence. Real-time updates go through [Pusher Channels](https://pusher.com/channels).

## Stack

- **Server** (`apps/server`): Express 5, Drizzle ORM, PostgreSQL, Pusher
- **Client** (`apps/client`): React 19, Zustand, Vite, pusher-js
- **Shared** (`packages/shared`): zod schemas, types, channel and event names

## Requirements

- Node.js 22+
- pnpm. The version is pinned in `packageManager` in `package.json`; `corepack enable` is the easiest way to get it.
- Docker, for PostgreSQL
- A Pusher Channels app (the free plan is enough)

## Getting started

1. **Install dependencies**

   ```sh
   pnpm install
   ```

2. **Configure the environment**

   ```sh
   cp apps/server/.env.example apps/server/.env
   ```

   Create a Channels app in the [Pusher Dashboard](https://dashboard.pusher.com/), open **App Keys** and fill in `apps/server/.env`:

   | Variable | Description |
   |---|---|
   | `PUSHER_APP_ID` | `app_id` |
   | `PUSHER_KEY` | `key` |
   | `PUSHER_SECRET` | `secret` |
   | `PUSHER_CLUSTER` | the app's cluster, e.g. `eu` |
   | `DATABASE_URL` | points to the database from `docker-compose.yml` by default |
   | `PORT` | API port, `3000` by default |

   The client needs no `.env` of its own. It gets the key and cluster from `GET /api/realtime/config`.

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

   To try it out, register two users in different browsers (or a normal and a private window). Then create a room and add the second user.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | runs the server (`tsx watch`) and the client (Vite) in parallel |
| `pnpm typecheck` | type-checks all packages |
| `pnpm build` | builds all packages |
| `pnpm db:up` | starts PostgreSQL in Docker |
| `pnpm db:generate` | generates a migration after changing `apps/server/src/db/schema.ts` |
| `pnpm db:migrate` | applies migrations |
| `pnpm db:studio` | opens Drizzle Studio to browse the database |

## Real-time channels

| Channel | Events |
|---|---|
| `presence-online` | who is online, profile updates |
| `private-user-{id}` | the user was added to or removed from a room |
| `private-room-{id}` | new, edited and deleted messages, typing, receipts, member changes |

Private and presence channels are authorized via `POST /api/realtime/pusher/auth`. Only members of a room can subscribe to its channel.

The client loads its initial state over REST: `GET /api/rooms` for the room list, and `GET /api/rooms/:id/messages` when a room is first opened. After that it keeps the state current from channel events.

## Editing and deleting messages

- `PATCH /api/rooms/:id/messages/:messageId` with `{ "text": "..." }`. Only the author can edit. The message gets `editedAt`, and the UI shows it as "edited".
- `DELETE /api/rooms/:id/messages/:messageId`. The author can delete their own messages, and the room owner can delete any message in the room. Deletion is soft: the row stays, with `deletedAt` set and the text wiped. The UI shows a placeholder ("This message was deleted", or "You deleted this message" for the author). Deleted messages can't be edited and don't count as unread.

Both endpoints return the updated `Message` and broadcast it on the room channel as `message:updated` or `message:deleted`. Since a message may arrive from a fetch and from an event in either order, the client keeps the most recent copy: a deletion beats any edit, and otherwise the later `editedAt` wins (`latestVersion` in `apps/client/src/lib/messageVersion.ts`).

## Recovering missed events after a reconnect

Pusher does not store events. Anything published while a client is disconnected (network loss, a laptop waking from sleep) never reaches it. pusher-js reconnects and resubscribes to every channel on its own, but the events from the gap are gone. Without a fix, the user would see holes in the message history, stale unread counts, and rooms they were added to or removed from that never show up or never go away.

The client fixes this by refetching the affected state once realtime is back.

**When it runs.** On reconnect, pusher-js resubscribes every channel and fires `pusher:subscription_succeeded` on each one again. The client ignores the first subscription and treats any later one as a reconnect (`onResubscribed` in `apps/client/src/hooks/useRealtime.ts`). Because the refetch starts only after the channel is live again, every event published after the refetch arrives over the channel. Duplicates between the two sources are harmless, since merges are keyed by message id.

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

**Limitation.** Recovery depends on pusher-js noticing the dropped connection. Very short drops it doesn't detect cause no resubscription, so no refetch.
