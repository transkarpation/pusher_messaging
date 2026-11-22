import { useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { POLL_MAX_OPTIONS, POLL_VOTE_LIMIT_MAX, POLL_VOTE_LIMIT_MIN, createPollSchema } from "@pm/shared";
import { useMessages } from "../store/messages";
import { Modal } from "./Modal";

/** An option being written; `key` stays the same while it's edited and moved. */
interface DraftOption {
  key: number;
  text: string;
}

let lastKey = 0;
const draftOption = (text: string): DraftOption => ({ key: ++lastKey, text });

const LIMITS = Array.from({ length: POLL_VOTE_LIMIT_MAX - POLL_VOTE_LIMIT_MIN + 1 }, (_, i) => POLL_VOTE_LIMIT_MIN + i);

/** Moves the item at `from` to `to` (both indexes in `list`). */
const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

/** The room owner's form for a new poll: question, options in order, and how people may answer. */
export function CreatePollModal({ roomId, onClose }: { roomId: number; onClose: () => void }) {
  const createPoll = useMessages((s) => s.createPoll);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<DraftOption[]>([]);
  /** What's typed in "Add an option"; it becomes an option on Enter or when the field loses focus. */
  const [newOption, setNewOption] = useState("");
  const [multiple, setMultiple] = useState(false);
  const [maxVotes, setMaxVotes] = useState<number | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [allowSuggestions, setAllowSuggestions] = useState(false);
  const [allowComments, setAllowComments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const listRef = useRef<HTMLUListElement>(null);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const newOptionRef = useRef<HTMLInputElement>(null);
  /** The option being dragged by its handle. */
  const [dragKey, setDragKey] = useState<number | null>(null);

  const full = options.length >= POLL_MAX_OPTIONS;

  const focusLater = (el: () => HTMLInputElement | null | undefined) =>
    requestAnimationFrame(() => {
      const input = el();
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });

  const commitNewOption = () => {
    const text = newOption.trim();
    if (!text || full) return false;
    setOptions((list) => [...list, draftOption(text)]);
    setNewOption("");
    return true;
  };

  const setText = (key: number, text: string) =>
    setOptions((list) => list.map((o) => (o.key === key ? { ...o, text } : o)));

  const removeOption = (key: number) => setOptions((list) => list.filter((o) => o.key !== key));

  /** Enter moves to the next field; Backspace in an empty option removes it. */
  const onOptionKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const next = options[index + 1];
      focusLater(() => (next ? inputs.current.get(next.key) : newOptionRef.current));
    } else if (e.key === "Backspace" && e.currentTarget.value === "") {
      e.preventDefault();
      const prev = options[index - 1];
      removeOption(options[index]!.key);
      focusLater(() => (prev ? inputs.current.get(prev.key) : newOptionRef.current));
    }
  };

  const onNewOptionKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.key !== "Enter") return;
    e.preventDefault(); // Enter adds the option instead of submitting the form
    commitNewOption();
  };

  // Dragging by the handle: the option takes the place of the row under the pointer.
  const onHandleDown = (e: PointerEvent<HTMLButtonElement>, key: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragKey(key);
  };

  const onHandleMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (dragKey === null || !listRef.current) return;
    const rows = [...listRef.current.querySelectorAll<HTMLElement>("[data-option]")];
    const below = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    setOptions((list) => {
      const from = list.findIndex((o) => o.key === dragKey);
      let to = below === -1 ? list.length : below;
      if (to > from) to -= 1; // the dragged row itself is above the pointer
      return move(list, from, to);
    });
  };

  /** Arrow keys on the handle move the option up and down. */
  const onHandleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    setOptions((list) => move(list, index, index + step));
    requestAnimationFrame(() => handle.focus());
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const texts = [...options.map((o) => o.text), newOption].map((t) => t.trim()).filter(Boolean);
    const parsed = createPollSchema.safeParse({
      question,
      options: texts,
      multiple,
      maxVotes: multiple ? maxVotes : null,
      anonymous,
      allowSuggestions,
      allowComments,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid poll");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await createPoll(roomId, parsed.data);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Create poll" onClose={submitting ? undefined : onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="stack poll-form">
        <label>
          Question
          <input
            autoFocus
            value={question}
            maxLength={300}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question"
          />
        </label>

        <div className="stack poll-form-options">
          <span className="label">Options</span>
          <ul className="poll-draft-options" ref={listRef}>
            {options.map((o, i) => (
              <li key={o.key} data-option className={o.key === dragKey ? "dragging" : undefined}>
                <button
                  type="button"
                  className="ghost icon drag-handle"
                  aria-label={`Move “${o.text}” (arrow keys)`}
                  title="Drag to reorder"
                  onPointerDown={(e) => onHandleDown(e, o.key)}
                  onPointerMove={onHandleMove}
                  onPointerUp={() => setDragKey(null)}
                  onPointerCancel={() => setDragKey(null)}
                  onKeyDown={(e) => onHandleKeyDown(e, i)}
                >
                  ⠿
                </button>
                <input
                  ref={(el) => {
                    if (el) inputs.current.set(o.key, el);
                    else inputs.current.delete(o.key);
                  }}
                  value={o.text}
                  maxLength={100}
                  aria-label={`Option ${i + 1}`}
                  onChange={(e) => setText(o.key, e.target.value)}
                  onKeyDown={(e) => onOptionKeyDown(e, i)}
                />
                <button
                  type="button"
                  className="ghost icon remove-option"
                  aria-label={`Remove “${o.text}”`}
                  title="Remove"
                  onClick={() => removeOption(o.key)}
                >
                  ⊖
                </button>
              </li>
            ))}
          </ul>
          {full ? (
            <span className="muted small">That's the maximum of {POLL_MAX_OPTIONS} options.</span>
          ) : (
            <input
              ref={newOptionRef}
              value={newOption}
              maxLength={100}
              placeholder="Add an option"
              aria-label="Add an option"
              onChange={(e) => setNewOption(e.target.value)}
              onKeyDown={onNewOptionKeyDown}
              onBlur={commitNewOption}
            />
          )}
        </div>

        <div className="toggle-group">
          <Toggle
            label="Multiple votes"
            hint="Select more than one option"
            checked={multiple}
            onChange={(on) => {
              setMultiple(on);
              if (!on) setMaxVotes(null);
            }}
          />
          <Toggle
            label="Limit votes per person"
            hint={`Choose between ${POLL_VOTE_LIMIT_MIN}–${POLL_VOTE_LIMIT_MAX} options`}
            checked={maxVotes !== null}
            disabled={!multiple}
            onChange={(on) => setMaxVotes(on ? POLL_VOTE_LIMIT_MIN : null)}
          />
          {maxVotes !== null && (
            <label className="limit-row">
              <span>Each person picks up to</span>
              <select value={maxVotes} onChange={(e) => setMaxVotes(Number(e.target.value))}>
                {LIMITS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span>options</span>
            </label>
          )}
        </div>
        <div className="toggle-group">
          <Toggle label="Anonymous poll" hint="Hide who voted" checked={anonymous} onChange={setAnonymous} />
        </div>
        <div className="toggle-group">
          <Toggle label="Suggest an option" hint="Let others add options" checked={allowSuggestions} onChange={setAllowSuggestions} />
        </div>
        <div className="toggle-group">
          <Toggle label="Add a comment" hint="Allow others to add comments" checked={allowComments} onChange={setAllowComments} />
        </div>

        {error && <p className="error">{error}</p>}
        <div className="row modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create poll"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Toggle(props: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`toggle-row ${props.disabled ? "disabled" : ""}`}>
      <span className="toggle-text">
        <span>{props.label}</span>
        <span className="muted small">{props.hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}
