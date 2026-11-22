import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { Room } from "@pm/shared";
import { absoluteUrl, authHeaders } from "../lib/api";

/** The web client's default-avatar colors, so a room looks the same on both. */
const COLORS = ["#e5484d", "#f76b15", "#d6a100", "#30a46c", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#7d5e54"];

/**
 * A room's picture (loaded with the Bearer header: it's served only to members and invitees),
 * or a colored rounded square with the first letter of its name.
 */
export function RoomAvatar({ room, size = 44 }: { room: Pick<Room, "id" | "name" | "avatarUrl">; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = room.avatarUrl && room.avatarUrl !== failedUrl ? room.avatarUrl : null;
  const box = { width: size, height: size, borderRadius: size * 0.28 };

  if (url) {
    return (
      <Image
        source={{ uri: absoluteUrl(url), headers: authHeaders() }}
        style={box}
        resizeMode="cover"
        onError={() => setFailedUrl(url)}
      />
    );
  }
  const initial = (Array.from(room.name.trim())[0] ?? "?").toUpperCase();
  return (
    <View style={[styles.fallback, box, { backgroundColor: COLORS[room.id % COLORS.length] }]}>
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.45) }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
  initial: { color: "#fff", fontWeight: "600" },
});
