import { useState } from "react";
import type { Room, User } from "@pm/shared";
import { displayName } from "../lib/users";

/** Background colors for default avatars; all keep white text readable in both themes. */
const COLORS = [
  "#e5484d", // red
  "#f76b15", // orange
  "#d6a100", // amber
  "#30a46c", // green
  "#12a594", // teal
  "#0090ff", // blue
  "#3e63dd", // indigo
  "#8e4ec6", // violet
  "#d6409f", // pink
  "#7d5e54", // brown
];

/** Same user, same color: picked by id, so it survives a name change. */
export const avatarColor = (userId: number) => COLORS[userId % COLORS.length]!;

/** First letter of the display name (a whole emoji or other multi-unit character, not half of one). */
export const avatarInitial = (u: Pick<User, "name" | "username">) =>
  (Array.from(displayName(u).trim())[0] ?? "?").toUpperCase();

interface AvatarProps {
  user: Pick<User, "id" | "name" | "username" | "avatarUrl">;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

/** The user's uploaded photo, or a colored circle with their initial if there's none (or it fails to load). */
export function Avatar({ user, size = 32, className }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = user.avatarUrl && user.avatarUrl !== failedUrl ? user.avatarUrl : null;
  const classes = ["avatar", className].filter(Boolean).join(" ");
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) };

  if (url) {
    return (
      <img
        className={classes}
        style={style}
        src={url}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailedUrl(url)}
      />
    );
  }
  return (
    <span className={classes} style={{ ...style, background: avatarColor(user.id) }} aria-hidden="true">
      {avatarInitial(user)}
    </span>
  );
}

/** A room's picture, or a colored rounded square with the first letter of its name. */
export function RoomAvatar({
  room,
  size = 40,
  className,
}: {
  room: Pick<Room, "id" | "name" | "avatarUrl">;
  size?: number;
  className?: string;
}) {
  const asUser = { id: room.id, name: room.name, username: room.name, avatarUrl: room.avatarUrl };
  return <Avatar user={asUser} size={size} className={["room-avatar", className].filter(Boolean).join(" ")} />;
}
