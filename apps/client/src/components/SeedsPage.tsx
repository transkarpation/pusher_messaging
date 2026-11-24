import { useEffect, useState } from "react";
import type { SeedAccount } from "@pm/shared";
import { api } from "../api";
import { navigate } from "../lib/router";
import { displayName } from "../lib/users";
import { useAuth } from "../store/auth";
import { Avatar } from "./Avatar";
import { ThemeToggle } from "./ThemeToggle";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; accounts: SeedAccount[] };

/** Public page (/seeds, no login) with the demo accounts from `pnpm db:seed` and their passwords. */
export function SeedsPage() {
  const user = useAuth((s) => s.user);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSeeds()
      .then(({ accounts }) => setLoad({ status: "ready", accounts }))
      .catch((err) => setLoad({ status: "error", message: (err as Error).message }));
  }, []);

  /** Signs in as the account (signing out of the current one first) and opens the chat. */
  const logInAs = async (account: SeedAccount) => {
    setBusy(account.username);
    setError(null);
    try {
      const { logout, login } = useAuth.getState();
      if (useAuth.getState().user) await logout();
      await login({ username: account.username, password: account.password });
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    } catch {
      // clipboard unavailable (e.g. not a secure context): the text is still there to select
    }
  };

  const CopyButton = ({ id, text }: { id: string; text: string }) => (
    <button type="button" className="ghost copy-btn" title="Copy" onClick={() => void copy(id, text)}>
      {copied === id ? "✓" : "⧉"}
    </button>
  );

  return (
    <main className="seeds-page">
      <header className="seeds-header">
        <div>
          <h1>Demo accounts</h1>
          <p className="muted">
            Created by <code>pnpm db:seed</code>. Log in as any of them to look around.
          </p>
        </div>
        <div className="sidebar-header-actions">
          <ThemeToggle />
          <button type="button" className="secondary" onClick={() => navigate("/")}>
            {user ? "Back to chat" : "Sign in"}
          </button>
        </div>
      </header>

      {user && (
        <p className="muted small">
          You're signed in as <strong>@{user.username}</strong>. Logging in as a demo account signs you out first.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {load.status === "loading" ? (
        <p className="muted">Loading…</p>
      ) : load.status === "error" ? (
        <p className="error">Couldn't load the demo accounts: {load.message}</p>
      ) : load.accounts.length === 0 ? (
        <div className="card seeds-empty">
          <p>There are no demo accounts yet. Create them with:</p>
          <pre>pnpm db:seed</pre>
        </div>
      ) : (
        <ul className="seeds-list">
          {load.accounts.map((a) => (
            <li key={a.username} className="card seed-card">
              <div className="seed-who">
                {/* Photos need a login to load, so everyone gets the default avatar here. */}
                <Avatar user={{ ...a, avatarUrl: null }} size={40} />
                <div className="seed-names">
                  <strong>{displayName(a)}</strong>
                  {a.role !== "user" && <span className={`role-badge role-${a.role}`}>{a.role}</span>}
                  <span className="muted small">{a.note}</span>
                </div>
              </div>
              <dl className="seed-creds">
                <dt>Username</dt>
                <dd>
                  <code>{a.username}</code>
                  <CopyButton id={`${a.username}:u`} text={a.username} />
                </dd>
                <dt>Password</dt>
                <dd>
                  <code>{a.password}</code>
                  <CopyButton id={`${a.username}:p`} text={a.password} />
                </dd>
                <dt>Rooms</dt>
                <dd className="seed-rooms">{a.rooms.length ? a.rooms.join(", ") : <span className="muted">none</span>}</dd>
              </dl>
              <button
                type="button"
                disabled={busy !== null || user?.username === a.username}
                onClick={() => void logInAs(a)}
              >
                {user?.username === a.username ? "Signed in" : busy === a.username ? "…" : `Log in as ${a.username}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
