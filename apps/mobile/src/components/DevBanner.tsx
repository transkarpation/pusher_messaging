import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_URL } from "../lib/config";

/** A strip along the bottom of every screen in dev builds (`__DEV__`), so they aren't mistaken for a release. */
export function DevBanner() {
  const insets = useSafeAreaInsets();
  if (!__DEV__) return null;
  return (
    <View style={[styles.banner, { paddingBottom: insets.bottom + 3 }]} accessibilityRole="text">
      <Text style={styles.text} numberOfLines={1}>
        DEV BUILD · {API_URL.replace(/^https?:\/\//, "")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: "center", paddingTop: 3, backgroundColor: "#ffcc00" },
  text: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, color: "#3d3000" },
});
