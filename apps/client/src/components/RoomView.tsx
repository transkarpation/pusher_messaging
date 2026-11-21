import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { Room, User } from "@pm/shared";
import { useTypingNotifier } from "../hooks/useTypingNotifier";
import { deliveryOf } from "../lib/delivery";
import { displayName } from "../lib/users";
import { EMPTY_ROOM, useMessages } from "../store/messages";
import { useRooms } from "../store/rooms";
import { MembersPanel } from "./MembersPanel";
import { MessageStatus } from "./MessageStatus";
import { TypingIndicator } from "./TypingIndicator";

/** Rendered with `key={room.id}`, so local state resets when switching rooms. */
export function RoomView({ room, me }: { room: Room; me: User }) {
  const { messages, pending, receipts, loaded, error } = useMessages((s) => s.byRoom[room.id] ?? EMPTY_ROOM);
  const fetch = useMessages((s) => s.fetch);
  const send = useMessages((s) => s.send);
  const retry = useMessages((s) => s.retry);
  const setActive = useRooms((s) => s.setActive);

  const [text, setText] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the composer when a room opens (the component remounts per room).
  // Skipped on touch devices, where it would pop up the on-screen keyboard.
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) inputRef.current?.focus();
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

  const onTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    typing.onInput(e.target.value);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    typing.stop();
    setText("");
    void send(room.id, value);
  };

  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
            {messages.map((m) => {
              const own = m.author.id === me.id;
              return (
                <li key={m.id} className={own ? "own" : undefined}>
                  {!own && <span className="message-author">{displayName(m.author)}</span>}
                  {m.text}
                  <span className="message-meta">
                    {time(m.createdAt)}
                    {own && <MessageStatus info={deliveryOf(m, receipts)} />}
                  </span>
                </li>
              );
            })}
            {pending.map((p) => (
              <li key={p.tempId} className="own pending">
                {p.text}
                <span className="message-meta">
                  {time(p.createdAt)}
                  <MessageStatus
                    info={{ status: p.status, deliveredCount: 0, readCount: 0 }}
                    onRetry={() => void retry(room.id, p.tempId)}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}

        <TypingIndicator roomId={room.id} members={room.members} />
        <form onSubmit={onSubmit} className="composer">
          <input
            ref={inputRef}
            placeholder={`Message ${room.name}`}
            value={text}
            onChange={onTextChange}
            onBlur={typing.stop}
          />
          <button type="submit">Send</button>
        </form>
      </div>

      <div className="members-pane">
        <button type="button" className="ghost members-close" onClick={() => setShowMembers(false)}>
          ← Back to chat
        </button>
        <MembersPanel room={room} me={me} />
      </div>
    </section>
  );
}
