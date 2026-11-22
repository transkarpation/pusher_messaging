import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { updateRoomSchema, type RoomUpdatedEvent, type UpdateRoomInput } from "@pm/shared";
import { api } from "../lib/api";
import { useStyles, type Colors } from "../lib/theme";
import { RoomPictureField, type PictureChoice } from "./RoomPictureField";

/**
 * The owner's form for renaming the room and changing or removing its picture, as on the web.
 * `onSaved` gets the room's new name and picture.
 */
export function EditRoomModal({
  room,
  visible,
  onClose,
  onSaved,
}: {
  room: { id: number; name: string; avatarUrl: string | null };
  visible: boolean;
  onClose: () => void;
  onSaved: (update: RoomUpdatedEvent) => void;
}) {
  const styles = useStyles(makeStyles);
  const [name, setName] = useState(room.name);
  const [picture, setPicture] = useState<PictureChoice>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // On Android the modal covers the whole screen, status bar included (on iOS it's a sheet below it).
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "android" ? insets.top : 0;

  // Start from the room as it is each time the form opens (it may have been renamed meanwhile).
  useEffect(() => {
    if (!visible) return;
    setName(room.name);
    setPicture(null);
    setError(null);
  }, [visible, room.name]);

  const close = () => {
    if (!saving) onClose();
  };

  const save = async () => {
    const input: UpdateRoomInput = {};
    if (name.trim() !== room.name) input.name = name;
    if (picture === "removed") input.avatar = null;
    else if (picture) input.avatar = picture.base64;
    if (input.name === undefined && input.avatar === undefined) {
      onClose();
      return;
    }
    const parsed = updateRoomSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      onSaved(await api.updateRoom(room.id, parsed.data));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.screen} behavior="padding">
        <View style={[styles.header, { paddingTop: styles.header.paddingVertical + topInset }]}>
          <Pressable onPress={close} disabled={saving} hitSlop={8}>
            <Text style={[styles.headerButton, saving && styles.disabled]}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Edit room</Text>
          <Pressable onPress={() => void save()} disabled={saving} hitSlop={8}>
            <Text style={[styles.headerButton, styles.headerPrimary, saving && styles.disabled]}>{saving ? "Saving…" : "Save"}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <RoomPictureField
            roomId={room.id}
            name={name}
            currentUrl={room.avatarUrl}
            value={picture}
            disabled={saving}
            onChange={(p) => {
              setPicture(p);
              setError(null);
            }}
            onError={setError}
          />
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            maxLength={64}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={() => void save()}
          />
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
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
    error: { color: colors.error, marginTop: 4 },
  });
