import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import {
  MESSAGE_CREATED_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_UPDATED_EVENT,
  RECEIPT_UPDATED_EVENT,
  ROOM_ADDED_EVENT,
  ROOM_MEMBERS_EVENT,
  ROOM_REMOVED_EVENT,
  roomChannel,
  userChannel,
  type Receipt,
  type Room,
} from "@pm/shared";
import { api } from "../lib/api";
import { preview } from "../lib/format";
import { getRealtime, listen } from "../lib/realtime";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

/** Waits this long (ms) after a change before reloading the list, so a burst of messages reloads it once. */
const RELOAD_DELAY = 300;

/** Tells the server the latest message of each room reached this device (shown to its author as ✓✓). */
function reportDelivered(rooms: Room[]) {
  for (const room of rooms) {
    const latest = room.lastMessage?.id ?? 0;
    if (latest > room.myReceipt.deliveredUpTo) {
      api.updateReceipt(room.id, { deliveredUpTo: latest }).catch((e) => console.warn("Failed to report delivery:", e));
    }
  }
}

export default function RoomsScreen() {
  const me = useSession((s) => s.user)!;
  const signOut = useSession((s) => s.signOut);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await api.receiptsSettled(); // so a room that was just read comes back with no unread count
      const list = await api.getRooms();
      setRooms(list);
      reportDelivered(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const focused = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Reload whenever the list comes back into view (e.g. after reading a room).
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void load();
      return () => {
        focused.current = false;
        clearTimeout(reloadTimer.current);
      };
    }, [load]),
  );

  /** Reloads soon, if the list is on screen; otherwise the focus reload above catches up. */
  const scheduleReload = useCallback(() => {
    if (!focused.current) return;
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void load(), RELOAD_DELAY);
  }, [load]);

  // Unread counts and last messages, live: the server counts them, so any change in a room reloads the list.
  const roomIds = rooms?.map((r) => r.id).join(",") ?? "";
  useEffect(() => {
    const stops: (() => void)[] = [];
    let stopped = false;
    getRealtime()
      .then((conn) => {
        if (stopped) return;
        const roomHandlers = {
          [MESSAGE_CREATED_EVENT]: scheduleReload,
          [MESSAGE_UPDATED_EVENT]: scheduleReload,
          [MESSAGE_DELETED_EVENT]: scheduleReload,
          [ROOM_MEMBERS_EVENT]: scheduleReload,
          // Read on another device of mine.
          [RECEIPT_UPDATED_EVENT]: (r: Receipt) => r.userId === me.id && scheduleReload(),
        };
        for (const id of roomIds ? roomIds.split(",").map(Number) : []) {
          stops.push(listen(conn, roomChannel(id), roomHandlers));
        }
        stops.push(listen(conn, userChannel(me.id), { [ROOM_ADDED_EVENT]: scheduleReload, [ROOM_REMOVED_EVENT]: scheduleReload }));
      })
      .catch((e) => console.warn("Realtime is unavailable:", e));
    return () => {
      stopped = true;
      for (const stop of stops) stop();
    };
  }, [roomIds, me.id, scheduleReload]);

  // Events sent while the app was in the background may have been missed.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => state === "active" && scheduleReload());
    return () => sub.remove();
  }, [scheduleReload]);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => void signOut()} hitSlop={8}>
              <Text style={styles.headerButton}>Sign out</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={rooms ?? []}
        keyExtractor={(r) => String(r.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : undefined}
        ListEmptyComponent={rooms ? <Text style={styles.empty}>No rooms yet. Create one on the web for now.</Text> : undefined}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() =>
              router.push({
                pathname: "/rooms/[id]",
                params: {
                  id: String(item.id),
                  name: item.name,
                  owner: item.members.some((m) => m.user.id === me.id && m.role === "owner") ? "1" : "0",
                },
              })
            }
          >
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.preview} numberOfLines={1}>
                {item.lastMessage ? preview(item.lastMessage, me.id) : `${item.members.length} members`}
              </Text>
            </View>
            {item.unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
              </View>
            )}
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </>
  );
}

const styles = StyleSheet.create({
  headerButton: { color: colors.accent, fontSize: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.card },
  pressed: { opacity: 0.7 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  preview: { color: colors.muted },
  badge: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 11, backgroundColor: colors.accent },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600", textAlign: "center" },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  error: { color: colors.error, padding: 16 },
  empty: { color: colors.muted, padding: 16, textAlign: "center" },
});
