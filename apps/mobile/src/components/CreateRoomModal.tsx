import { useEffect, useState } from "react";
import { FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createRoomSchema, type Room, type User } from "@pm/shared";
import { api } from "../lib/api";
import { displayName } from "../lib/format";
import { pickRoomPicture, type PickedPicture } from "../lib/roomPicture";
import { useStyles, type Colors } from "../lib/theme";
import { RoomAvatar } from "./RoomAvatar";

const SEARCH_DEBOUNCE_MS = 250;
const PICTURE_SIZE = 72;

/**
 * The form for a new room, as on the web: a picture, a name and the people to invite (they join once they
 * accept). `onCreated` gets the room, with the current user as its owner.
 */
export function CreateRoomModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (room: Room) => void;
}) {
  const styles = useStyles(makeStyles);
  const [name, setName] = useState("");
  const [invitees, setInvitees] = useState<User[]>([]);
  const [picture, setPicture] = useState<PickedPicture | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // On Android the modal covers the whole screen, status and navigation bars included (on iOS it's a
  // sheet below the status bar), so keep the header and the list's end clear of them.
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "android" ? insets.top : 0;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .searchUsers(query.trim())
        .then((users) => !cancelled && setResults(users))
        .catch((e) => !cancelled && setError((e as Error).message));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, visible]);

  const reset = () => {
    setName("");
    setInvitees([]);
    setPicture(null);
    setQuery("");
    setError(null);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const selectedIds = new Set(invitees.map((u) => u.id));
  const toggle = (user: User) =>
    setInvitees((list) => (list.some((u) => u.id === user.id) ? list.filter((u) => u.id !== user.id) : [...list, user]));

  const choosePicture = async () => {
    try {
      const picked = await pickRoomPicture();
      if (picked) {
        setPicture(picked);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async () => {
    const parsed = createRoomSchema.safeParse({ name, inviteIds: invitees.map((u) => u.id), avatar: picture?.base64 });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const room = await api.createRoom(parsed.data);
      reset();
      onCreated(room);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const header = (
    <View style={styles.form}>
      <View style={styles.pictureRow}>
        <Pressable onPress={() => void choosePicture()} disabled={submitting} accessibilityRole="button" accessibilityLabel="Choose a picture">
          {picture ? (
            <Image source={{ uri: picture.uri }} style={styles.picture} />
          ) : (
            <RoomAvatar room={{ id: 0, name: name || "?", avatarUrl: null }} size={PICTURE_SIZE} />
          )}
        </Pressable>
        <View style={styles.pictureActions}>
          <Pressable onPress={() => void choosePicture()} disabled={submitting} hitSlop={6}>
            <Text style={styles.link}>{picture ? "Change picture" : "Choose a picture"}</Text>
          </Pressable>
          {picture && (
            <Pressable onPress={() => setPicture(null)} disabled={submitting} hitSlop={6}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        autoFocus
        value={name}
        maxLength={64}
        placeholder="e.g. Weekend plans"
        onChangeText={setName}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />

      <Text style={styles.label}>Invite people</Text>
      {invitees.length > 0 && (
        <View style={styles.chips}>
          {invitees.map((u) => (
            <Pressable
              key={u.id}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              onPress={() => toggle(u)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${displayName(u)}`}
            >
              <Text style={styles.chipText}>{displayName(u)} ✕</Text>
            </Pressable>
          ))}
        </View>
      )}
      <TextInput
        style={styles.input}
        value={query}
        placeholder="Search people by name or username"
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.hint}>They'll join once they accept the invite.</Text>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.screen} behavior="padding">
        <View style={[styles.header, { paddingTop: styles.header.paddingVertical + topInset }]}>
          <Pressable onPress={close} disabled={submitting} hitSlop={8}>
            <Text style={[styles.headerButton, submitting && styles.disabled]}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>New room</Text>
          <Pressable onPress={() => void submit()} disabled={submitting} hitSlop={8}>
            <Text style={[styles.headerButton, styles.headerPrimary, submitting && styles.disabled]}>
              {submitting ? "Creating…" : "Create"}
            </Text>
          </Pressable>
        </View>

        <FlatList
          data={results}
          keyExtractor={(u) => String(u.id)}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={styles.empty}>{query ? "No one found" : "No one to add"}</Text>}
          contentContainerStyle={{ paddingBottom: 16 + insets.bottom }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => {
            const picked = selectedIds.has(item.id);
            return (
              <Pressable
                style={({ pressed }) => [styles.person, pressed && styles.pressed]}
                onPress={() => toggle(item)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: picked }}
              >
                <View style={[styles.check, picked && styles.checkOn]}>{picked && <Text style={styles.checkMark}>✓</Text>}</View>
                <Text style={styles.personName} numberOfLines={1}>
                  {displayName(item)} <Text style={styles.hint}>@{item.username}</Text>
                </Text>
              </Pressable>
            );
          }}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.card,
    },
    title: { fontSize: 17, fontWeight: "600", color: colors.text },
    headerButton: { fontSize: 16, color: colors.accent },
    headerPrimary: { fontWeight: "600" },
    disabled: { opacity: 0.4 },
    form: { padding: 16, gap: 8 },
    pictureRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 4 },
    picture: { width: PICTURE_SIZE, height: PICTURE_SIZE, borderRadius: PICTURE_SIZE * 0.28 },
    pictureActions: { gap: 8 },
    link: { fontSize: 16, color: colors.accent },
    remove: { fontSize: 16, color: colors.error },
    label: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: 8, textTransform: "uppercase" },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.card,
    },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.own },
    chipText: { color: colors.accent, fontSize: 14 },
    hint: { fontSize: 13, color: colors.muted },
    error: { color: colors.error, marginTop: 4 },
    empty: { color: colors.muted, padding: 16, textAlign: "center" },
    person: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.card },
    personName: { flex: 1, fontSize: 16, color: colors.text },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkMark: { color: colors.onAccent, fontSize: 13, fontWeight: "700" },
    pressed: { opacity: 0.7 },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  });
