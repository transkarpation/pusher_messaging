defmodule RealtimeServerWeb.RealtimeChannel do
  @moduledoc """
  Any app channel. Joining asks the API (`RealtimeServer.Backend`), and the grant says what else
  the channel does:

  - `presence`: tracks the user in `RealtimeServerWeb.Presence` and pushes the current
    `presence_state`. The join reply says `%{presence: true}` so the client knows to wait for it.
  - `roomActivity` (the user's own channel): the ids of the user's rooms. The channel listens to
    each room's activity topic (`room-activity:{id}`) and pushes what's published there, so a
    client hears about new messages in all its rooms without joining every room's channel. It
    keeps the set current from the `room:added` / `room:removed` events on the user's channel.
    The user also counts as connected (`RealtimeServerWeb.Presence.connected_topic/0`) while
    the channel is open, which the API asks before sending push notifications.
  """
  use Phoenix.Channel

  alias Phoenix.Socket.Broadcast
  alias RealtimeServer.Backend
  alias RealtimeServerWeb.Presence

  @room_added "room:added"
  @room_removed "room:removed"

  # Seen on the way out to follow the user's rooms (see `follow_rooms/3`).
  intercept [@room_added, @room_removed]

  @impl true
  def join(topic, _params, socket) do
    case Backend.authorize(socket.assigns.user_id, topic) do
      {:ok, %{"presence" => %{"id" => id, "info" => info}}} when is_binary(id) ->
        send(self(), {:track, id, info})
        {:ok, %{presence: true}, socket}

      {:ok, %{"roomActivity" => room_ids}} when is_list(room_ids) ->
        send(self(), :track_connected)
        socket = assign(socket, :activity_rooms, MapSet.new())
        {:ok, %{presence: false}, Enum.reduce(room_ids, socket, &listen_to_room/2)}

      {:ok, _grant} ->
        {:ok, %{presence: false}, socket}

      {:error, status, reason} ->
        {:error, %{status: status, reason: reason}}
    end
  end

  @impl true
  def handle_info({:track, id, info}, socket) do
    {:ok, _ref} = Presence.track(socket, id, %{info: info})
    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  def handle_info(:track_connected, socket) do
    {:ok, _ref} = Presence.track_connected(socket.assigns.user_id)

    {:noreply, socket}
  end

  # An event published with an excluded socket id (see RealtimeServer.Broadcast), on this
  # channel's topic or on a room activity topic it listens to.
  def handle_info({:publish, event, data, except}, socket) do
    socket = follow_rooms(event, data, socket)
    if socket.assigns.socket_id != except, do: push(socket, event, data)
    {:noreply, socket}
  end

  # An event published without an excluded socket id on a room activity topic. (Those on the
  # channel's own topic go straight to the client, or to handle_out/3 when intercepted.)
  def handle_info(%Broadcast{event: event, payload: payload}, socket) do
    push(socket, event, payload)
    {:noreply, socket}
  end

  @impl true
  def handle_out(event, payload, socket) do
    socket = follow_rooms(event, payload, socket)
    push(socket, event, payload)
    {:noreply, socket}
  end

  # On the user's channel, starts or stops listening to a room's activity as the user joins or
  # leaves it. `room:added` carries the room, `room:removed` its id.
  defp follow_rooms(@room_added, %{"id" => room_id}, %{assigns: %{activity_rooms: _}} = socket),
    do: listen_to_room(room_id, socket)

  defp follow_rooms(
         @room_removed,
         %{"roomId" => room_id},
         %{assigns: %{activity_rooms: rooms}} = socket
       ) do
    if MapSet.member?(rooms, room_id) do
      Phoenix.PubSub.unsubscribe(RealtimeServer.PubSub, activity_topic(room_id))
      assign(socket, :activity_rooms, MapSet.delete(rooms, room_id))
    else
      socket
    end
  end

  defp follow_rooms(_event, _payload, socket), do: socket

  defp listen_to_room(room_id, %{assigns: %{activity_rooms: rooms}} = socket)
       when is_integer(room_id) do
    if MapSet.member?(rooms, room_id) do
      socket
    else
      :ok = Phoenix.PubSub.subscribe(RealtimeServer.PubSub, activity_topic(room_id))
      assign(socket, :activity_rooms, MapSet.put(rooms, room_id))
    end
  end

  defp listen_to_room(_room_id, socket), do: socket

  # The same topic the API publishes to (`roomActivityTopic` in packages/shared).
  defp activity_topic(room_id), do: "room-activity:#{room_id}"
end
