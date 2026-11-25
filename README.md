# pusher-messaging

Real-time chat with rooms (with an optional picture), invitations, messages (editable and deletable) with file attachments, polls, typing indicators, delivered/read receipts, online presence, profiles with avatars, blocking users, and roles (user, admin, superadmin) with a user administration page. Real-time updates go through a Phoenix server (see [Realtime transport](#realtime-transport)).

## Stack

- **Server** (`apps/server`): Express 5, Drizzle ORM, PostgreSQL, `@aws-sdk/client-s3` for attachments in S3
- **Client** (`apps/client`): React 19, Zustand, Vite, phoenix.js
- **Mobile** (`apps/mobile`): Expo (React Native), Expo Router, phoenix.js. See [Mobile app](#mobile-app)
- **Realtime server, Phoenix** (`apps/realtime-server-phoenix`): Elixir, Phoenix channels and Presence; holds the clients' realtime connections. See [its README](apps/realtime-server-phoenix/README.md)
- **Shared** (`packages/shared`): zod schemas, types, channel and event names
- **Realtime client** (`packages/realtime-client`): the web and mobile apps' connection to the Phoenix server: a phoenix.js adapter with app-level channels, events and presence

## Requirements

- Node.js 22+
- pnpm. The version is pinned in `packageManager` in `package.json`; `corepack enable` is the easiest way to get it.
- Docker, for PostgreSQL and the Phoenix realtime server (or Elixir 1.15+ to run `apps/realtime-server-phoenix` without Docker)

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
   | `PHOENIX_SHARED_SECRET` | required: a long random string (e.g. `openssl rand -hex 32`) shared with the Phoenix server |
   | `PHOENIX_URL`, `PHOENIX_SOCKET_URL` | where the API reaches the Phoenix server and where clients connect; the defaults fit local development. See [its README](apps/realtime-server-phoenix/README.md) |
   | `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIX` | optional: an AWS S3 bucket for attachment files; without `S3_BUCKET` they're kept in Postgres. See [Attachment storage](#attachment-storage) |

   The clients need no `.env` for realtime. They get the Phoenix socket URL from `GET /api/realtime/config`.

3. **Start the database and run migrations**

   ```sh
   pnpm db:up
   pnpm db:migrate
   ```

   PostgreSQL listens on host port `5433`, so it doesn't clash with a local Postgres on `5432`.

4. **Run the server and the client**

   ```sh
   pnpm realtime:phoenix   # in its own terminal: the Phoenix realtime server on :4000
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

`olena` is a superadmin and `andriy` an admin, so the [administration page](#roles-and-administration) can be tried right away; the rest are plain users.

The same accounts, with their passwords, rooms and a "Log in as" button, are on the **http://localhost:5173/seeds** page. It needs no login, and the sign-in form links to it. The page lists only demo accounts that still have the demo password. `GET /api/seeds` behind it isn't served when `NODE_ENV=production`.

- `pnpm db:seed --reset` deletes the demo data and creates it again, with timestamps relative to now.
- `pnpm db:seed --clean` only deletes it.

Demo users are recognized by username. Deleting them also deletes the rooms they created, and their messages in other rooms.

## Roles and administration

Every account has a role: `user`, `admin` or `superadmin`. Each role manages only the roles below it:

| Role | Sees, creates and edits |
|---|---|
| `superadmin` | admins and users |
| `admin` | users |
| `user` | nobody |

Admins and superadmins get an **Admin** link in the sidebar of the web client. It opens **/admin**: a searchable table of the accounts they manage, sortable by username, name, role or creation date and split into pages (10–100 per page), a form to create one (username, password, optional name, role) and one to edit one (name, role, new password). A new password signs the account out on all devices. Nobody can edit their own account there, or give a role equal to or above their own. The server checks the same rules on `/api/admin/users` and reads the role on every request, so a demoted admin loses access at once.

Sign-ups are plain users. To make the first superadmin, give an existing account the role from the command line:

```sh
pnpm db:set-role <username> superadmin
```

Only the signed-in user's own role is sent to clients (`SessionUser` from `/api/auth/*`). Other people's `User` objects don't include roles.

## Mobile app

`apps/mobile` is an Expo app in the same workspace: it uses `@pm/shared` directly, so API changes show up as type errors in both clients. So far it covers signing in, the room list with live unread counts, a room's messages (reading, sending, live updates, delivered and read ticks) and polls.

```sh
pnpm dev                  # the API has to be running
cd apps/mobile
cp .env.example .env      # optional, see below
pnpm start                # then press a for Android, i for iOS, or scan the QR code with Expo Go
```

`EXPO_PUBLIC_API_URL` in `apps/mobile/.env` is the address of the API server. Without it the app uses `http://10.0.2.2:3000` on the Android emulator and `http://localhost:3000` on the iOS simulator. On a phone, set it to your computer's LAN address, e.g. `http://192.168.1.20:3000`.

Building an APK to install on a phone: see [apps/mobile/README.md](apps/mobile/README.md).

How it differs from the web client:

- **Auth.** It signs in with `session: "token"` and sends `Authorization: Bearer <token>` instead of the cookie. The token is kept in `expo-secure-store`. Realtime uses the same header to fetch its Phoenix connection token.
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
| `pnpm db:set-role <username> <role>` | gives an account the `user`, `admin` or `superadmin` role (see [Roles and administration](#roles-and-administration)) |
| `pnpm db:studio` | opens Drizzle Studio to browse the database |
| `pnpm realtime:phoenix` | builds and runs the Phoenix realtime server in Docker |

## Server structure

`apps/server/src` is split by domain into modules. Each module has three layers:

- **handlers** (`*.routes.ts`) parse and validate the request with the zod schemas from `@pm/shared`, call a service and send the response;
- **services** (`*.service.ts`) hold the rules (who may do what) and publish realtime events. They throw `AppError`s (`shared/errors.ts`), which become `{ error }` responses with the right status;
- **repositories** (`*.repository.ts`) are the only code that queries the database (Drizzle). Each is an interface plus a Drizzle implementation, so services can be tested with fakes.

| Module | Owns |
|---|---|
| `users` | accounts, roles, profiles, avatars |
| `auth` | sessions, sign up / sign in, `requireAuth`, `requireAdmin` |
| `admin` | who may see, create and edit which accounts (`/api/admin`) |
| `blocks` | the block list |
| `chat` | rooms, members, invitations, messages, receipts, typing |
| `realtime` | publishing events (`RealtimePublisher`) through `PhoenixGateway`, channel authorization, `/api/realtime` routes |
| `storage` | `S3Store` for attachment bytes in AWS S3, `S3_*` config |
| `seeds` | demo accounts for `/seeds` |
| `docs` | OpenAPI document and Swagger UI |

Modules use each other only through the facade exported from their `index.ts`, never through another module's repository or tables. For example, `chat` stores people as ids and gets the `User`s from `UsersService`. Writes that span tables of one module run in one transaction through `Transactor` (`shared/transaction.ts`). `container.ts` creates and wires all repositories and services, `app.ts` mounts the routes, and `index.ts` starts the server.

## Real-time channels

| Channel | Events |
|---|---|
| `presence-online` | who is online, profile updates |
| `private-user-{id}` | a new message in any of the user's rooms (`room:activity`), rooms pinned or unpinned (`room:pinned`), invitations received or gone, the user joined or was removed from a room, their own poll votes (for their other tabs) |
| `private-room-{id}` | new, edited and deleted messages, poll results, typing, receipts, member and invite changes, the room renamed or its picture changed |

Each `subscribe` is checked by `RealtimeService`: anyone signed in may join `presence-online`, only the user their own `private-user-{id}`, only members of a room its `private-room-{id}`. Each connection has a socket id; clients send it back as `X-Socket-Id` on API calls, so events their request causes skip the connection that already has the result.

The client loads its initial state over REST: the first page of `GET /api/rooms` for the room list (see [Room list paging](#room-list-paging)), and `GET /api/rooms/:id/messages` when a room is first opened. After that it keeps the state current from channel events.

## Room list paging

A user can be in many rooms, so the list is loaded a page at a time and only the loaded rooms' channels are joined.

- **Order.** `rooms.last_activity_at` is the time of the room's latest message, or of its creation if it has none; every new message moves it up (`MessagesRepository.create`), so a new room starts at the top. `Room.activity` is the same time in epoch milliseconds. `GET /api/rooms?limit=&before=` returns rooms by it, then by `id`, both descending: 10 by default, at most 100, so the first page holds the rooms with the most recent messages. `nextCursor` (`"{activity}.{id}"` of the last room) continues the list. Activity only goes up, so a room never moves down past the cursor and paging skips nothing.
- **New messages in rooms that aren't loaded.** Besides `message:created` on the room's channel, the API publishes `room:activity` (`{ roomId, message }`) to the internal topic `room-activity:{roomId}` on the Phoenix server, once per message. Each user's `private-user-{id}` channel listens to the topics of that user's rooms: the join grant lists them (`roomActivity`), and the channel follows `room:added` / `room:removed` afterwards. So every client hears about every message in its rooms without joining 50+ room channels, and the API sends one event per message, not one per member.
- **Web client** (`apps/client/src/store/rooms.ts`). `fetch()` loads the first page, or as many rooms as are loaded already (up to 100) when refreshing after a reconnect or a block list change, plus the remembered active room if it is further down. Scrolling to the end of the sidebar calls `fetchMore()`. On `room:activity` a loaded room moves up and gets the new preview and unread count; a room that isn't loaded is fetched with `GET /api/rooms/:id`. The list is sorted by `activity`, the same order as the server's.
- **Mobile** (`apps/mobile/src/app/index.tsx`). The list loads the next page when scrolled to its end, and reloads as many rooms as are loaded on `room:activity` and other changes.
- **Unread filter.** `GET /api/rooms?unread=1` returns only rooms with unread messages (the rule of `unreadCount`: live messages and polls by others, not by people the user blocked, past their read watermark), in the same order and with its own cursors. Both apps have an All / Unread switch above the list. The web store pages the two lists separately over the same rooms (`lists` in `useRooms`), and shows only the rooms each list has paged through, so loaded rooms further down never appear out of order. Under "Unread", a room that gets read stays in the list until the filter is switched, so the list doesn't shift under the pointer, as in Telegram. The Unread button shows how many rooms have unread messages, as Telegram's folder tabs do: `GET /api/rooms/unread` lists all of them (loaded or not); the web client counts its loaded rooms by their live `unreadCount` and the rest from that list, the mobile app takes the count with each reload.
- **Pinned rooms.** As in Telegram, each user can pin up to 5 rooms (`PUT` / `DELETE /api/rooms/:id/pin`, `room_members.pinned_at`). Pinned rooms stay at the top of their list, most recently pinned first; pinning one again moves it to the first place. They aren't paged: `RoomsPage.pinned` carries all of them with a first page (under `unread=1`, those with unread messages), and the other pages leave them out. `room:pinned` on the user channel updates the user's other tabs and devices. On the web, a pin button shows on hover in the room's row (pinned rooms without unread messages show a pin icon); on mobile, a long press on a room offers to pin or unpin it.

## Realtime transport

A separate Phoenix server (`apps/realtime-server-phoenix`) holds the clients' connections, channels and presence; the API stays the source of truth.

- **Server.** Services publish through the `RealtimePublisher` interface, implemented by `PhoenixGateway`: it posts events to the Phoenix server, issues the short-lived tokens clients connect with (`GET /api/realtime/phoenix/token`), and answers Phoenix's join checks (`POST /api/realtime/phoenix/authorize`).
- **Clients.** The apps call `GET /api/realtime/config` for the socket URL and connect through `createPhoenixConnection` from `@pm/realtime-client`, which wraps phoenix.js in the `RealtimeConnection` interface.
- **Scaling.** Any number of API processes; Phoenix itself can be clustered.

Details and how to run it: [apps/realtime-server-phoenix/README.md](apps/realtime-server-phoenix/README.md).

## Attachment storage

Attachment files are kept in Postgres (the `attachment_data` table) unless an AWS S3 bucket is configured in `apps/server/.env`:

| Variable | Description |
|---|---|
| `S3_BUCKET` | the bucket; setting it switches new uploads to S3 |
| `S3_REGION` | the bucket's region, e.g. `eu-central-1` (required with `S3_BUCKET`) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | an IAM user's keys; leave both empty to use the default AWS credentials (`AWS_*` variables, `~/.aws` profile, EC2/ECS role) |
| `S3_PREFIX` | prepended to object keys, `attachments/` by default |

Restart the server after changing them; it logs which storage is on. Objects are named `{S3_PREFIX}{roomId}/{uuid}`. The credentials need `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `arn:aws:s3:::{bucket}/{S3_PREFIX}*`.

Each attachment row remembers where its bytes are (`attachments.storage_key`: an S3 key, or null for Postgres), so turning S3 on needs no migration: files uploaded before keep being served from Postgres. Removing `S3_BUCKET` later sends new uploads back to Postgres, but files already in S3 can then no longer be read.

Downloads still go through `GET /api/rooms/{roomId}/attachments/{id}`, so the bucket stays private (block all public access): the server checks room membership and reads the object. When a message is deleted, or an unsent upload expires, its object is deleted from the bucket after the database change; a failed delete is logged and leaves an orphaned object.

## Room name and picture

A room can get a picture when it's created (`avatar` in `POST /api/rooms`: a PNG, JPEG or WebP image up to 1 MB, base64-encoded; the web client crops it to a 256 px square first). Afterwards the owner can rename the room and change or remove the picture with `PATCH /api/rooms/:id` (the ✎ button in the room header on the web). Each actual change posts a system line ("Olena renamed the room to «…»", "… changed the room picture"), members get `room:updated` on the room channel, and people invited get `invitation:added` again with the new name and picture. Rooms without a picture show a colored rounded square with the first letter of the name.

The picture is served at `/api/rooms/:id/avatar?v=…` to members and to people invited (so the invitation can show it); the `v` changes with every new picture, so responses are cached for good.

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

Voters see the results (percentages of the people who voted, and who voted unless the poll is anonymous) once they have voted. The mobile app has polls too: the room owner creates them with 📊 next to the message field (options are reordered with ↑ ↓ instead of dragging), and members vote, suggest options and comment.

## Recovering missed events after a reconnect

The realtime server doesn't store events. Anything published while a client is disconnected (network loss, a laptop waking from sleep) never reaches it. `@pm/realtime-client` reconnects and resubscribes to every channel on its own, but the events from the gap are gone. Without a fix, the user would see holes in the message history, stale unread counts, and rooms they were added to or removed from that never show up or never go away.

The client fixes this by refetching the affected state once realtime is back.

**When it runs.** On reconnect, the client resubscribes every channel and fires `realtime:subscribed` on each one again. The client ignores the first subscription and treats any later one as a reconnect (`onResubscribed` in `apps/client/src/hooks/useRealtime.ts`). Because the refetch starts only after the channel is live again, every event published after the refetch arrives over the channel. Duplicates between the two sources are harmless, since merges are keyed by message id.

**User channel resubscribed → refresh the room list.** `useRooms.fetch()` reloads the top of `GET /api/rooms`, as many rooms as were loaded. That brings back rooms added or removed while offline, current members, last messages, unread counts and the user's own receipts. The result is merged with the local state (`keepNewer` in `apps/client/src/store/rooms.ts`). If a newer message arrived over realtime while the request was in flight, it is kept, and read/delivered watermarks only move forward. If the refresh fails, the current list stays instead of switching to an error screen.

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

**Limitation.** Recovery depends on the client noticing the dropped connection. phoenix.js sends a heartbeat every 30 s and reconnects when one goes unanswered, so a drop can go unnoticed for up to about a minute. Very short drops it doesn't detect cause no resubscription, so no refetch.
