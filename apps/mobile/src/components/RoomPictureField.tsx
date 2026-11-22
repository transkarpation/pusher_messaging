import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { pickRoomPicture, type PickedPicture } from "../lib/roomPicture";
import { useStyles, type Colors } from "../lib/theme";
import { RoomAvatar } from "./RoomAvatar";

/** A newly picked picture, "removed", or null to keep the current one. */
export type PictureChoice = PickedPicture | "removed" | null;

const SIZE = 72;

/** Preview of a room's picture with buttons to pick a new one from the photo library or remove it. */
export function RoomPictureField({
  roomId,
  name,
  currentUrl,
  value,
  disabled,
  onChange,
  onError,
}: {
  /** For the default avatar: the room's id (its color) and name (its letter). */
  roomId: number;
  name: string;
  /** The room's current picture (a path from the API), if it has one. */
  currentUrl: string | null;
  value: PictureChoice;
  disabled?: boolean;
  onChange: (value: PictureChoice) => void;
  onError: (message: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const picked = value && value !== "removed" ? value : null;
  const hasPicture = picked !== null || (value !== "removed" && currentUrl !== null);

  const choose = async () => {
    try {
      const next = await pickRoomPicture();
      if (next) onChange(next);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <View style={styles.row}>
      <Pressable onPress={() => void choose()} disabled={disabled} accessibilityRole="button" accessibilityLabel="Choose a picture">
        {picked ? (
          <Image source={{ uri: picked.uri }} style={styles.picture} />
        ) : (
          <RoomAvatar room={{ id: roomId, name: name.trim() || "?", avatarUrl: value === "removed" ? null : currentUrl }} size={SIZE} />
        )}
      </Pressable>
      <View style={styles.actions}>
        <Pressable onPress={() => void choose()} disabled={disabled} hitSlop={6}>
          <Text style={[styles.link, disabled && styles.disabled]}>{hasPicture ? "Change picture" : "Choose a picture"}</Text>
        </Pressable>
        {hasPicture && (
          <Pressable onPress={() => onChange(currentUrl ? "removed" : null)} disabled={disabled} hitSlop={6}>
            <Text style={[styles.remove, disabled && styles.disabled]}>Remove</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 4 },
    picture: { width: SIZE, height: SIZE, borderRadius: SIZE * 0.28 },
    actions: { gap: 8 },
    link: { fontSize: 16, color: colors.accent },
    remove: { fontSize: 16, color: colors.error },
    disabled: { opacity: 0.4 },
  });
