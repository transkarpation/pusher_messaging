import { useEffect } from "react";
import { useAuth } from "./store/auth";
import { AuthForm } from "./components/AuthForm";
import { ChatApp } from "./components/ChatApp";
import { NameModal } from "./components/NameModal";
import { SeedsPage } from "./components/SeedsPage";
import { ThemeToggle } from "./components/ThemeToggle";
import { SEEDS_PATH, usePath } from "./lib/router";

export function App() {
  const { user, status, init } = useAuth();
  const path = usePath();

  useEffect(() => {
    void init();
  }, [init]);

  // Open to everyone, signed in or not.
  if (path === SEEDS_PATH) return <SeedsPage />;

  if (status !== "ready") return <main className="center muted">Loading…</main>;

  if (!user) {
    return (
      <main className="center">
        <ThemeToggle className="theme-corner" />
        <AuthForm />
      </main>
    );
  }

  return (
    <>
      <ChatApp user={user} />
      {!user.name && <NameModal />}
    </>
  );
}
