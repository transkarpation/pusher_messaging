import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { PushPayload } from "@pm/shared";
import { api } from "./api";

/** The Android channel the API's notifications go to (`channelId` in apps/server's ExpoPushSender). */
const CHANNEL_ID = "messages";

// The API sends a push only while the app has no open connection, so one that arrives while
// the app is in the foreground (it was just reopening) is shown as usual.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Asks for permission and sends this device's Expo push token to the API, for the signed-in
 * session (signing out removes it there). Needs the EAS project id (`extra.eas.projectId`
 * in app.json, set by `eas init`) and, on Android, FCM credentials uploaded to EAS.
 */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Messages",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let { granted, canAskAgain } = await Notifications.getPermissionsAsync();
  if (!granted && canAskAgain) ({ granted } = await Notifications.requestPermissionsAsync());
  if (!granted) return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn("Push notifications are off: app.json has no extra.eas.projectId (run `eas init`).");
    return;
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.registerPush({ kind: "expo", token });
}

/** The room a tapped notification is about, if it is one of the API's. */
export function roomOfNotification(response: Notifications.NotificationResponse): PushPayload | null {
  const data = response.notification.request.content.data as Partial<PushPayload> | undefined;
  return typeof data?.roomId === "number" ? (data as PushPayload) : null;
}
