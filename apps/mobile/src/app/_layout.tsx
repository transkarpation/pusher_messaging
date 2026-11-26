import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import * as Notifications from "expo-notifications";
import { Stack, router } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DevBanner } from "../components/DevBanner";
import { registerForPush, roomOfNotification } from "../lib/push";
import { useSession } from "../lib/session";
import { useColors, useIsDark } from "../lib/theme";

export default function RootLayout() {
  const colors = useColors();
  const dark = useIsDark();
  /** Headers and screen backgrounds in the app's palette, light or dark like the phone. */
  const navigationTheme = useMemo<Theme>(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, primary: colors.accent, background: colors.bg, card: colors.card, text: colors.text, border: colors.border },
    };
  }, [dark, colors]);
  const status = useSession((s) => s.status);
  const restore = useSession((s) => s.restore);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void restore();
  }, [restore]);

  // Push notifications for this session, once signed in.
  useEffect(() => {
    if (status === "signedIn") registerForPush().catch((err) => console.warn("Push registration failed:", err));
  }, [status]);

  // A tapped notification opens its room (also one that launched the app), each tap once.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const payload = lastResponse && roomOfNotification(lastResponse);
    const key = lastResponse?.notification.request.identifier ?? null;
    if (!payload || status !== "signedIn" || handled.current === key) return;
    handled.current = key;
    router.push({ pathname: "/rooms/[id]", params: { id: String(payload.roomId), name: payload.title } });
  }, [lastResponse, status]);

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator />
      </View>
    );
  }

  const signedIn = status === "signedIn";
  return (
    <ThemeProvider value={navigationTheme}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="index" options={{ title: "Rooms" }} />
            <Stack.Screen name="rooms/[id]" options={{ title: "" }} />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="login" options={{ headerShown: false }} />
          </Stack.Protected>
        </Stack>
        {/* Keeps the screens clear of the system navigation bar; in dev builds the banner takes that space. */}
        {__DEV__ ? <DevBanner /> : <View style={{ height: insets.bottom, backgroundColor: colors.card }} />}
      </View>
    </ThemeProvider>
  );
}
