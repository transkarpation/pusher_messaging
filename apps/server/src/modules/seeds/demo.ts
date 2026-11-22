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
    note: "Unread messages in several rooms, a two-person room with andriy, has a photo",
  },
  { username: "andriy", name: "Андрій Шевчук", note: "Owner of «Frontend команда»" },
  {
    username: "iryna",
    name: "Ірина Бондар",
    avatar: [18, 165, 148] as const,
    note: "Has a pending invite to «Вихідні 🏔», has a photo",
  },
  { username: "maksym", name: "Максим Ткаченко", note: "Blocked taras: his messages are hidden in «Загальний»" },
  { username: "sofia", name: "Софія Мельник", note: "Owner of «Вихідні 🏔», posted a poll there (owners can create polls)" },
  { username: "taras", name: "Тарас Кравець", note: "Blocked by maksym (he isn't told)" },
  { username: "dmytro", name: "Дмитро Олійник", note: "Left «Вихідні 🏔»" },
  // Never set a name: shown as @kateryna.
  { username: "kateryna", name: null, note: "No name set; joined «Вихідні 🏔» by invite" },
] as const;

export type DemoUsername = (typeof DEMO_USERS)[number]["username"];
export const DEMO_USERNAMES: DemoUsername[] = DEMO_USERS.map((u) => u.username);
