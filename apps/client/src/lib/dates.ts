/** Local calendar day of a timestamp, e.g. "2026-11-21", for grouping messages by day. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** "Today", "Yesterday", "Mon, 17 Nov" this year, "17 Nov 2025" for earlier years. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(iso) === dayKey(now.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return d.getFullYear() === now.getFullYear()
    ? d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })
    : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

import { hideLastSeen, type LastSeen } from "@pm/shared";

const APPROX_LABELS = {
  recently: "last seen recently",
  week: "last seen within a week",
  month: "last seen within a month",
  long_ago: "last seen a long time ago",
} as const;

/**
 * "last seen 5 min ago", or only roughly ("last seen recently") when they hide it, or when
 * `hideOwn`: as in Telegram, hiding your own last seen hides everyone's from you.
 */
export function lastSeenText(seen: LastSeen, hideOwn: boolean, now = new Date()): string {
  const shown = hideOwn ? hideLastSeen(seen, now.getTime()) : seen;
  return "at" in shown ? `last seen ${lastSeenLabel(shown.at, now)}` : APPROX_LABELS[shown.approx];
}

/**
 * When someone offline was last connected: "just now", "5 min ago", "today at 14:05",
 * "yesterday at 14:05", then the date ("17 Nov", or "17 Nov 2025" for earlier years).
 */
export function lastSeenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const minutes = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(iso) === dayKey(now.toISOString())) return `today at ${time}`;
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return `yesterday at ${time}`;
  return d.getFullYear() === now.getFullYear()
    ? d.toLocaleDateString([], { day: "numeric", month: "short" })
    : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}
