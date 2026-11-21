import { useEffect } from "react";
import { useAuth } from "./store/auth";
import { AuthForm } from "./components/AuthForm";
import { ChatApp } from "./components/ChatApp";
import { NameModal } from "./components/NameModal";

export function App() {
  const { user, status, init } = useAuth();

  useEffect(() => {
    void init();
  }, [init]);

  if (status !== "ready") return <main className="center muted">Loading…</main>;

  if (!user) {
    return (
      <main className="center">
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
