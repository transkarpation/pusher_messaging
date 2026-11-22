import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { SeedAccount } from "@pm/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useStyles, type Colors } from "../lib/theme";

/**
 * The demo accounts from `pnpm db:seed`, each signed in with one tap (like /seeds on the web).
 * Shown only when the server hands them out: a production server answers 404 and this renders nothing,
 * in dev and release builds alike.
 */
export function DemoAccounts() {
  const styles = useStyles(makeStyles);
  const signIn = useSession((s) => s.signIn);
  /** Null until loaded, and for good if the server doesn't list them (or can't be reached). */
  const [accounts, setAccounts] = useState<SeedAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSeeds()
      .then((res) => setAccounts(res.accounts))
      .catch(() => {}); // 404 on a production server; an unreachable server shows up in the sign-in form instead
  }, []);

  const logInAs = async (a: SeedAccount) => {
    setBusy(a.username);
    setError(null);
    try {
      await signIn(a.username, a.password, "login");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  if (!accounts) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Demo accounts</Text>
      {accounts.length === 0 ? (
        <Text style={styles.muted}>None yet. Create them with `pnpm db:seed`.</Text>
      ) : (
        accounts.map((a) => (
          <Pressable
            key={a.username}
            style={({ pressed }) => [styles.row, pressed && styles.pressed, busy !== null && busy !== a.username && styles.disabled]}
            disabled={busy !== null}
            onPress={() => void logInAs(a)}
            accessibilityRole="button"
            accessibilityLabel={`Log in as ${a.username}`}
          >
            <View style={styles.who}>
              <Text style={styles.name}>
                {a.name ?? `@${a.username}`}
                {a.name && <Text style={styles.muted}> @{a.username}</Text>}
              </Text>
              <Text style={styles.note} numberOfLines={2}>
                {a.note}
              </Text>
            </View>
            {busy === a.username ? <ActivityIndicator /> : <Text style={styles.go}>Log in</Text>}
          </Pressable>
        ))
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  card: { gap: 4, padding: 20, borderRadius: 12, backgroundColor: colors.card },
  title: { fontSize: 17, fontWeight: "600", color: colors.text, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  who: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: "500", color: colors.text },
  note: { fontSize: 12, color: colors.muted },
  muted: { color: colors.muted, fontWeight: "400" },
  go: { color: colors.accent, fontWeight: "600" },
  error: { color: colors.error },
});
