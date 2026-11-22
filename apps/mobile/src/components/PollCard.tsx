import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { POLL_MAX_OPTIONS, type Message, type Poll, type PollOption } from "@pm/shared";
import { api } from "../lib/api";
import { displayName } from "../lib/format";
import { colors } from "../lib/theme";

/** Voters named next to an option's result; the rest are only counted. */
const VOTER_NAMES = 3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A poll in the message list, as on the web. Before voting: the options to pick from (one tap
 * votes in a single-answer poll; a multiple-answer poll has a Vote button). After voting: the
 * results, with who voted unless the poll is anonymous. Suggestions and comments when allowed.
 * `onPoll` gets the poll the server returned after this user's vote, suggestion or comment.
 */
export function PollCard({ message, meId, onPoll }: { message: Message; meId: number; onPoll: (poll: Poll) => void }) {
  const poll = message.poll!;
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
  const canSuggest = (poll.allowSuggestions || message.author.id === meId) && poll.options.length < POLL_MAX_OPTIONS;
  const name = (u: { id: number; name: string | null; username: string }) => (u.id === meId ? "You" : displayName(u));

  /** Sends a request with the card busy; true if it worked, else the error is shown. */
  const run = async (request: () => Promise<Poll>) => {
    setBusy(true);
    setError(null);
    try {
      onPoll(await request());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const vote = async (optionIds: number[]) => {
    if (await run(() => api.votePoll(message.roomId, message.id, { optionIds }))) setPicked([]);
  };

  const pick = (id: number) => {
    if (!poll.multiple) return void vote([id]);
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= limit ? list : [...list, id]));
  };

  const suggest = async () => {
    const text = suggestion.trim();
    if (!text) return;
    if (await run(() => api.addPollOption(message.roomId, message.id, { text }))) {
      setSuggestion("");
      setSuggesting(false);
    }
  };

  const sendComment = async () => {
    const text = comment.trim();
    if (!text) return;
    if (await run(() => api.commentPoll(message.roomId, message.id, { text }))) setComment("");
  };

  /** "suggested by Bob" for options someone other than the poll's author added. */
  const suggestedBy = (o: PollOption) =>
    o.addedBy && o.addedBy.id !== message.author.id ? (
      <Text style={styles.small}>suggested by {o.addedBy.id === meId ? "you" : displayName(o.addedBy)}</Text>
    ) : null;

  const kind = [
    poll.anonymous ? "Anonymous poll" : "Poll",
    poll.multiple && (poll.maxVotes ? `up to ${poll.maxVotes} answers` : "multiple answers"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.poll}>
      <Text style={styles.question}>{poll.question}</Text>
      <Text style={styles.small}>{kind}</Text>

      <View style={styles.options}>
        {poll.options.map((o) => {
          if (voted) {
            const percent = poll.voterCount === 0 ? 0 : Math.round((o.voteCount / poll.voterCount) * 100);
            const names = o.voters.slice(0, VOTER_NAMES).map(name).join(", ");
            const more = o.voters.length - VOTER_NAMES;
            return (
              <View key={o.id} style={styles.result}>
                <View style={styles.resultRow}>
                  <Text style={styles.percent}>{percent}%</Text>
                  <Text style={[styles.optionText, mine.has(o.id) && styles.mineText]}>
                    {o.text}
                    {mine.has(o.id) ? " ✓" : ""}
                  </Text>
                </View>
                <View style={styles.bar}>
                  <View style={[styles.barFill, mine.has(o.id) && styles.barMine, { width: `${percent}%` }]} />
                </View>
                {o.voters.length > 0 && (
                  <Text style={styles.small} numberOfLines={1}>
                    {names}
                    {more > 0 ? ` +${more}` : ""}
                  </Text>
                )}
                {suggestedBy(o)}
              </View>
            );
          }
          const checked = picked.includes(o.id);
          const disabled = busy || (poll.multiple && !checked && picked.length >= limit);
          return (
            <View key={o.id}>
              <Pressable
                style={({ pressed }) => [styles.choice, checked && styles.choicePicked, pressed && styles.pressed, disabled && styles.disabled]}
                disabled={disabled}
                onPress={() => pick(o.id)}
                accessibilityRole={poll.multiple ? "checkbox" : "radio"}
                accessibilityState={{ checked, disabled }}
              >
                <View style={[styles.mark, poll.multiple && styles.markSquare, checked && styles.markChecked]} />
                <Text style={styles.optionText}>{o.text}</Text>
              </Pressable>
              {suggestedBy(o)}
            </View>
          );
        })}
      </View>

      {canSuggest &&
        (suggesting ? (
          <View style={styles.inlineForm}>
            <TextInput
              style={styles.input}
              autoFocus
              value={suggestion}
              maxLength={100}
              placeholder="New option"
              onChangeText={setSuggestion}
              onSubmitEditing={() => void suggest()}
              returnKeyType="done"
            />
            <SmallButton label="Add" disabled={busy || !suggestion.trim()} onPress={() => void suggest()} />
            <Pressable onPress={() => setSuggesting(false)} hitSlop={8} accessibilityLabel="Cancel">
              <Text style={styles.link}>✕</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setSuggesting(true)} hitSlop={6}>
            <Text style={styles.link}>+ Add an option</Text>
          </Pressable>
        ))}

      <View style={styles.footer}>
        <Text style={styles.small}>{poll.voterCount === 0 ? "No votes yet" : plural(poll.voterCount, "vote", "votes")}</Text>
        {busy && <ActivityIndicator size="small" />}
        <View style={styles.spacer} />
        {!voted && poll.multiple && <SmallButton label="Vote" disabled={busy || picked.length === 0} onPress={() => void vote(picked)} />}
        {voted && (
          <Pressable disabled={busy} onPress={() => void vote([])} hitSlop={6}>
            <Text style={[styles.link, busy && styles.disabled]}>Retract vote</Text>
          </Pressable>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {poll.allowComments && (
        <View style={styles.comments}>
          <Pressable onPress={() => setShowComments((v) => !v)} hitSlop={6} accessibilityState={{ expanded: showComments }}>
            <Text style={styles.link}>💬 {poll.comments.length === 0 ? "Comment" : plural(poll.comments.length, "comment", "comments")}</Text>
          </Pressable>
          {showComments && (
            <>
              {poll.comments.map((c) => (
                <Text key={c.id} style={styles.comment}>
                  <Text style={styles.commentAuthor}>{name(c.author)}</Text> {c.text}
                </Text>
              ))}
              <View style={styles.inlineForm}>
                <TextInput
                  style={styles.input}
                  value={comment}
                  maxLength={500}
                  placeholder="Add a comment"
                  onChangeText={setComment}
                  onSubmitEditing={() => void sendComment()}
                  returnKeyType="send"
                />
                <SmallButton label="Send" disabled={busy || !comment.trim()} onPress={() => void sendComment()} />
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function SmallButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.button, disabled && styles.disabled]} disabled={disabled} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  poll: { gap: 6, minWidth: 240 },
  question: { fontSize: 16, fontWeight: "600", color: colors.text },
  small: { fontSize: 12, color: colors.muted },
  options: { gap: 8, marginTop: 4 },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  choicePicked: { borderColor: colors.accent },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  mark: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border },
  markSquare: { borderRadius: 4 },
  markChecked: { borderColor: colors.accent, backgroundColor: colors.accent },
  optionText: { flex: 1, fontSize: 15, color: colors.text },
  mineText: { fontWeight: "600" },
  result: { gap: 3 },
  resultRow: { flexDirection: "row", gap: 8, alignItems: "baseline" },
  percent: { minWidth: 38, fontSize: 14, fontWeight: "600", color: colors.text },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.bubble, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3, backgroundColor: colors.muted },
  barMine: { backgroundColor: colors.accent },
  link: { fontSize: 14, color: colors.accent },
  inlineForm: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.card,
  },
  footer: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  spacer: { flex: 1 },
  button: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.accent },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  error: { color: colors.error, fontSize: 13 },
  comments: { gap: 6, marginTop: 2 },
  comment: { fontSize: 14, color: colors.text },
  commentAuthor: { fontWeight: "600" },
});
