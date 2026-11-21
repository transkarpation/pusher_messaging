import { useState, type FormEvent } from "react";
import { updateProfileSchema } from "@pm/shared";
import { useAuth } from "../store/auth";
import { Modal } from "./Modal";

/** Blocking modal shown while the signed-in user has no name set. */
export function NameModal() {
  const setName = useAuth((s) => s.setName);
  const [name, setNameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = updateProfileSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await setName(parsed.data.name);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title="What's your name?">
      <form onSubmit={onSubmit} className="stack">
        <p className="muted">Other people in the chat will see it.</p>
        <input
          autoFocus
          placeholder="Your name"
          value={name}
          onChange={(e) => setNameValue(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "…" : "Continue"}
        </button>
      </form>
    </Modal>
  );
}
