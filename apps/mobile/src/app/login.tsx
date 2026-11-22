import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { credentialsSchema } from "@pm/shared";
import { API_URL } from "../lib/config";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

export default function LoginScreen() {
  const signIn = useSession((s) => s.signIn);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const parsed = credentialsSchema.safeParse({ username, password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid input");
    setBusy(true);
    setError(null);
    try {
      await signIn(parsed.data.username, parsed.data.password, mode);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.card}>
        <Text style={styles.title}>{mode === "login" ? "Sign in" : "Create account"}</Text>
        <TextInput
          style={styles.input}
          placeholder="Username"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={() => void submit()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === "login" ? "Sign in" : "Sign up"}</Text>}
        </Pressable>
        <Pressable onPress={() => setMode(mode === "login" ? "register" : "login")}>
          <Text style={styles.link}>{mode === "login" ? "No account? Sign up" : "Have an account? Sign in"}</Text>
        </Pressable>
        <Text style={styles.server}>Server: {API_URL}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: colors.bg },
  card: { gap: 12, padding: 20, borderRadius: 12, backgroundColor: colors.card },
  title: { fontSize: 22, fontWeight: "600", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  error: { color: colors.error },
  button: { alignItems: "center", paddingVertical: 12, borderRadius: 8, backgroundColor: colors.accent },
  disabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { color: colors.accent, textAlign: "center" },
  server: { color: colors.muted, fontSize: 12, textAlign: "center" },
});
