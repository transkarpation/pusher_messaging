import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import type { Room } from "@pm/shared";
import { api } from "../lib/api";
import { preview } from "../lib/format";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

export default function RoomsScreen() {
  const me = useSession((s) => s.user)!;
  const signOut = useSession((s) => s.signOut);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRooms(await api.getRooms());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Reload whenever the list comes back into view (e.g. after reading a room).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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
            onPress={() => router.push({ pathname: "/rooms/[id]", params: { id: String(item.id), name: item.name } })}
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
