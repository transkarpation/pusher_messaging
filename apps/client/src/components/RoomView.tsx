import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { isVoiceMessage, type Message, type Room, type User } from "@pm/shared";
import { useTypingNotifier } from "../hooks/useTypingNotifier";
import { useVoiceRecorder, voiceSupported } from "../hooks/useVoiceRecorder";
import { dayKey, dayLabel } from "../lib/dates";
import { deliveryOf } from "../lib/delivery";
import { addFiles } from "../lib/files";
import { deletedLabel, displayName, messagePreview, systemText } from "../lib/users";
import { EMPTY_ROOM, useMessages } from "../store/messages";
import { useBlocks } from "../store/blocks";
import { useRooms } from "../store/rooms";
import { DraftAttachments, MessageAttachments, PendingAttachments } from "./Attachments";
import { Avatar } from "./Avatar";
import { DeleteMessageModal } from "./DeleteMessageModal";
import { EmojiPicker } from "./EmojiPicker";
import { MembersPanel } from "./MembersPanel";
import { MessageStatus } from "./MessageStatus";
import { RecordingBar } from "./RecordingBar";
import { VoiceDraft } from "./VoiceDraft";
import { Spinner } from "./Spinner";
import { TypingIndicator } from "./TypingIndicator";

const isTouch = () => window.matchMedia("(pointer: coarse)").matches;

/** Recording stops at this length; the voice message then waits to be sent like any other. */
const VOICE_MAX_MS = 5 * 60 * 1000;

/** Dragging the pointer this far left of where the microphone was pressed cancels the recording. */
const CANCEL_DRAG_PX = 80;

/** How close to the top of the list (px) scrolling has to get to load older messages. */
const LOAD_OLDER_THRESHOLD = 120;

/** Rendered with `key={room.id}`, so local state resets when switching rooms. */
export function RoomView({ room, me }: { room: Room; me: User }) {
  const { messages: allMessages, pending, receipts, loaded, error, reachedStart, loadingOlder, olderError } =
    useMessages((s) => s.byRoom[room.id] ?? EMPTY_ROOM);
  const blocked = useBlocks((s) => s.ids);
  // Regular messages of blocked people are hidden (system lines about them stay). They are
  // still kept in the store, so unblocking shows them again without a refetch.
  const messages = useMemo(
    () => (blocked.size === 0 ? allMessages : allMessages.filter((m) => m.kind !== "text" || !blocked.has(m.author.id))),
    [allMessages, blocked],
  );
  const fetch = useMessages((s) => s.fetch);
  const loadOlder = useMessages((s) => s.loadOlder);
  const send = useMessages((s) => s.send);
  const retry = useMessages((s) => s.retry);
  const edit = useMessages((s) => s.edit);
  const setActive = useRooms((s) => s.setActive);

  const [text, setText] = useState("");
  /** Files picked for the next message. */
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canRecord = useMemo(voiceSupported, []);
  const voice = useVoiceRecorder({ maxMs: VOICE_MAX_MS, onLimit: () => void finishVoice(true) });
  const [showMembers, setShowMembers] = useState(false);
  /** The message being edited in the composer, plus the unsent draft to restore afterwards. */
  const [editing, setEditing] = useState<{ message: Message; draft: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  /** On touch devices, tapping a message shows its actions (there's no hover). */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Distance from the list's bottom edge to the viewport's, to keep the view still when older messages are added. */
  const fromBottom = useRef(0);
  /** First/last rendered message and pending count at the previous render, to tell prepends from appends. */
  const edges = useRef<{ first?: number; last?: number; pending: number }>({ pending: 0 });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isOwner = room.members.some((m) => m.user.id === me.id && m.role === "owner");
  /** Voice messages can only be deleted. */
  const canEdit = (m: Message) => m.kind === "text" && !m.deletedAt && m.author.id === me.id && !isVoiceMessage(m);
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

  /** Near the top (or the list doesn't fill the screen yet): fetch the previous page. The store dedupes calls. */
  const loadOlderIfAtTop = () => {
    const el = listRef.current;
    // After a failure, only the Retry button tries again (no request per scroll event).
    if (el && !olderError && el.scrollTop < LOAD_OLDER_THRESHOLD) void loadOlder(room.id);
  };

  // Older messages were added at the top: keep the same messages on screen.
  // Anything else that changes the ends (new message, sent message, first load): show the newest.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const first = messages[0]?.id;
    const last = messages.at(-1)?.id;
    const prev = edges.current;
    const prepended =
      prev.first !== undefined && first !== undefined && first < prev.first && last === prev.last && pending.length === prev.pending;
    if (prepended) el.scrollTop = el.scrollHeight - fromBottom.current;
    else if (first !== prev.first || last !== prev.last || pending.length !== prev.pending) el.scrollTop = el.scrollHeight;
    edges.current = { first, last, pending: pending.length };
    fromBottom.current = el.scrollHeight - el.scrollTop;
    // Keeps loading while the list is too short to scroll (or all of a page was hidden as blocked).
    loadOlderIfAtTop();
  }, [messages, pending.length, loaded, reachedStart]);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    fromBottom.current = el.scrollHeight - el.scrollTop;
    loadOlderIfAtTop();
  };

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

  const pickFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    if (editing) {
      setFileError("Files can't be added while editing a message");
      return;
    }
    const result = addFiles(files, picked);
    setFiles(result.files);
    setFileError(result.error);
    if (!isTouch()) inputRef.current?.focus();
  };

  const removeFile = (index: number) => {
    setFiles((list) => list.filter((_, i) => i !== index));
    setFileError(null);
  };

  /** Pasted files (e.g. a screenshot) are attached; pasted text goes in as usual. */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...e.clipboardData.files];
    if (pasted.length === 0) return;
    e.preventDefault();
    pickFiles(pasted);
  };

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (hasFiles(e)) setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent) => {
      // Only when leaving the room view itself, not when moving between its children.
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      pickFiles([...e.dataTransfer.files]);
    },
  };

  /** The microphone is pressed (pointer or keyboard); recording lasts as long as it is. */
  const holding = useRef<{ x: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** A finished recording the user hasn't sent or deleted yet. */
  const [voiceDraft, setVoiceDraft] = useState<File | null>(null);
  const sendVoiceRef = useRef<HTMLButtonElement>(null);

  /** Stops recording; `keep` keeps it as a draft to listen to and send, otherwise it's discarded. */
  async function finishVoice(keep: boolean) {
    holding.current = null;
    setCancelling(false);
    const file = await voice.stop(keep);
    if (file) {
      setVoiceDraft(file);
      // So Enter sends it right away.
      requestAnimationFrame(() => sendVoiceRef.current?.focus());
    }
  }

  const sendVoiceDraft = () => {
    if (!voiceDraft) return;
    void send(room.id, "", [voiceDraft]);
    setVoiceDraft(null);
    if (!isTouch()) requestAnimationFrame(() => inputRef.current?.focus());
  };

  const deleteVoiceDraft = () => {
    setVoiceDraft(null);
    if (!isTouch()) requestAnimationFrame(() => inputRef.current?.focus());
  };

  const beginHold = async (x: number) => {
    if (holding.current) return;
    holding.current = { x };
    setCancelling(false);
    voice.clearError();
    const started = await voice.start();
    // Released while the browser was still asking for the microphone (e.g. the first time).
    if (started && !holding.current) await voice.stop(false);
  };

  const endHold = () => {
    if (!holding.current) return;
    void finishVoice(!cancelling);
  };

  // Esc cancels a recording, or deletes a finished one.
  useEffect(() => {
    if (voice.state === "idle" && !voiceDraft) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (voice.state !== "idle") void finishVoice(false);
      else deleteVoiceDraft();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [voice.state, voiceDraft]);

  /** Nothing typed or attached: the Send button turns into the microphone. */
  const showMic = canRecord && !editing && !voiceDraft && text.trim() === "" && files.length === 0;

  /** Puts the emoji at the caret (replacing any selection) and moves the caret after it. */
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const value = text.slice(0, start) + emoji + text.slice(end);
    setText(value);
    if (!editing) typing.onInput(value);
    requestAnimationFrame(() => {
      if (!el) return;
      const caret = start + emoji.length;
      if (!isTouch()) el.focus();
      el.setSelectionRange(caret, caret);
    });
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

    if (editing) {
      // The text may be emptied only when the message still has its files.
      if (!value && editing.message.attachments.length === 0) return;
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

    if (!value && files.length === 0) return;
    typing.stop();
    setText("");
    setFiles([]);
    setFileError(null);
    void send(room.id, value, files);
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

  /**
   * Others' messages are indented to leave room for the author's avatar, which is drawn
   * only on the last message of a run by the same author (like most messengers do).
   */
  const avatarSlot = (m: Message, next: Message | undefined) => {
    const endsRun =
      !next || next.kind !== "text" || next.author.id !== m.author.id || dayKey(next.createdAt) !== dayKey(m.createdAt);
    return endsRun ? <Avatar user={m.author} size={28} className="message-avatar" /> : null;
  };

  const renderMessage = (m: Message, next: Message | undefined) => {
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
        <li className={own ? "own deleted" : "deleted with-avatar"}>
          {!own && avatarSlot(m, next)}
          {!own && <span className="message-author">{displayName(m.author)}</span>}
          <span className="deleted-text">{deletedLabel(own)}</span>
          <span className="message-meta">{time(m.createdAt)}</span>
        </li>
      );
    }
    const classes = [
      own ? "own" : "with-avatar",
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
        {!own && avatarSlot(m, next)}
        {!own && <span className="message-author">{displayName(m.author)}</span>}
        <MessageAttachments attachments={m.attachments} />
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
      <div className={`room-main ${dragging ? "dragging" : ""}`} {...dropHandlers}>
        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            Drop files to attach
          </div>
        )}
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
          <div className="messages-placeholder">
            <Spinner label="Loading messages" />
          </div>
        ) : reachedStart && messages.length === 0 && pending.length === 0 ? (
          <p className="muted messages-placeholder">No messages yet. Say hi!</p>
        ) : (
          <div className="messages-wrap">
            {loadingOlder && (
              <div className="history-loading">
                <Spinner label="Loading earlier messages" />
              </div>
            )}
            <ul className="messages" ref={listRef} onScroll={onListScroll}>
              {reachedStart && (
                <li className="history-start" role="note">
                  This is the beginning of «{room.name}»
                </li>
              )}
              {olderError && (
                <li className="history-start error" role="alert">
                  Couldn't load earlier messages.{" "}
                  <button type="button" className="link" onClick={() => void loadOlder(room.id)}>
                    Retry
                  </button>
                </li>
              )}
              {messages.map((m, i) => (
                <Fragment key={m.id}>
                  {daySeparator(m.createdAt, messages[i - 1]?.createdAt)}
                  {renderMessage(m, messages[i + 1])}
                </Fragment>
              ))}
              {pending.map((p, i) => (
                <Fragment key={p.tempId}>
                  {daySeparator(p.createdAt, (i === 0 ? messages.at(-1) : pending[i - 1])?.createdAt)}
                  <li className="own pending">
                    <PendingAttachments files={p.files} />
                    {p.text}
                    <span className="message-meta">
                      {time(p.createdAt)}
                      <MessageStatus
                        info={{ status: p.status, deliveredCount: 0, readCount: 0 }}
                        onRetry={() => void retry(room.id, p.tempId)}
                        error={p.error}
                      />
                    </span>
                  </li>
                </Fragment>
              ))}
            </ul>
          </div>
        )}

        <TypingIndicator roomId={room.id} members={room.members} />
        {editing && (
          <div className="editing-bar">
            <div className="editing-preview">
              <span className="editing-label">Editing message</span>
              <span className="muted small">{messagePreview(editing.message)}</span>
            </div>
            <button type="button" className="ghost icon" aria-label="Cancel editing" title="Cancel (Esc)" onClick={stopEditing}>
              ✕
            </button>
          </div>
        )}
        {editError && <p className="error">{editError}</p>}
        {fileError && <p className="error">{fileError}</p>}
        {voice.error && <p className="error">{voice.error}</p>}
        <DraftAttachments files={files} onRemove={removeFile} />
        <form onSubmit={(e) => void onSubmit(e)} className="composer">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              pickFiles([...(e.target.files ?? [])]);
              e.target.value = ""; // so picking the same file again fires change
            }}
          />
          {voiceDraft ? (
            <VoiceDraft file={voiceDraft} onDelete={deleteVoiceDraft} />
          ) : voice.state === "idle" ? (
            <>
              <button
                type="button"
                className="ghost icon attach-toggle"
                aria-label="Attach files"
                title={editing ? "Files can't be changed while editing" : "Attach files"}
                disabled={!!editing}
                onClick={() => fileInputRef.current?.click()}
              >
                📎
              </button>
              <textarea
                ref={inputRef}
                rows={1}
                placeholder={`Message ${room.name}`}
                value={text}
                onChange={onTextChange}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={editing ? undefined : typing.stop}
              />
              <EmojiPicker onPick={insertEmoji} />
            </>
          ) : (
            <RecordingBar recording={voice.live} cancelling={cancelling} />
          )}
          {voiceDraft ? (
            <button ref={sendVoiceRef} type="button" onClick={sendVoiceDraft}>
              Send
            </button>
          ) : showMic || voice.state !== "idle" ? (
            // Stays mounted while recording: it holds the pointer capture until release.
            <button
              type="button"
              className={`mic ${voice.state !== "idle" ? "recording" : ""}`}
              aria-label="Hold to record a voice message"
              title="Hold to record a voice message"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                void beginHold(e.clientX);
              }}
              onPointerMove={(e) => {
                if (holding.current) setCancelling(holding.current.x - e.clientX > CANCEL_DRAG_PX);
              }}
              onPointerUp={endHold}
              onPointerCancel={() => void finishVoice(false)}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                  e.preventDefault();
                  void beginHold(0);
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") endHold();
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              🎤
            </button>
          ) : (
            <button type="submit" disabled={saving}>
              {editing ? "Save" : "Send"}
            </button>
          )}
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
