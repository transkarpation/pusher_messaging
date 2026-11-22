import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
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
import {
  MESSAGE_CREATED_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_UPDATED_EVENT,
  POLL_UPDATED_EVENT,
  POLL_VOTED_EVENT,
  RECEIPT_UPDATED_EVENT,
  ROOM_MEMBERS_EVENT,
  deliveryOf,
  isInlineImage,
  isSystemMessage,
  mergeReceipt,
  roomChannel,
  userChannel,
  type Message,
  type MessageDelivery,
  type Poll,
  type PollUpdatedEvent,
  type PollVotedEvent,
  type Receipt,
  type RoomMembersEvent,
} from "@pm/shared";
import { CreatePollModal } from "../../components/CreatePollModal";
import { PollCard } from "../../components/PollCard";
import { absoluteUrl, api, authHeaders } from "../../lib/api";
import { displayName, time } from "../../lib/format";
import { getRealtime, listen } from "../../lib/realtime";
import { useSession } from "../../lib/session";
import { colors } from "../../lib/theme";

/** Merges by id, newest first (the list is inverted, so index 0 is at the bottom). */
const merge = (a: Message[], b: Message[]) => {
  const byId = new Map(a.map((m) => [m.id, m]));
  for (const m of b) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => y.id - x.id);
};

/** Adds receipts to a room's receipts by user id. */
const mergeReceipts = (prev: Record<number, Receipt>, next: Receipt[]) => {
  const out = { ...prev };
  for (const r of next) out[r.userId] = mergeReceipt(out[r.userId], r);
  return out;
};

/** True while the app is in the foreground, i.e. the open room is actually on screen. */
function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

/** Within this distance (px) of the bottom the list counts as scrolled to the newest message. */
const NEAR_BOTTOM_THRESHOLD = 80;

export default function RoomScreen() {
  const { id, name, owner } = useLocalSearchParams<{ id: string; name?: string; owner?: string }>();
  const roomId = Number(id);
  const me = useSession((s) => s.user)!;
  /** Only the room owner posts polls; passed by the room list, then kept current by `room:members`. */
  const [isOwner, setIsOwner] = useState(owner === "1");
  const [creatingPoll, setCreatingPoll] = useState(false);
  const headerHeight = useHeaderHeight();
  const [messages, setMessages] = useState<Message[]>([]);
  /** Delivered/read watermarks in this room by user id: the ✓ / ✓✓ on my messages. */
  const [receipts, setReceipts] = useState<Record<number, Receipt>>({});
  const appActive = useAppActive();
  /** Highest message id already reported as read from this screen. */
  const reportedRead = useRef(0);
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
        setReceipts((prev) => mergeReceipts(prev, page.receipts));
        setHasMore(page.hasMore);
        setLoaded(true);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Reports the newest message as read while the room is on screen (which also counts it as delivered).
  const latestId = messages[0]?.id ?? 0;
  useEffect(() => {
    if (!loaded || !appActive || latestId <= reportedRead.current) return;
    const previous = reportedRead.current;
    reportedRead.current = latestId;
    api
      .updateReceipt(roomId, { readUpTo: latestId })
      .then((r) => setReceipts((prev) => mergeReceipts(prev, [r])))
      .catch((e) => {
        reportedRead.current = previous; // retried when the next message arrives or the app comes back
        console.warn("Failed to report read:", e);
      });
  }, [roomId, loaded, appActive, latestId]);

  /** Replaces the poll of a loaded message with `fn(poll)`. */
  const patchPoll = useCallback(
    (messageId: number, fn: (poll: Poll) => Poll) =>
      setMessages((prev) => prev.map((m) => (m.id === messageId && m.poll ? { ...m, poll: fn(m.poll) } : m))),
    [],
  );

  /** A poll returned to my own request: the newer copy wins, but my votes in it are always current. */
  const applyOwnPoll = useCallback(
    (messageId: number, poll: Poll) => patchPoll(messageId, (p) => (poll.version >= p.version ? poll : { ...p, myVotes: poll.myVotes })),
    [patchPoll],
  );

  // New, edited and deleted messages from others, poll results and receipts, live.
  useEffect(() => {
    const apply = (m: Message) => setMessages((prev) => merge(prev, [m]));
    let stop: (() => void) | null = null;
    let stopUser: (() => void) | null = null;
    let stopped = false;
    getRealtime()
      .then((conn) => {
        if (stopped) return;
        stop = listen(conn, roomChannel(roomId), {
          [MESSAGE_CREATED_EVENT]: (m: Message) => {
            apply(m);
            if (m.author.id !== me.id && !atBottomRef.current) setUnseen((n) => n + 1);
          },
          [MESSAGE_UPDATED_EVENT]: apply,
          [MESSAGE_DELETED_EVENT]: apply,
          [RECEIPT_UPDATED_EVENT]: (r: Receipt) => setReceipts((prev) => mergeReceipts(prev, [r])),
          // Everyone's view of a poll; my own votes stay as they are (they come with POLL_VOTED_EVENT).
          [POLL_UPDATED_EVENT]: (e: PollUpdatedEvent) =>
            patchPoll(e.messageId, (p) => (e.poll.version < p.version ? p : { ...e.poll, myVotes: p.myVotes })),
          [ROOM_MEMBERS_EVENT]: (e: RoomMembersEvent) =>
            setIsOwner(e.members.some((m) => m.user.id === me.id && m.role === "owner")),
        });
        // My vote changed on another device.
        stopUser = listen(conn, userChannel(me.id), {
          [POLL_VOTED_EVENT]: (e: PollVotedEvent) => e.roomId === roomId && patchPoll(e.messageId, (p) => ({ ...p, myVotes: e.myVotes })),
        });
      })
      .catch((e) => console.warn("Realtime is unavailable:", e));
    return () => {
      stopped = true;
      stop?.();
      stopUser?.();
    };
  }, [roomId, me.id, patchPoll]);

  const scrollToLatest = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });

  const loadOlder = async () => {
    const oldest = messages.at(-1)?.id;
    if (!hasMore || loadingOlder || oldest === undefined) return;
    setLoadingOlder(true);
    try {
      const page = await api.getMessages(roomId, oldest);
      setMessages((prev) => merge(prev, page.messages));
      setReceipts((prev) => mergeReceipts(prev, page.receipts));
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
            renderItem={({ item }) => (
              <MessageItem
                message={item}
                meId={me.id}
                delivery={item.author.id === me.id ? deliveryOf(item, receipts) : undefined}
                onPoll={applyOwnPoll}
              />
            )}
            extraData={receipts}
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
        {isOwner && (
          <Pressable
            style={({ pressed }) => [styles.pollButton, pressed && styles.jumpPressed]}
            onPress={() => setCreatingPoll(true)}
            accessibilityRole="button"
            accessibilityLabel="Create a poll"
            hitSlop={6}
          >
            <Text style={styles.pollButtonText}>📊</Text>
          </Pressable>
        )}
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
      <CreatePollModal
        roomId={roomId}
        visible={creatingPoll}
        onClose={() => setCreatingPoll(false)}
        onCreated={(message) => {
          setMessages((prev) => merge(prev, [message]));
          scrollToLatest();
        }}
      />
    </KeyboardAvoidingView>
  );
}

function MessageItem({
  message: m,
  meId,
  delivery,
  onPoll,
}: {
  message: Message;
  meId: number;
  delivery?: MessageDelivery;
  onPoll: (messageId: number, poll: Poll) => void;
}) {
  const own = m.author.id === meId;
  if (isSystemMessage(m)) {
    const who = own ? "You" : displayName(m.author);
    return <Text style={styles.system}>{m.kind === "member_joined" ? `${who} joined the room` : `${who} left the room`}</Text>;
  }
  return (
    <View style={[styles.bubble, own ? styles.own : styles.other, m.poll && !m.deletedAt && styles.pollBubble]}>
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
          {m.poll && <PollCard message={m} meId={meId} onPoll={(poll) => onPoll(m.id, poll)} />}
        </>
      )}
      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {m.editedAt && !m.deletedAt ? "edited · " : ""}
          {time(m.createdAt)}
        </Text>
        {delivery && !m.deletedAt && <DeliveryStatus delivery={delivery} />}
      </View>
    </View>
  );
}

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/** ✓ saved on the server, grey ✓✓ delivered to someone's device, blue ✓✓ read by someone (as on the web). */
function DeliveryStatus({ delivery: d }: { delivery: MessageDelivery }) {
  const label =
    d.status === "read"
      ? `Read by ${people(d.readCount)}, delivered to ${people(d.deliveredCount)}`
      : d.status === "delivered"
        ? `Delivered to ${people(d.deliveredCount)}`
        : "Sent";
  return (
    <Text style={[styles.status, d.status === "read" && styles.statusRead]} accessibilityLabel={label}>
      {d.status === "sent" ? "✓" : "✓✓"}
    </Text>
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
  metaRow: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", gap: 4 },
  meta: { fontSize: 11, color: colors.muted },
  status: { fontSize: 12, color: colors.muted, letterSpacing: -2, paddingRight: 2 },
  statusRead: { color: colors.accent },
  pollBubble: { width: "85%", maxWidth: 420 },
  pollButton: { width: 36, height: 38, alignItems: "center", justifyContent: "center" },
  pollButtonText: { fontSize: 20 },
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
