import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DevBanner } from "../components/DevBanner";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const restore = useSession((s) => s.restore);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void restore();
  }, [restore]);

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator />
      </View>
    );
  }

  const signedIn = status === "signedIn";
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
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
  );
}
