import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { Message, Room, User } from "@pm/shared";
import { useTypingNotifier } from "../hooks/useTypingNotifier";
import { dayKey, dayLabel } from "../lib/dates";
import { deliveryOf } from "../lib/delivery";
import { deletedLabel, displayName, systemText } from "../lib/users";
import { EMPTY_ROOM, useMessages } from "../store/messages";
import { useRooms } from "../store/rooms";
import { DeleteMessageModal } from "./DeleteMessageModal";
import { MembersPanel } from "./MembersPanel";
import { MessageStatus } from "./MessageStatus";
import { TypingIndicator } from "./TypingIndicator";

const isTouch = () => window.matchMedia("(pointer: coarse)").matches;

/** Rendered with `key={room.id}`, so local state resets when switching rooms. */
export function RoomView({ room, me }: { room: Room; me: User }) {
  const { messages, pending, receipts, loaded, error } = useMessages((s) => s.byRoom[room.id] ?? EMPTY_ROOM);
  const fetch = useMessages((s) => s.fetch);
  const send = useMessages((s) => s.send);
  const retry = useMessages((s) => s.retry);
  const edit = useMessages((s) => s.edit);
  const setActive = useRooms((s) => s.setActive);

  const [text, setText] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  /** The message being edited in the composer, plus the unsent draft to restore afterwards. */
  const [editing, setEditing] = useState<{ message: Message; draft: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  /** On touch devices, tapping a message shows its actions (there's no hover). */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isOwner = room.members.some((m) => m.user.id === me.id && m.role === "owner");
  const canEdit = (m: Message) => m.kind === "text" && !m.deletedAt && m.author.id === me.id;
  const canDelete = (m: Message) => m.kind === "text" && !m.deletedAt && (m.author.id === me.id || isOwner);

  // Focus the composer when a room opens (the component remounts per room).
  // Skipped on touch devices, where it would pop up the on-screen keyboard.
  useEffect(() => {
    if (!isTouch()) inputRef.current?.focus();
  }, []);
  const typing = useTypingNotifier(room.id);

  useEffect(() => {
    void fetch(room.id);
  }, [fetch, room.id]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending.length, loaded]);

  // Grow the composer with its content; CSS max-height caps it at 5 lines, after which it scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [text]);

  // Someone (the room owner, or another tab) deleted the message being edited.
  useEffect(() => {
    if (editing && messages.find((m) => m.id === editing.message.id)?.deletedAt) stopEditing();
  }, [messages, editing]);

  const startEditing = (message: Message) => {
    typing.stop();
    setEditing({ message, draft: editing ? editing.draft : text });
    setText(message.text);
    setEditError(null);
    setSelectedId(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const stopEditing = () => {
    setText(editing?.draft ?? "");
    setEditing(null);
    setEditError(null);
  };

  const onTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (!editing) typing.onInput(e.target.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape" && editing) {
      e.preventDefault();
      stopEditing();
      return;
    }
    // Up arrow in an empty composer edits your last message.
    if (e.key === "ArrowUp" && !editing && text === "") {
      const last = [...messages].reverse().find(canEdit);
      if (last) {
        e.preventDefault();
        startEditing(last);
      }
      return;
    }
    // Enter sends, Shift+Enter inserts a newline. On touch devices Enter always inserts
    // a newline and the Send button submits.
    if (e.key !== "Enter" || e.shiftKey || isTouch()) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;

    if (editing) {
      if (value === editing.message.text) return stopEditing();
      setSaving(true);
      setEditError(null);
      try {
        await edit(room.id, editing.message.id, value);
        stopEditing();
      } catch (err) {
        setEditError((err as Error).message);
      } finally {
        setSaving(false);
      }
      return;
    }

    typing.stop();
    setText("");
    void send(room.id, value);
  };

  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  /** A "Today" / "Yesterday" / date line before the first message of each day. */
  const daySeparator = (iso: string, prevIso: string | undefined) =>
    prevIso && dayKey(prevIso) === dayKey(iso) ? null : (
      <li className="day-separator" role="separator">
        <span>{dayLabel(iso)}</span>
      </li>
    );

  const renderMessage = (m: Message) => {
    const own = m.author.id === me.id;
    const editable = canEdit(m);
    const deletable = canDelete(m);
    const system = systemText(m, me.id);
    if (system !== null) {
      return (
        <li className="system" title={dateTime(m.createdAt)}>
          {system}
          <span className="system-time">{time(m.createdAt)}</span>
        </li>
      );
    }
    if (m.deletedAt) {
      return (
        <li className={own ? "own deleted" : "deleted"}>
          {!own && <span className="message-author">{displayName(m.author)}</span>}
          <span className="deleted-text">{deletedLabel(own)}</span>
          <span className="message-meta">{time(m.createdAt)}</span>
        </li>
      );
    }
    const classes = [
      own && "own",
      m.id === selectedId && "selected",
      m.id === editing?.message.id && "editing",
    ].filter(Boolean);
    return (
      <li
        className={classes.join(" ") || undefined}
        onClick={() => {
          if ((editable || deletable) && isTouch()) setSelectedId((id) => (id === m.id ? null : m.id));
        }}
      >
        {!own && <span className="message-author">{displayName(m.author)}</span>}
        {m.text}
        <span className="message-meta">
          {m.editedAt && (
            <span className="edited" title={`Edited ${dateTime(m.editedAt)}`}>
              edited
            </span>
          )}
          {time(m.createdAt)}
          {own && <MessageStatus info={deliveryOf(m, receipts)} />}
        </span>
        {(editable || deletable) && (
          <span className="message-actions" onClick={(e) => e.stopPropagation()}>
            {editable && (
              <button type="button" className="ghost icon" title="Edit" aria-label="Edit message" onClick={() => startEditing(m)}>
                ✎
              </button>
            )}
            {deletable && (
              <button
                type="button"
                className="ghost icon danger"
                title="Delete"
                aria-label="Delete message"
                onClick={() => {
                  setSelectedId(null);
                  setDeleting(m);
                }}
              >
                🗑
              </button>
            )}
          </span>
        )}
      </li>
    );
  };

  return (
    <section className={`room ${showMembers ? "show-members" : ""}`}>
      <div className="room-main">
        <header className="room-header">
          <button type="button" className="ghost icon back-btn" aria-label="Back to rooms" onClick={() => setActive(null)}>
            ←
          </button>
          <h2>{room.name}</h2>
          <button type="button" className="secondary members-toggle" onClick={() => setShowMembers(true)}>
            Members · {room.members.length}
          </button>
        </header>

        {error && <p className="error">{error}</p>}
        {!loaded && messages.length === 0 ? (
          <p className="muted messages-placeholder">Loading…</p>
        ) : messages.length === 0 && pending.length === 0 ? (
          <p className="muted messages-placeholder">No messages yet. Say hi!</p>
        ) : (
          <ul className="messages" ref={listRef}>
            {messages.map((m, i) => (
              <Fragment key={m.id}>
                {daySeparator(m.createdAt, messages[i - 1]?.createdAt)}
                {renderMessage(m)}
              </Fragment>
            ))}
            {pending.map((p, i) => (
              <Fragment key={p.tempId}>
                {daySeparator(p.createdAt, (i === 0 ? messages.at(-1) : pending[i - 1])?.createdAt)}
                <li className="own pending">
                  {p.text}
                  <span className="message-meta">
                    {time(p.createdAt)}
                    <MessageStatus
                      info={{ status: p.status, deliveredCount: 0, readCount: 0 }}
                      onRetry={() => void retry(room.id, p.tempId)}
                    />
                  </span>
                </li>
              </Fragment>
            ))}
          </ul>
        )}

        <TypingIndicator roomId={room.id} members={room.members} />
        {editing && (
          <div className="editing-bar">
            <div className="editing-preview">
              <span className="editing-label">Editing message</span>
              <span className="muted small">{editing.message.text}</span>
            </div>
            <button type="button" className="ghost icon" aria-label="Cancel editing" title="Cancel (Esc)" onClick={stopEditing}>
              ✕
            </button>
          </div>
        )}
        {editError && <p className="error">{editError}</p>}
        <form onSubmit={(e) => void onSubmit(e)} className="composer">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder={`Message ${room.name}`}
            value={text}
            onChange={onTextChange}
            onKeyDown={onKeyDown}
            onBlur={editing ? undefined : typing.stop}
          />
          <button type="submit" disabled={saving}>
            {editing ? "Save" : "Send"}
          </button>
        </form>
      </div>

      <div className="members-pane">
        <button type="button" className="ghost members-close" onClick={() => setShowMembers(false)}>
          ← Back to chat
        </button>
        <MembersPanel room={room} me={me} />
      </div>

      {deleting && <DeleteMessageModal message={deleting} me={me} onClose={() => setDeleting(null)} />}
    </section>
  );
}
