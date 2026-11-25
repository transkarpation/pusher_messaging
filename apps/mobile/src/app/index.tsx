import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import {
  MESSAGE_DELETED_EVENT,
  MESSAGE_UPDATED_EVENT,
  RECEIPT_UPDATED_EVENT,
  ROOMS_MAX_PAGE_SIZE,
  ROOMS_PAGE_SIZE,
  ROOM_ACTIVITY_EVENT,
  ROOM_ADDED_EVENT,
  ROOM_MEMBERS_EVENT,
  ROOM_REMOVED_EVENT,
  ROOM_UPDATED_EVENT,
  roomChannel,
  userChannel,
  type Receipt,
  type Room,
} from "@pm/shared";
import { CreateRoomModal } from "../components/CreateRoomModal";
import { RoomAvatar } from "../components/RoomAvatar";
import { api } from "../lib/api";
import { preview } from "../lib/format";
import { getRealtime, listen } from "../lib/realtime";
import { useSession } from "../lib/session";
import { useStyles, type Colors } from "../lib/theme";

/** Waits this long (ms) after a change before reloading the list, so a burst of messages reloads it once. */
const RELOAD_DELAY = 300;

type RoomFilter = "all" | "unread";

/** Most recently active first, the order the server pages rooms in. */
const byActivity = (a: Room, b: Room) => b.activity - a.activity || b.id - a.id;

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
  const styles = useStyles(makeStyles);
  const me = useSession((s) => s.user)!;
  const signOut = useSession((s) => s.signOut);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [filter, setFilter] = useState<RoomFilter>("all");
  /** Rooms with unread messages, all of them (not only the loaded ones), for the "Unread" badge. */
  const [unreadRooms, setUnreadRooms] = useState(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  /** Continues the list past the loaded rooms; null once all are loaded. */
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** How many rooms are loaded, so a reload fetches as many (the pages scrolled through so far). */
  const loadedCount = useRef(0);
  loadedCount.current = rooms?.length ?? 0;
  /** Bumped by every reload, so a page requested before it isn't appended after. */
  const generation = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const openRoom = (room: Room) =>
    router.push({
      pathname: "/rooms/[id]",
      params: {
        id: String(room.id),
        name: room.name,
        avatar: room.avatarUrl ?? "",
        owner: room.members.some((m) => m.user.id === me.id && m.role === "owner") ? "1" : "0",
      },
    });

  /**
   * Reloads the rooms from the top: the first page, or as many as are loaded (up to ROOMS_MAX_PAGE_SIZE).
   * Under "Unread", rooms already shown stay when they've been read (as in Telegram), until the filter changes.
   */
  const load = useCallback(async () => {
    const gen = ++generation.current;
    const unread = filterRef.current === "unread";
    try {
      await api.receiptsSettled(); // so a room that was just read comes back with no unread count
      const limit = Math.min(Math.max(loadedCount.current, ROOMS_PAGE_SIZE), ROOMS_MAX_PAGE_SIZE);
      const [page, unreadIds] = await Promise.all([
        api.getRooms({ limit, unread }),
        api.getUnreadRoomIds().catch(() => null), // only for the badge
      ]);
      if (gen !== generation.current) return; // a newer reload (or a filter change) is under way
      if (unreadIds) setUnreadRooms(unreadIds.roomIds.length);
      const fetched = new Set(page.rooms.map((r) => r.id));
      const kept = unread ? (roomsRef.current ?? []).filter((r) => !fetched.has(r.id)).map((r) => ({ ...r, unreadCount: 0 })) : [];
      setRooms(kept.length > 0 ? [...page.rooms, ...kept].sort(byActivity) : page.rooms);
      setNextCursor(page.nextCursor);
      reportDelivered(page.rooms);
      setError(null);
    } catch (e) {
      if (gen === generation.current) setError((e as Error).message);
    }
  }, []);

  /** Appends the next page when the list is scrolled to its end. */
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    try {
      const page = await api.getRooms({ before: nextCursor, unread: filterRef.current === "unread" });
      if (gen !== generation.current) return; // reloaded meanwhile; that reload has the list
      setRooms((list) => {
        const known = new Set((list ?? []).map((r) => r.id));
        return [...(list ?? []), ...page.rooms.filter((r) => !known.has(r.id))];
      });
      setNextCursor(page.nextCursor);
      reportDelivered(page.rooms);
    } catch (e) {
      console.warn("Loading more rooms failed:", e);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  /** Shows the other filter's list from its first page. */
  const chooseFilter = (next: RoomFilter) => {
    if (next === filter) return;
    filterRef.current = next;
    setFilter(next);
    setRooms(null);
    setNextCursor(null);
    loadedCount.current = 0;
    roomsRef.current = null;
    void load();
  };

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
  // New messages in any room arrive on the user channel (ROOM_ACTIVITY_EVENT), loaded or not; the
  // channels of the loaded rooms report the rest (edits, deletions, members, renames, receipts).
  const roomIds = rooms?.map((r) => r.id).join(",") ?? "";
  useEffect(() => {
    const stops: (() => void)[] = [];
    let stopped = false;
    getRealtime()
      .then((conn) => {
        if (stopped) return;
        const roomHandlers = {
          [MESSAGE_UPDATED_EVENT]: scheduleReload,
          [MESSAGE_DELETED_EVENT]: scheduleReload,
          [ROOM_MEMBERS_EVENT]: scheduleReload,
          [ROOM_UPDATED_EVENT]: scheduleReload,
          // Read on another device of mine.
          [RECEIPT_UPDATED_EVENT]: (r: Receipt) => r.userId === me.id && scheduleReload(),
        };
        for (const id of roomIds ? roomIds.split(",").map(Number) : []) {
          stops.push(listen(conn, roomChannel(id), roomHandlers));
        }
        stops.push(
          listen(conn, userChannel(me.id), {
            [ROOM_ACTIVITY_EVENT]: scheduleReload,
            [ROOM_ADDED_EVENT]: scheduleReload,
            [ROOM_REMOVED_EVENT]: scheduleReload,
          }),
        );
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
      <View style={styles.screen}>
        <View style={styles.filters} accessibilityRole="tablist">
          {(["all", "unread"] as const).map((f) => (
            <Pressable
              key={f}
              style={[styles.filter, filter === f && styles.filterActive]}
              onPress={() => chooseFilter(f)}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === f }}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f === "all" ? "All" : "Unread"}
              </Text>
              {f === "unread" && unreadRooms > 0 && (
                <View style={[styles.filterBadge, filter === f && styles.filterBadgeActive]}>
                  <Text style={[styles.filterBadgeText, filter === f && styles.filterBadgeTextActive]}>
                    {unreadRooms > 99 ? "99+" : unreadRooms}
                  </Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
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
          ListEmptyComponent={
            rooms ? (
              <Text style={styles.empty}>
                {filter === "unread" ? "No unread messages." : "No rooms yet. Tap + to create one."}
              </Text>
            ) : undefined
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <Text style={styles.empty}>Loading more rooms…</Text> : undefined}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => openRoom(item)}
            >
              <RoomAvatar room={item} />
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
          contentContainerStyle={styles.listContent}
        />
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          onPress={() => setCreating(true)}
          accessibilityRole="button"
          accessibilityLabel="New room"
        >
          <Text style={styles.fabIcon}>+</Text>
        </Pressable>
      </View>
      <CreateRoomModal
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(room) => {
          setCreating(false);
          setRooms((list) => [room, ...(list ?? []).filter((r) => r.id !== room.id)]);
          openRoom(room);
        }}
      />
    </>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  screen: { flex: 1 },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  filter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterBadge: { minWidth: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: colors.accent },
  filterBadgeActive: { backgroundColor: colors.onAccent },
  filterBadgeText: { color: colors.onAccent, fontSize: 11, fontWeight: "600", lineHeight: 18, textAlign: "center" },
  filterBadgeTextActive: { color: colors.accent },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.muted, fontWeight: "600" },
  filterTextActive: { color: colors.onAccent },
  /** Room for the last row to scroll out from under the floating button. */
  listContent: { paddingBottom: 96 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  fabIcon: { color: colors.onAccent, fontSize: 30, lineHeight: 32 },
  headerButton: { color: colors.accent, fontSize: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.card },
  pressed: { opacity: 0.7 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  preview: { color: colors.muted },
  badge: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 11, backgroundColor: colors.accent },
  badgeText: { color: colors.onAccent, fontSize: 12, fontWeight: "600", textAlign: "center" },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  error: { color: colors.error, padding: 16 },
  empty: { color: colors.muted, padding: 16, textAlign: "center" },
});
