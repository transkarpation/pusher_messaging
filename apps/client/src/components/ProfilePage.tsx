import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { updateProfileSchema, type LastSeenVisibility, type User } from "@pm/shared";
import { prepareAvatar } from "../lib/image";
import { disablePush, enablePush, pushState, type PushState } from "../lib/push";
import { navigate } from "../lib/router";
import { displayName } from "../lib/users";
import { useAuth } from "../store/auth";
import { useBlocks } from "../store/blocks";
import { usePrivacy } from "../store/privacy";
import { Avatar } from "./Avatar";

/** The signed-in user's profile page (/profile): avatar, display name, notifications, privacy and blocked people. */
export function ProfilePage({ me }: { me: User }) {
  return (
    <section className="profile-page">
      <header className="room-header">
        <button type="button" className="ghost icon back-btn" aria-label="Back to rooms" onClick={() => navigate("/")}>
          ←
        </button>
        <h2>Profile</h2>
      </header>
      <div className="profile-content">
        <AvatarSection me={me} />
        <NameSection me={me} />
        <NotificationsSection />
        <PrivacySection />
        <BlockedSection />
      </div>
    </section>
  );
}

function AvatarSection({ me }: { me: User }) {
  const { uploadAvatar, removeAvatar } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires change
    if (file) void run(async () => uploadAvatar(await prepareAvatar(file)));
  };

  return (
    <div className="profile-section stack">
      <div className="profile-avatar">
        <Avatar user={me} size={96} />
        <div className="stack profile-avatar-actions">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "…" : me.avatarUrl ? "Change photo" : "Upload photo"}
          </button>
          {me.avatarUrl && (
            <button type="button" className="secondary" disabled={busy} onClick={() => void run(removeAvatar)}>
              Remove photo
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function NameSection({ me }: { me: User }) {
  const setName = useAuth((s) => s.setName);
  const [name, setNameValue] = useState(me.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = updateProfileSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setName(parsed.data.name);
      setNameValue(parsed.data.name);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="profile-section stack">
      <label>
        Name
        <input
          value={name}
          onChange={(e) => {
            setNameValue(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <p className="muted small">Username: @{me.username}</p>
      {error && <p className="error">{error}</p>}
      <div className="row modal-actions">
        {saved && <span className="muted small">Saved</span>}
        <button type="submit" disabled={busy || name.trim() === (me.name ?? "")}>
          {busy ? "…" : "Save"}
        </button>
      </div>
    </form>
  );
}

const PUSH_NOTES: Record<PushState, string> = {
  on: "You get a notification of new messages while the chat isn't open anywhere.",
  off: "Get a notification of new messages while the chat isn't open anywhere.",
  denied: "Notifications are blocked for this site. Allow them in the browser's site settings.",
  unsupported: "This browser can't show push notifications.",
  unavailable: "Push notifications aren't set up on this server.",
};

function NotificationsSection() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pushState().then(setState, (err: Error) => setError(err.message));
  }, []);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await (state === "on" ? disablePush() : enablePush()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-section stack">
      <div>
        <h3>Notifications</h3>
        <p className="muted small">{state ? PUSH_NOTES[state] : "…"}</p>
      </div>
      {error && <p className="error">{error}</p>}
      {(state === "on" || state === "off") && (
        <div className="row modal-actions">
          <button type="button" className={state === "on" ? "secondary" : undefined} disabled={busy} onClick={() => void toggle()}>
            {busy ? "…" : state === "on" ? "Turn off" : "Turn on"}
          </button>
        </div>
      )}
    </div>
  );
}

function PrivacySection() {
  const lastSeen = usePrivacy((s) => s.lastSeen);
  const setLastSeen = usePrivacy((s) => s.setLastSeen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (value: LastSeenVisibility) => {
    setBusy(true);
    setError(null);
    try {
      await setLastSeen(value);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-section stack">
      <div>
        <h3>Who can see my last seen time</h3>
        <p className="muted small">
          Others see "last seen recently", "within a week" or "within a month" instead of the time. If you don't share
          yours, you won't see other people's either. Whether you're online is always visible.
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      {lastSeen === null ? (
        <p className="muted small">Loading…</p>
      ) : (
        <div className="stack privacy-options" role="radiogroup" aria-label="Who can see my last seen time">
          {LAST_SEEN_OPTIONS.map(({ value, label }) => (
            <label key={value} className="row privacy-option">
              <input
                type="radio"
                name="last-seen"
                value={value}
                checked={lastSeen === value}
                disabled={busy}
                onChange={() => void change(value)}
              />
              {label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const LAST_SEEN_OPTIONS: { value: LastSeenVisibility; label: string }[] = [
  { value: "everybody", label: "Everybody" },
  { value: "nobody", label: "Nobody" },
];

function BlockedSection() {
  const blocked = useBlocks((s) => s.blocked);
  const loaded = useBlocks((s) => s.loaded);
  const unblock = useBlocks((s) => s.unblock);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onUnblock = async (user: User) => {
    setPendingId(user.id);
    setError(null);
    try {
      await unblock(user.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="profile-section stack">
      <div>
        <h3>Blocked people</h3>
        <p className="muted small">You don't see their messages in any room. They aren't told they're blocked.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {!loaded ? (
        <p className="muted small">Loading…</p>
      ) : blocked.length === 0 ? (
        <p className="muted small">You haven't blocked anyone. To block someone, open a room's member list.</p>
      ) : (
        <ul className="blocked-list">
          {blocked.map((user) => (
            <li key={user.id}>
              <Avatar user={user} size={32} />
              <span className="blocked-name">
                {displayName(user)} <span className="muted small">@{user.username}</span>
              </span>
              <button
                type="button"
                className="secondary"
                disabled={pendingId === user.id}
                onClick={() => void onUnblock(user)}
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
