import { useState, type FormEvent } from "react";
import { credentialsSchema } from "@pm/shared";
import { SEEDS_PATH, navigate } from "../lib/router";
import { useAuth } from "../store/auth";

type Mode = "login" | "register";

export function AuthForm() {
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);

  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = credentialsSchema.safeParse({ username, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await (mode === "login" ? login : register)(parsed.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((m) => (m === "login" ? "register" : "login"));
    setError(null);
  };

  return (
    <div className="card auth">
      <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
      <form onSubmit={onSubmit} className="stack">
        <label>
          Username
          <input
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Password
          <span className="password-field">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="ghost password-toggle"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              title={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "…" : mode === "login" ? "Sign in" : "Sign up"}
        </button>
      </form>
      <p className="muted">
        {mode === "login" ? "No account yet?" : "Already have an account?"}{" "}
        <button type="button" className="link" onClick={switchMode}>
          {mode === "login" ? "Sign up" : "Sign in"}
        </button>
      </p>
      <p className="muted small">
        <button type="button" className="link" onClick={() => navigate(SEEDS_PATH)}>
          Demo accounts
        </button>{" "}
        — log in as a seeded user
      </p>
    </div>
  );
}
