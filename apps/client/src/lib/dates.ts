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
