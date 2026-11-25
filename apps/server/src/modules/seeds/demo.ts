import type { Role } from "@pm/shared";

/**
 * Demo accounts created by `pnpm db:seed` (scripts/seed.ts) and listed on the public
 * /seeds page, so they can be used to log in and look around.
 */
export const DEMO_PASSWORD = "password123";

export const DEMO_USERS = [
  {
    username: "olena",
    name: "Олена Коваль",
    avatar: [229, 72, 77] as const,
    role: "superadmin",
    note: "Superadmin: manages admins and users on the Administration page. Unread messages in several rooms, a two-person room with andriy, has a photo",
  },
  { username: "andriy", name: "Андрій Шевчук", role: "admin", note: "Admin: manages users on the Administration page. Owner of «Frontend команда»" },
  {
    username: "iryna",
    name: "Ірина Бондар",
    avatar: [18, 165, 148] as const,
    note: "Has a pending invite to «Вихідні 🏔», has a photo",
  },
  { username: "maksym", name: "Максим Ткаченко", note: "Blocked taras: his messages are hidden in «Загальний»" },
  { username: "sofia", name: "Софія Мельник", note: "Owner of «Вихідні 🏔», posted a poll there (owners can create polls)" },
  { username: "taras", name: "Тарас Кравець", note: "Blocked by maksym (he isn't told); in roman's odd-numbered «Проєкт» rooms" },
  { username: "dmytro", name: "Дмитро Олійник", note: "Left «Вихідні 🏔»; in roman's even-numbered «Проєкт» rooms" },
  // Never set a name: shown as @kateryna.
  { username: "kateryna", name: null, note: "No name set; joined «Вихідні 🏔» by invite" },
  {
    username: "roman",
    name: "Роман Гнатюк",
    note: "In 100 «Проєкт» rooms with taras or dmytro: the room list loads 10 at a time as you scroll. Post in one of the old ones as taras or dmytro to see it jump to the top",
  },
] as const;

/** The role a demo account is seeded with. */
export const demoRoleOf = (u: (typeof DEMO_USERS)[number]): Role => ("role" in u ? u.role : "user");

export type DemoUsername = (typeof DEMO_USERS)[number]["username"];
export const DEMO_USERNAMES: DemoUsername[] = DEMO_USERS.map((u) => u.username);
