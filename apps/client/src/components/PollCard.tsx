import { useState, type FormEvent } from "react";
import { POLL_MAX_OPTIONS, type Message, type PollOption, type User } from "@pm/shared";
import { displayName } from "../lib/users";
import { useBlocks } from "../store/blocks";
import { useMessages } from "../store/messages";
import { Avatar } from "./Avatar";

/** Voters shown as avatars next to an option's result; the rest are only counted. */
const VOTER_AVATARS = 3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A poll in the message list. Before voting: the options to pick from (one tap votes in a
 * single-answer poll; a multiple-answer poll has a Vote button). After voting: the results,
 * with who voted unless the poll is anonymous. Suggestions and comments when the poll allows them.
 */
export function PollCard({ message, me }: { message: Message; me: User }) {
  const poll = message.poll!;
  const vote = useMessages((s) => s.vote);
  const addPollOption = useMessages((s) => s.addPollOption);
  const commentPoll = useMessages((s) => s.commentPoll);
  const blocked = useBlocks((s) => s.ids);

  /** Options ticked in a multiple-answer poll, not sent yet. */
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [showComments, setShowComments] = useState(false);
  const [comment, setComment] = useState("");

  const voted = poll.myVotes.length > 0;
  const mine = new Set(poll.myVotes);
  const limit = poll.multiple ? Math.min(poll.maxVotes ?? POLL_MAX_OPTIONS, poll.options.length) : 1;
  const canSuggest = (poll.allowSuggestions || message.author.id === me.id) && poll.options.length < POLL_MAX_OPTIONS;
  const comments = poll.comments.filter((c) => !blocked.has(c.author.id));

  /** Runs a request with the card busy; true if it worked, else the error is shown. */
  const run = async (request: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await request();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitVote = async (optionIds: number[]) => {
    if (await run(() => vote(message.roomId, message.id, optionIds))) setPicked([]);
  };

  const onPick = (id: number) => {
    if (!poll.multiple) return void submitVote([id]);
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= limit ? list : [...list, id]));
  };

  const onSuggest = async (e: FormEvent) => {
    e.preventDefault();
    const text = suggestion.trim();
    if (!text) return;
    if (await run(() => addPollOption(message.roomId, message.id, text))) {
      setSuggestion("");
      setSuggesting(false);
    }
  };

  const onComment = async (e: FormEvent) => {
    e.preventDefault();
    const text = comment.trim();
    if (!text) return;
    if (await run(() => commentPoll(message.roomId, message.id, text))) setComment("");
  };

  /** "suggested by Bob" for options someone other than the poll's author added. */
  const suggestedBy = (o: PollOption) =>
    o.addedBy && o.addedBy.id !== message.author.id ? (
      <span className="poll-suggested muted small">suggested by {o.addedBy.id === me.id ? "you" : displayName(o.addedBy)}</span>
    ) : null;

  const kind = [
    poll.anonymous ? "Anonymous poll" : "Poll",
    poll.multiple && (poll.maxVotes ? `up to ${poll.maxVotes} answers` : "multiple answers"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // Taps inside the poll vote; they don't select the message (that's for its delete button on touch).
    <div className="poll" onClick={(e) => e.stopPropagation()}>
      <div className="poll-question">{poll.question}</div>
      <div className="muted small">{kind}</div>

      <ul className="poll-options">
        {poll.options.map((o) => {
          if (voted) {
            const percent = poll.voterCount === 0 ? 0 : Math.round((o.voteCount / poll.voterCount) * 100);
            const names = o.voters.map((u) => (u.id === me.id ? "You" : displayName(u))).join(", ");
            return (
              <li key={o.id} className={`poll-result ${mine.has(o.id) ? "mine" : ""}`}>
                <div className="poll-result-row">
                  <span className="poll-percent">{percent}%</span>
                  <span className="poll-option-text">
                    {o.text}
                    {mine.has(o.id) && <span className="poll-check" aria-label="your vote"> ✓</span>}
                  </span>
                  {o.voters.length > 0 && (
                    <span className="poll-voters" title={names} aria-label={`Voted: ${names}`}>
                      {o.voters.slice(0, VOTER_AVATARS).map((u) => (
                        <Avatar key={u.id} user={u} size={18} />
                      ))}
                      {o.voters.length > VOTER_AVATARS && <span className="muted small">+{o.voters.length - VOTER_AVATARS}</span>}
                    </span>
                  )}
                </div>
                <div className="poll-bar" aria-hidden="true">
                  <span style={{ width: `${percent}%` }} />
                </div>
                {suggestedBy(o)}
              </li>
            );
          }
          const checked = picked.includes(o.id);
          return (
            <li key={o.id}>
              <button
                type="button"
                className={`poll-choice ${checked ? "picked" : ""}`}
                role={poll.multiple ? "checkbox" : undefined}
                aria-checked={poll.multiple ? checked : undefined}
                disabled={busy || (poll.multiple && !checked && picked.length >= limit)}
                onClick={() => onPick(o.id)}
              >
                <span className={`poll-mark ${poll.multiple ? "square" : ""}`} aria-hidden="true" />
                <span className="poll-option-text">{o.text}</span>
              </button>
              {suggestedBy(o)}
            </li>
          );
        })}
      </ul>

      {canSuggest &&
        (suggesting ? (
          <form className="poll-inline-form" onSubmit={(e) => void onSuggest(e)}>
            <input
              autoFocus
              value={suggestion}
              maxLength={100}
              placeholder="New option"
              aria-label="New option"
              onChange={(e) => setSuggestion(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSuggesting(false)}
            />
            <button type="submit" disabled={busy || !suggestion.trim()}>
              Add
            </button>
            <button type="button" className="ghost icon" aria-label="Cancel" onClick={() => setSuggesting(false)}>
              ✕
            </button>
          </form>
        ) : (
          <button type="button" className="link small poll-add-option" onClick={() => setSuggesting(true)}>
            + Add an option
          </button>
        ))}

      <div className="poll-footer">
        <span className="muted small">{poll.voterCount === 0 ? "No votes yet" : plural(poll.voterCount, "vote", "votes")}</span>
        {!voted && poll.multiple && (
          <button type="button" className="poll-vote" disabled={busy || picked.length === 0} onClick={() => void submitVote(picked)}>
            Vote
          </button>
        )}
        {voted && (
          <button type="button" className="link small" disabled={busy} onClick={() => void submitVote([])}>
            Retract vote
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {poll.allowComments && (
        <div className="poll-comments">
          <button type="button" className="link small" onClick={() => setShowComments((v) => !v)} aria-expanded={showComments}>
            💬 {comments.length === 0 ? "Comment" : plural(comments.length, "comment", "comments")}
          </button>
          {showComments && (
            <>
              {comments.length > 0 && (
                <ul className="poll-comment-list">
                  {comments.map((c) => (
                    <li key={c.id}>
                      <Avatar user={c.author} size={20} />
                      <span>
                        <span className="poll-comment-author">{c.author.id === me.id ? "You" : displayName(c.author)}</span>{" "}
                        {c.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <form className="poll-inline-form" onSubmit={(e) => void onComment(e)}>
                <input
                  value={comment}
                  maxLength={500}
                  placeholder="Add a comment"
                  aria-label="Add a comment"
                  onChange={(e) => setComment(e.target.value)}
                />
                <button type="submit" disabled={busy || !comment.trim()}>
                  Send
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
