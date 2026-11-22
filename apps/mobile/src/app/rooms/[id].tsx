import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import type { RealtimeConnection } from "@pm/realtime-client";
import {
  MESSAGE_CREATED_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_UPDATED_EVENT,
  POLL_UPDATED_EVENT,
  isInlineImage,
  isSystemMessage,
  roomChannel,
  type Message,
  type Poll,
  type PollUpdatedEvent,
} from "@pm/shared";
import { absoluteUrl, api, authHeaders } from "../../lib/api";
import { displayName, time } from "../../lib/format";
import { getRealtime } from "../../lib/realtime";
import { useSession } from "../../lib/session";
import { colors } from "../../lib/theme";

/** Merges by id, newest first (the list is inverted, so index 0 is at the bottom). */
const merge = (a: Message[], b: Message[]) => {
  const byId = new Map(a.map((m) => [m.id, m]));
  for (const m of b) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => y.id - x.id);
};

/** Within this distance (px) of the bottom the list counts as scrolled to the newest message. */
const NEAR_BOTTOM_THRESHOLD = 80;

export default function RoomScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const roomId = Number(id);
  const me = useSession((s) => s.user)!;
  const headerHeight = useHeaderHeight();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  /** False while the user has scrolled up into the history: shows the jump-to-latest button. */
  const [atBottom, setAtBottom] = useState(true);
  /** Read by the realtime handler, which is bound once per room. */
  const atBottomRef = useRef(true);
  /** Messages from others that arrived while scrolled up, shown as a count on that button. */
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .getMessages(roomId)
      .then((page) => {
        if (cancelled) return;
        setMessages((prev) => merge(prev, page.messages));
        setHasMore(page.hasMore);
        setLoaded(true);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // New, edited and deleted messages from others, and poll results, live.
  useEffect(() => {
    const channelName = roomChannel(roomId);
    const apply = (m: Message) => setMessages((prev) => merge(prev, [m]));
    let rt: RealtimeConnection | null = null;
    let stopped = false;
    getRealtime()
      .then((conn) => {
        if (stopped) return;
        rt = conn;
        const channel = conn.subscribe(channelName);
        channel.bind(MESSAGE_CREATED_EVENT, (m: Message) => {
          apply(m);
          if (m.author.id !== me.id && !atBottomRef.current) setUnseen((n) => n + 1);
        });
        channel.bind(MESSAGE_UPDATED_EVENT, apply);
        channel.bind(MESSAGE_DELETED_EVENT, apply);
        channel.bind(POLL_UPDATED_EVENT, (e: PollUpdatedEvent) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === e.messageId && m.poll && e.poll.version >= m.poll.version
                ? { ...m, poll: { ...e.poll, myVotes: m.poll.myVotes } }
                : m,
            ),
          ),
        );
      })
      .catch((e) => console.warn("Realtime is unavailable:", e));
    return () => {
      stopped = true;
      rt?.channel(channelName)?.unbindAll();
      rt?.unsubscribe(channelName);
    };
  }, [roomId, me.id]);

  const scrollToLatest = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });

  const loadOlder = async () => {
    const oldest = messages.at(-1)?.id;
    if (!hasMore || loadingOlder || oldest === undefined) return;
    setLoadingOlder(true);
    try {
      const page = await api.getMessages(roomId, oldest);
      setMessages((prev) => merge(prev, page.messages));
      setHasMore(page.hasMore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    try {
      const message = await api.createMessage(roomId, { text: value });
      setMessages((prev) => merge(prev, [message]));
      setText("");
      scrollToLatest();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen options={{ title: name ?? "Room" }} />
      {!loaded && !error ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            inverted
            data={messages}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={styles.list}
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingOlder ? <ActivityIndicator style={styles.loading} /> : undefined}
            renderItem={({ item }) => <MessageItem message={item} meId={me.id} />}
            // The list is inverted, so "top" here is the bottom of the chat: new messages keep
            // the view still while scrolled up, and follow along when already near the bottom.
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: NEAR_BOTTOM_THRESHOLD }}
            scrollEventThrottle={32}
            onScroll={(e) => {
              const near = e.nativeEvent.contentOffset.y <= NEAR_BOTTOM_THRESHOLD;
              if (near === atBottomRef.current) return;
              atBottomRef.current = near;
              setAtBottom(near);
              if (near) setUnseen(0);
            }}
          />
          {!atBottom && (
            <Pressable
              style={({ pressed }) => [styles.jump, unseen > 0 && styles.jumpUnseen, pressed && styles.jumpPressed]}
              onPress={scrollToLatest}
              accessibilityRole="button"
              accessibilityLabel={unseen > 0 ? `${unseen} new message${unseen === 1 ? "" : "s"}, jump to latest` : "Jump to latest message"}
              hitSlop={8}
            >
              {unseen > 0 && <Text style={[styles.jumpLabel, styles.jumpTextUnseen]}>{unseen > 99 ? "99+" : unseen} new</Text>}
              <Text style={[styles.jumpArrow, unseen > 0 && styles.jumpTextUnseen]}>↓</Text>
            </Pressable>
          )}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Message"
          multiline
          value={text}
          onChangeText={setText}
        />
        <Pressable style={[styles.send, (!text.trim() || sending) && styles.disabled]} disabled={!text.trim() || sending} onPress={() => void send()}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageItem({ message: m, meId }: { message: Message; meId: number }) {
  const own = m.author.id === meId;
  if (isSystemMessage(m)) {
    const who = own ? "You" : displayName(m.author);
    return <Text style={styles.system}>{m.kind === "member_joined" ? `${who} joined the room` : `${who} left the room`}</Text>;
  }
  return (
    <View style={[styles.bubble, own ? styles.own : styles.other]}>
      {!own && <Text style={styles.author}>{displayName(m.author)}</Text>}
      {m.deletedAt ? (
        <Text style={styles.deleted}>{own ? "You deleted this message" : "This message was deleted"}</Text>
      ) : (
        <>
          {m.attachments.map((a) =>
            isInlineImage(a.contentType) ? (
              // Attachments are only served to room members, so the image request carries the token.
              <Image key={a.id} source={{ uri: absoluteUrl(a.url), headers: authHeaders() }} style={styles.image} resizeMode="cover" />
            ) : (
              <Text key={a.id} style={styles.file}>
                📎 {a.name}
              </Text>
            ),
          )}
          {m.text !== "" && <Text style={styles.text}>{m.text}</Text>}
          {m.poll && <PollSummary poll={m.poll} />}
        </>
      )}
      <Text style={styles.meta}>
        {m.editedAt && !m.deletedAt ? "edited · " : ""}
        {time(m.createdAt)}
      </Text>
    </View>
  );
}

/** A poll's results, read-only: voting, suggestions and comments are in the web app for now. */
function PollSummary({ poll }: { poll: Poll }) {
  const mine = new Set(poll.myVotes);
  return (
    <View style={styles.poll}>
      <Text style={styles.pollQuestion}>📊 {poll.question}</Text>
      {poll.options.map((o) => {
        const percent = poll.voterCount === 0 ? 0 : Math.round((o.voteCount / poll.voterCount) * 100);
        return (
          <Text key={o.id} style={styles.text}>
            {percent}% · {o.text}
            {mine.has(o.id) ? " ✓" : ""}
          </Text>
        );
      })}
      <Text style={styles.deleted}>
        {poll.voterCount === 1 ? "1 vote" : `${poll.voterCount} votes`} · vote in the web app
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loading: { margin: 16 },
  listWrap: { flex: 1 },
  list: { padding: 12, gap: 6 },
  jump: {
    position: "absolute",
    right: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minWidth: 40,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  jumpUnseen: { backgroundColor: colors.accent, borderColor: colors.accent },
  jumpPressed: { opacity: 0.8 },
  jumpLabel: { fontSize: 13, fontWeight: "600", color: colors.text },
  jumpArrow: { fontSize: 18, lineHeight: 20, color: colors.text },
  jumpTextUnseen: { color: "#fff" },
  bubble: { maxWidth: "80%", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, gap: 4 },
  own: { alignSelf: "flex-end", backgroundColor: colors.own, borderBottomRightRadius: 4 },
  other: { alignSelf: "flex-start", backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  author: { fontSize: 13, fontWeight: "600", color: colors.text },
  text: { fontSize: 16, color: colors.text },
  deleted: { fontStyle: "italic", color: colors.muted },
  image: { width: 220, height: 160, borderRadius: 8, backgroundColor: colors.bubble },
  file: { color: colors.accent },
  meta: { alignSelf: "flex-end", fontSize: 11, color: colors.muted },
  poll: { gap: 4 },
  pollQuestion: { fontSize: 16, fontWeight: "600", color: colors.text },
  system: { alignSelf: "center", fontSize: 12, color: colors.muted, marginVertical: 4 },
  error: { color: colors.error, paddingHorizontal: 12 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    color: colors.text,
  },
  send: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: colors.accent },
  disabled: { opacity: 0.5 },
  sendText: { color: "#fff", fontWeight: "600" },
});
