/**
 * Fills the database with demo users, rooms and conversations to log in and look around.
 *
 *   pnpm db:seed           create the demo data (refuses if demo users already exist)
 *   pnpm db:seed --reset   delete the demo data and create it again (fresh timestamps)
 *   pnpm db:seed --clean   only delete the demo data
 *
 * Demo users are recognized by username (see src/modules/seeds/demo.ts, also shown on the /seeds page);
 * deleting them also deletes the rooms they created.
 */
import { deflateSync } from "node:zlib";
import { and, eq, inArray, sql } from "drizzle-orm";
import { MESSAGES_PAGE_SIZE } from "@pm/shared";
import { db, schema } from "../src/db/index.js";
import { DEMO_PASSWORD as PASSWORD, DEMO_USERNAMES, DEMO_USERS as USERS, demoRoleOf, type DemoUsername as Username } from "../src/modules/seeds/demo.js";
import { hashPassword } from "../src/modules/auth/password.js";

/** A scripted line: who, what, and how many minutes after the previous line. */
type Line =
  | [Username, string, number]
  | [Username, string, number, { edited?: boolean; deleted?: boolean }]
  | ["joined" | "left", Username, number]
  | ["poll", Username, number, DemoPoll];

/** A poll posted by the room owner: options with who voted for them, and comments. */
interface DemoPoll {
  question: string;
  options: [text: string, voters: Username[]][];
  multiple?: boolean;
  anonymous?: boolean;
  allowSuggestions?: boolean;
  allowComments?: boolean;
  comments?: [Username, string][];
}

interface RoomSpec {
  name: string;
  owner: Username;
  members: Username[];
  /** Days ago the room was created; the first line is posted a bit later. */
  createdDaysAgo: number;
  /** Conversation, possibly split into days with `day(n)` markers. */
  script: (Line | { daysAgo: number; at: string })[];
  /** Pending invites: [invited, invitedBy]. */
  invites?: [Username, Username][];
  /** Members who haven't read the last N messages (others have read everything). */
  unread?: Partial<Record<Username, number>>;
}

const day = (daysAgo: number, at: string) => ({ daysAgo, at });

const ROOMS: RoomSpec[] = [
  {
    name: "Frontend команда",
    owner: "andriy",
    members: ["andriy", "olena", "iryna", "maksym"],
    createdDaysAgo: 4,
    script: [
      day(4, "10:02"),
      ["andriy", "Всім привіт! Створив кімнату для фронтенду, сюди кидаємо все по UI", 0],
      ["olena", "Супер, давно треба було", 2],
      ["iryna", "👋", 1],
      ["andriy", "Нагадую: в п'ятницю демо нового онбордингу", 15],
      ["maksym", "Я ще не доробив сторінку профілю, але до п'ятниці встигну", 4],
      day(3, "09:41"),
      ["olena", "Хтось бачив, що білд впав на main?", 0],
      ["iryna", "Так, це через оновлення vite. Вже фікшу", 3],
      ["iryna", "Готово, перезапустила пайплайн", 22],
      ["olena", "Дякую!", 1],
      ["maksym", "Питання: робимо аватарки круглими чи з заокругленими кутами?", 47],
      ["andriy", "Круглими, як у всіх месенджерах", 2],
      ["olena", "+1 за круглі", 1],
      ["maksym", "Ок, і якщо фото нема — кольоровий кружечок з першою літерою", 3, { edited: true }],
      day(1, "14:15"),
      ["andriy", "Демо пройшло добре, дякую всім 🎉", 0],
      ["andriy", "Фідбек від продакту:\n1. Кнопка «Надіслати» замала на мобілці\n2. Хочуть темну тему за замовчуванням\n3. Онбординг задовгий", 1],
      ["iryna", "Темна тема вже є, просто вона за системою", 6],
      ["maksym", "Кнопку можу взяти я", 2],
      ["olena", "Тоді я онбординг", 1],
      ["olena", "Ой, не туди написала", 1, { deleted: true }],
      day(0, "09:30"),
      ["iryna", "Доброго ранку! Хто сьогодні на код рев'ю?", 0],
      ["maksym", "Я можу після обіду", 5],
      ["andriy", "Скинь лінк на PR, гляну", 8],
    ],
    unread: { olena: 3 },
  },
  {
    name: "Вихідні 🏔",
    owner: "sofia",
    members: ["sofia", "olena", "taras", "dmytro"],
    createdDaysAgo: 2,
    script: [
      day(2, "19:20"),
      ["sofia", "Хто їде в Карпати в суботу?", 0],
      ["taras", "Я!", 3],
      ["dmytro", "Я теж, якщо буде місце в машині", 5],
      ["olena", "Можу взяти двох", 12],
      ["sofia", "Тоді: Олена везе мене і Дмитра, Тарас їде своєю", 2],
      ["taras", "Ок. Виїзд о 7:00?", 1],
      ["dmytro", "О 7 це жорстоко 😅", 1],
      ["sofia", "О 7:30, остаточно", 2],
      ["joined", "kateryna", 30],
      ["kateryna", "Привіт! Мене Софія покликала, можна з вами?", 1],
      ["sofia", "Звісно!", 2],
      day(1, "21:05"),
      ["taras", "Прогноз: сонячно, +12", 0],
      [
        "poll",
        "sofia",
        6,
        {
          question: "Що готуємо ввечері біля вогнища?",
          options: [
            ["Шашлик", ["sofia", "taras", "kateryna"]],
            ["Банош", ["olena", "taras"]],
            ["Печена картопля", ["kateryna"]],
          ],
          multiple: true,
          allowSuggestions: true,
          allowComments: true,
          comments: [["taras", "Банош обов'язково 😋"]],
        },
      ],
      ["olena", "Беріть теплі речі, ввечері буде холодно", 4],
      ["left", "dmytro", 40],
      ["sofia", "Дмитро не зможе, захворів 😔", 3],
      ["kateryna", "Шкода. Тоді в машині Олени буде місце для мене?", 2],
      ["olena", "Так, звісно", 1],
    ],
    invites: [["iryna", "sofia"]],
    unread: { taras: 2 },
  },
  {
    name: "Олена & Андрій",
    owner: "olena",
    members: ["olena", "andriy"],
    createdDaysAgo: 1,
    script: [
      day(1, "12:00"),
      ["olena", "Підемо на обід?", 0],
      ["andriy", "Давай за 10 хв", 1],
      ["olena", "Ок, я внизу", 9],
      day(0, "11:48"),
      ["andriy", "Сьогодні знову в ту піцерію?", 0],
      ["olena", "Можна щось нове. Там поруч відкрили рамен", 3],
      ["andriy", "О, давай", 1],
    ],
    unread: { olena: 1 },
  },
];

/** A big room with generated small talk, many pages long, to scroll back through history. */
const GENERAL = {
  name: "Загальний",
  owner: "olena" as Username,
  members: USERS.map((u) => u.username) as Username[],
  days: 14,
  messages: 400,
};

const PHRASES = [
  "Доброго ранку всім ☕",
  "Хто бачив мої навушники? Залишив у переговорці",
  "У кого є зарядка для макбука?",
  "Нагадую, що завтра всі на мітинг о 10",
  "Привезли каву в офіс!",
  "Обід у когось є плани?",
  "Дякую всім за сьогодні",
  "Хтось знає, коли оновлять VPN?",
  "Скиньте, будь ласка, лінк на документ з планами",
  "Я сьогодні працюю з дому",
  "Ахаха 😂",
  "+1",
  "Погоджуюсь",
  "Гарних вихідних!",
  "Хто йде на день народження Тараса в п'ятницю?",
  "Принесла печиво на кухню 🍪",
  "Хто останній виходить — вимкніть кондиціонер",
  "А можна детальніше?",
  "Ок, зрозумів",
  "Зараз гляну",
  "Чудова ідея!",
  "Не встигаю, перенесемо на завтра?",
  "Хтось замовляв кур'єра? Він внизу",
  "Нова версія задеплоєна 🚀",
];

/** Many small rooms for one user, to page through the room list (`roman`, see demo.ts). */
const MANY = {
  user: "roman" as Username,
  rooms: 100,
  /** Odd-numbered rooms are shared with taras, even ones with dmytro, every 5th with both. */
  partners: ["taras", "dmytro"] as Username[],
  /** Old rooms roman pinned to the top of his list, first pinned first (so the last one is on top). */
  pinned: [80, 45],
  topics: ["Бекенд", "Дизайн", "Маркетинг", "Мобілка", "Аналітика", "Інфраструктура", "Підтримка", "Документація", "Тестування", "Найм"],
};

/** Room `n` (1-based) of MANY: a few messages ending `n * 13` hours ago, so room 1 is the most recent. */
function manyRoom(n: number, rand: () => number) {
  const partner = MANY.partners[(n + 1) % 2]!;
  const members: Username[] = n % 5 === 0 ? [MANY.user, ...MANY.partners] : [MANY.user, partner];
  const lastAt = new Date(Date.now() - n * 13 * 60 * 60_000);
  const count = 2 + Math.floor(rand() * 4);
  const messages: ScriptRow[] = Array.from({ length: count }, (_, i) => ({
    author: members[(i + n) % members.length]!,
    kind: "text" as const,
    text: PHRASES[Math.floor(rand() * PHRASES.length)]!,
    createdAt: addMinutes(lastAt, -(count - 1 - i) * 7),
  }));
  return {
    spec: {
      name: `Проєкт ${String(n).padStart(3, "0")} · ${MANY.topics[n % MANY.topics.length]}`,
      owner: n % 3 === 0 ? MANY.user : partner,
      members,
      createdAt: addMinutes(lastAt, -24 * 60),
    },
    messages,
    // Every 6th room has a few messages roman hasn't read, so unread badges show up further down too.
    unread: n % 6 === 0 ? { [MANY.user]: Math.min(2, count) } : undefined,
  };
}

/** Deterministic PRNG, so every seed produces the same conversation. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tiny 64×64 PNG with a diagonal gradient of the given color, as a demo avatar. */
function gradientPng([r, g, b]: readonly [number, number, number]): Buffer {
  const size = 64;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const k = 0.55 + 0.45 * ((x + y) / (2 * size));
      raw.set([Math.round(r * k), Math.round(g * k), Math.round(b * k)], row + 1 + x * 3);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** `daysAgo` days before today at local time "HH:MM". */
function dateAt(daysAgo: number, at: string): Date {
  const [h, m] = at.split(":").map(Number);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h!, m!, 0, 0);
  return d;
}
const addMinutes = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

const usernames = DEMO_USERNAMES;

/** Who is in the room after the script ran: initial members, plus "joined" lines, minus "left" ones. */
function finalMembers(spec: { members: Username[]; script?: RoomSpec["script"] }): Username[] {
  const members = new Set(spec.members);
  for (const item of spec.script ?? []) {
    if (!Array.isArray(item)) continue;
    if (item[0] === "joined") members.add(item[1] as Username);
    if (item[0] === "left") members.delete(item[1] as Username);
  }
  return [...members];
}

async function clean(): Promise<number> {
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.username, usernames));
  if (existing.length === 0) return 0;
  const ids = existing.map((u) => u.id);
  // Rooms they created would otherwise stay behind with `created_by` set to null.
  await db.delete(schema.rooms).where(inArray(schema.rooms.createdBy, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids)); // cascades everything else
  return ids.length;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MessageRow = typeof schema.messages.$inferInsert;
/** A message to insert, by username, with its poll if it's one. */
type ScriptRow = Omit<MessageRow, "roomId" | "userId"> & { author: Username; poll?: DemoPoll };

/** Inserts a room with its members and messages (in order), and sets receipts. */
async function insertRoom(
  tx: Tx,
  ids: Record<Username, number>,
  spec: { name: string; owner: Username; members: Username[]; createdAt: Date },
  messages: ScriptRow[],
  opts: { invites?: [Username, Username][]; unread?: Partial<Record<Username, number>> } = {},
): Promise<number> {
  const [room] = await tx
    .insert(schema.rooms)
    .values({
      name: spec.name,
      createdBy: ids[spec.owner],
      createdAt: spec.createdAt,
      // Messages are inserted directly, so set what posting them would have.
      lastActivityAt: messages.at(-1)?.createdAt ?? spec.createdAt,
    })
    .returning({ id: schema.rooms.id });
  const roomId = room!.id;

  // Members who join by a "joined" line become members at that moment; "left" ones aren't members any more.
  const joinedAt = new Map<Username, Date>(spec.members.map((u) => [u, spec.createdAt]));
  for (const m of messages) {
    if (m.kind === "member_joined") joinedAt.set(m.author, m.createdAt as Date);
    if (m.kind === "member_left") joinedAt.delete(m.author);
  }
  await tx.insert(schema.roomMembers).values(
    [...joinedAt].map(([u, at]) => ({
      roomId,
      userId: ids[u],
      role: u === spec.owner ? ("owner" as const) : ("member" as const),
      joinedAt: at,
    })),
  );

  const inserted =
    messages.length === 0
      ? []
      : await tx
          .insert(schema.messages)
          .values(messages.map(({ author, poll: _, ...m }) => ({ ...m, roomId, userId: ids[author] })))
          .returning({ id: schema.messages.id });
  const msgIds = inserted.map((r) => r.id);

  for (const [i, m] of messages.entries()) {
    if (m.poll) await insertPoll(tx, ids, msgIds[i]!, m.author, m.poll, m.createdAt as Date);
  }

  if (msgIds.length > 0) {
    const last = msgIds[msgIds.length - 1]!;
    await tx.insert(schema.receipts).values(
      [...joinedAt.keys()].map((u) => {
        const behind = opts.unread?.[u] ?? 0;
        const readUpTo = behind > 0 ? (msgIds[msgIds.length - 1 - behind] ?? 0) : last;
        return { roomId, userId: ids[u], deliveredUpTo: last, readUpTo };
      }),
    );
  }

  if (opts.invites?.length) {
    await tx.insert(schema.roomInvites).values(
      opts.invites.map(([user, by]) => ({ roomId, userId: ids[user], invitedBy: ids[by] })),
    );
  }
  return roomId;
}

async function insertPoll(tx: Tx, ids: Record<Username, number>, messageId: number, author: Username, poll: DemoPoll, at: Date) {
  const { question, options, comments = [], ...flags } = poll;
  await tx.insert(schema.polls).values({ messageId, question, ...flags, version: 1 });
  const optionRows = await tx
    .insert(schema.pollOptions)
    .values(options.map(([text], position) => ({ messageId, text, position, addedBy: ids[author] })))
    .returning({ id: schema.pollOptions.id });
  const votes = options.flatMap(([, voters], i) =>
    voters.map((u, n) => ({ optionId: optionRows[i]!.id, messageId, userId: ids[u], createdAt: addMinutes(at, 1 + n) })),
  );
  if (votes.length) await tx.insert(schema.pollVotes).values(votes);
  if (comments.length) {
    await tx
      .insert(schema.pollComments)
      .values(comments.map(([u, text], n) => ({ messageId, userId: ids[u], text, createdAt: addMinutes(at, 5 + n) })));
  }
}

/** Turns a script into message rows with absolute timestamps. */
function scriptToMessages(spec: RoomSpec) {
  let at = addMinutes(dateAt(spec.createdDaysAgo, "09:00"), 0);
  const rows: ScriptRow[] = [];
  for (const item of spec.script) {
    if (!Array.isArray(item)) {
      at = dateAt(item.daysAgo, item.at);
      continue;
    }
    if (item[0] === "poll") {
      const [, who, after, poll] = item;
      at = addMinutes(at, after);
      rows.push({ author: who, kind: "poll", text: "", createdAt: at, poll });
      continue;
    }
    if (item[0] === "joined" || item[0] === "left") {
      const [what, who, after] = item;
      at = addMinutes(at, after);
      rows.push({ author: who, kind: what === "joined" ? "member_joined" : "member_left", text: "", createdAt: at });
      continue;
    }
    const [author, text, after, flags] = item;
    at = addMinutes(at, after);
    rows.push({
      author,
      kind: "text",
      text: flags?.deleted ? "" : text,
      createdAt: at,
      editedAt: flags?.edited ? addMinutes(at, 2) : null,
      deletedAt: flags?.deleted ? addMinutes(at, 1) : null,
    });
  }
  return rows;
}

function generalMessages() {
  const rand = mulberry32(42);
  const start = dateAt(GENERAL.days, "09:00");
  const span = Date.now() - 60 * 60_000 - start.getTime(); // up to an hour ago
  const times = Array.from({ length: GENERAL.messages }, () => start.getTime() + rand() * span).sort((a, b) => a - b);
  return times.map((t) => ({
    author: GENERAL.members[Math.floor(rand() * GENERAL.members.length)]!,
    kind: "text" as const,
    text: PHRASES[Math.floor(rand() * PHRASES.length)]!,
    createdAt: new Date(t),
  }));
}

async function seed() {
  const passwordHash = await hashPassword(PASSWORD);

  await db.transaction(async (tx) => {
    const rows = await tx
      .insert(schema.users)
      .values(
        USERS.map((u) => ({
          username: u.username,
          name: u.name,
          passwordHash,
          role: demoRoleOf(u),
          avatarUpdatedAt: "avatar" in u ? new Date() : null,
        })),
      )
      .returning({ id: schema.users.id, username: schema.users.username });
    const ids = Object.fromEntries(rows.map((r) => [r.username, r.id])) as Record<Username, number>;

    const avatars = USERS.flatMap((u) =>
      "avatar" in u ? [{ userId: ids[u.username], contentType: "image/png", data: gradientPng(u.avatar) }] : [],
    );
    if (avatars.length) await tx.insert(schema.userAvatars).values(avatars);

    await insertRoom(
      tx,
      ids,
      { ...GENERAL, createdAt: addMinutes(dateAt(GENERAL.days, "09:00"), -30) },
      generalMessages(),
      { unread: { olena: 12, andriy: 5 } },
    );
    for (const spec of ROOMS) {
      const createdAt = dateAt(spec.createdDaysAgo, "08:00");
      await insertRoom(tx, ids, { ...spec, createdAt }, scriptToMessages(spec), spec);
    }
    const rand = mulberry32(7);
    for (let n = 1; n <= MANY.rooms; n++) {
      const { spec, messages, unread } = manyRoom(n, rand);
      const roomId = await insertRoom(tx, ids, spec, messages, { unread });
      const pin = MANY.pinned.indexOf(n);
      if (pin >= 0) {
        await tx
          .update(schema.roomMembers)
          .set({ pinnedAt: addMinutes(new Date(), pin - MANY.pinned.length) })
          .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, ids[MANY.user])));
      }
    }

    // Maksym blocked Taras: Taras's messages are hidden from Maksym in "Загальний".
    await tx.insert(schema.userBlocks).values({ blockerId: ids.maksym, blockedId: ids.taras });
  });
}

async function main() {
  const flag = process.argv[2];
  if (flag && flag !== "--reset" && flag !== "--clean") {
    console.error(`Unknown option ${flag}. Use --reset or --clean.`);
    process.exit(1);
  }

  if (flag === "--clean" || flag === "--reset") {
    const removed = await clean();
    console.log(`Deleted ${removed} demo user(s) and their rooms.`);
    if (flag === "--clean") return;
  } else {
    const existing = await db
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(inArray(schema.users.username, usernames));
    if (existing.length > 0) {
      console.error(
        `Demo users already exist (${existing.map((u) => u.username).join(", ")}).\n` +
          "Run `pnpm db:seed --reset` to recreate them, or `pnpm db:seed --clean` to delete them.",
      );
      process.exit(1);
    }
  }

  await seed();

  console.log("\nDemo data created. Log in with any of these (password for all: " + PASSWORD + "):\n");
  console.table(
    USERS.map((u) => ({
      username: u.username,
      password: PASSWORD,
      role: demoRoleOf(u),
      name: u.name ?? "(not set)",
      rooms: [
        ...[GENERAL, ...ROOMS].filter((r) => finalMembers(r).includes(u.username)).map((r) => r.name),
        ...(u.username === MANY.user ? [`${MANY.rooms} «Проєкт» rooms`] : []),
        ...(MANY.partners.includes(u.username) ? [`${MANY.rooms / 2 + MANY.rooms / 10} of roman's «Проєкт» rooms`] : []),
      ].join(", "),
    })),
  );
  console.log(
    [
      "Worth a look:",
      ...USERS.map((u) => `  - ${u.username}: ${u.note}`),
      `  - «Загальний»: ${GENERAL.messages} messages over ${GENERAL.days} days (${Math.ceil(GENERAL.messages / MESSAGES_PAGE_SIZE)} pages of ${MESSAGES_PAGE_SIZE}); «Frontend команда» is a bit over one page`,
      "",
      "The same list is on the /seeds page of the client (no login needed).",
    ].join("\n"),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
