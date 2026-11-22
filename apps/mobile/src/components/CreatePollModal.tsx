import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { POLL_MAX_OPTIONS, POLL_VOTE_LIMIT_MAX, POLL_VOTE_LIMIT_MIN, createPollSchema, type Message } from "@pm/shared";
import { api } from "../lib/api";
import { colors } from "../lib/theme";

/** An option being written; `key` stays the same while it's edited and moved. */
interface DraftOption {
  key: number;
  text: string;
}

let lastKey = 0;
const draftOption = (text: string): DraftOption => ({ key: ++lastKey, text });

/** Moves the item at `from` to `to` (both indexes in `list`). */
const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

/**
 * The room owner's form for a new poll, as on the web: question, options in order (moved with
 * ↑ ↓ rather than dragged), and how people may answer. `onCreated` gets the poll's message.
 */
export function CreatePollModal({
  roomId,
  visible,
  onClose,
  onCreated,
}: {
  roomId: number;
  visible: boolean;
  onClose: () => void;
  onCreated: (message: Message) => void;
}) {
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

  const full = options.length >= POLL_MAX_OPTIONS;
  // On Android the modal covers the whole screen, status and navigation bars included (on iOS it's a
  // sheet below the status bar), so keep the header and the last field clear of them.
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "android" ? insets.top : 0;

  const reset = () => {
    setQuestion("");
    setOptions([]);
    setNewOption("");
    setMultiple(false);
    setMaxVotes(null);
    setAnonymous(false);
    setAllowSuggestions(false);
    setAllowComments(false);
    setError(null);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const commitNewOption = () => {
    const text = newOption.trim();
    if (!text || full) return;
    setOptions((list) => [...list, draftOption(text)]);
    setNewOption("");
  };

  const submit = async () => {
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
      const message = await api.createPoll(roomId, parsed.data);
      onCreated(message);
      reset();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.screen} behavior="padding">
        <View style={[styles.header, { paddingTop: styles.header.paddingVertical + topInset }]}>
          <Pressable onPress={close} disabled={submitting} hitSlop={8}>
            <Text style={[styles.headerButton, submitting && styles.disabled]}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Create poll</Text>
          <Pressable onPress={() => void submit()} disabled={submitting} hitSlop={8}>
            <Text style={[styles.headerButton, styles.headerPrimary, submitting && styles.disabled]}>
              {submitting ? "Creating…" : "Create"}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: styles.content.padding + insets.bottom }]} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Question</Text>
          <TextInput
            style={styles.input}
            autoFocus
            value={question}
            maxLength={300}
            placeholder="Ask a question"
            onChangeText={setQuestion}
            multiline
          />

          <Text style={styles.label}>Options</Text>
          {options.map((o, i) => (
            <View key={o.key} style={styles.optionRow}>
              <View style={styles.moveButtons}>
                <IconButton label="↑" accessibilityLabel={`Move “${o.text}” up`} disabled={i === 0} onPress={() => setOptions((l) => move(l, i, i - 1))} />
                <IconButton
                  label="↓"
                  accessibilityLabel={`Move “${o.text}” down`}
                  disabled={i === options.length - 1}
                  onPress={() => setOptions((l) => move(l, i, i + 1))}
                />
              </View>
              <TextInput
                style={[styles.input, styles.optionInput]}
                value={o.text}
                maxLength={100}
                accessibilityLabel={`Option ${i + 1}`}
                onChangeText={(text) => setOptions((l) => l.map((x) => (x.key === o.key ? { ...x, text } : x)))}
              />
              <IconButton
                label="⊖"
                accessibilityLabel={`Remove “${o.text}”`}
                onPress={() => setOptions((l) => l.filter((x) => x.key !== o.key))}
              />
            </View>
          ))}
          {full ? (
            <Text style={styles.hint}>That's the maximum of {POLL_MAX_OPTIONS} options.</Text>
          ) : (
            <TextInput
              style={styles.input}
              value={newOption}
              maxLength={100}
              placeholder="Add an option"
              onChangeText={setNewOption}
              onSubmitEditing={commitNewOption}
              onBlur={commitNewOption}
              submitBehavior="submit"
              returnKeyType="next"
            />
          )}

          <View style={styles.group}>
            <Toggle
              label="Multiple votes"
              hint="Select more than one option"
              value={multiple}
              onChange={(on) => {
                setMultiple(on);
                if (!on) setMaxVotes(null);
              }}
            />
            <Toggle
              label="Limit votes per person"
              hint={`Choose between ${POLL_VOTE_LIMIT_MIN}–${POLL_VOTE_LIMIT_MAX} options`}
              value={maxVotes !== null}
              disabled={!multiple}
              onChange={(on) => setMaxVotes(on ? POLL_VOTE_LIMIT_MIN : null)}
            />
            {maxVotes !== null && (
              <View style={styles.limitRow}>
                <Text style={styles.toggleLabel}>Each person picks up to</Text>
                <IconButton label="−" accessibilityLabel="Fewer" disabled={maxVotes <= POLL_VOTE_LIMIT_MIN} onPress={() => setMaxVotes(maxVotes - 1)} />
                <Text style={styles.limitValue}>{maxVotes}</Text>
                <IconButton label="+" accessibilityLabel="More" disabled={maxVotes >= POLL_VOTE_LIMIT_MAX} onPress={() => setMaxVotes(maxVotes + 1)} />
              </View>
            )}
          </View>
          <View style={styles.group}>
            <Toggle label="Anonymous poll" hint="Hide who voted" value={anonymous} onChange={setAnonymous} />
          </View>
          <View style={styles.group}>
            <Toggle label="Suggest an option" hint="Let others add options" value={allowSuggestions} onChange={setAllowSuggestions} />
          </View>
          <View style={styles.group}>
            <Toggle label="Add a comment" hint="Allow others to add comments" value={allowComments} onChange={setAllowComments} />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Toggle(props: { label: string; hint: string; value: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <View style={[styles.toggleRow, props.disabled && styles.disabled]}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{props.label}</Text>
        <Text style={styles.hint}>{props.hint}</Text>
      </View>
      <Switch
        value={props.value}
        disabled={props.disabled}
        onValueChange={props.onChange}
        trackColor={{ true: colors.accent }}
        accessibilityLabel={props.label}
      />
    </View>
  );
}

function IconButton(props: { label: string; accessibilityLabel: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, props.disabled && styles.disabled]}
      disabled={props.disabled}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      hitSlop={4}
    >
      <Text style={styles.iconText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  title: { fontSize: 17, fontWeight: "600", color: colors.text },
  headerButton: { fontSize: 16, color: colors.accent },
  headerPrimary: { fontWeight: "600" },
  content: { padding: 16, gap: 8 },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: 8, textTransform: "uppercase" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  optionInput: { flex: 1 },
  moveButtons: { flexDirection: "row", gap: 2 },
  iconButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16 },
  iconText: { fontSize: 18, color: colors.accent },
  pressed: { backgroundColor: colors.bubble },
  disabled: { opacity: 0.4 },
  group: { marginTop: 8, borderRadius: 12, backgroundColor: colors.card, paddingHorizontal: 12 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: 16, color: colors.text },
  hint: { fontSize: 13, color: colors.muted },
  limitRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10 },
  limitValue: { minWidth: 20, textAlign: "center", fontSize: 16, fontWeight: "600", color: colors.text },
  error: { color: colors.error, marginTop: 8 },
});
