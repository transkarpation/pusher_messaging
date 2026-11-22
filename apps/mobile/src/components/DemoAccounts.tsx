import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { SeedAccount } from "@pm/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useStyles, type Colors } from "../lib/theme";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; accounts: SeedAccount[] };

/** Dev builds only: the demo accounts from `pnpm db:seed`, each signed in with one tap (like /seeds on the web). */
export function DemoAccounts() {
  const styles = useStyles(makeStyles);
  const signIn = useSession((s) => s.signIn);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSeeds()
      .then(({ accounts }) => setLoad({ status: "ready", accounts }))
      .catch((e) => setLoad({ status: "error", message: (e as Error).message }));
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

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Demo accounts</Text>
      {load.status === "loading" ? (
        <ActivityIndicator />
      ) : load.status === "error" ? (
        <Text style={styles.error}>Couldn't load the demo accounts: {load.message}</Text>
      ) : load.accounts.length === 0 ? (
        <Text style={styles.muted}>None yet. Create them with `pnpm db:seed`.</Text>
      ) : (
        load.accounts.map((a) => (
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
