import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { AVATAR_SIZE } from "@pm/shared";

/** A picked room picture: a local file to preview and the same image base64-encoded for the API. */
export interface PickedPicture {
  uri: string;
  base64: string;
}

/** Big photos are decoded at most this size (px), so a camera photo doesn't load in full. */
const DECODE_MAX = 1024;

/**
 * Lets the user pick a photo from the library (cropped to a square), then scales it down to
 * `AVATAR_SIZE` px as a JPEG, as the web client does. Resolves to null when they cancel.
 */
export async function pickRoomPicture(): Promise<PickedPicture | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;

  // The crop screen should already give a square, but center-crop in case it didn't.
  const loaded = await ImageManipulator.manipulate(result.assets[0].uri, { maxWidth: DECODE_MAX, maxHeight: DECODE_MAX }).renderAsync();
  const side = Math.min(loaded.width, loaded.height);
  const image = await ImageManipulator.manipulate(loaded)
    .crop({ originX: (loaded.width - side) / 2, originY: (loaded.height - side) / 2, width: side, height: side })
    .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE })
    .renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  if (!saved.base64) throw new Error("Couldn't read the picture");
  return { uri: saved.uri, base64: saved.base64 };
}
