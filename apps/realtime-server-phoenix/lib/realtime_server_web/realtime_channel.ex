defmodule RealtimeServerWeb.RealtimeChannel do
  @moduledoc """
  Any app channel. Joining asks the API (`RealtimeServer.Backend`); a presence grant also
  tracks the user in `RealtimeServerWeb.Presence` and pushes the current `presence_state`.
  The join reply says `%{presence: true}` so the client knows to wait for that state.
  """
  use Phoenix.Channel

  alias RealtimeServer.Backend
  alias RealtimeServerWeb.Presence

  @impl true
  def join(topic, _params, socket) do
    case Backend.authorize(socket.assigns.user_id, topic) do
      {:ok, %{"presence" => %{"id" => id, "info" => info}}} when is_binary(id) ->
        send(self(), {:track, id, info})
        {:ok, %{presence: true}, socket}

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

  # An event published with an excluded socket id (see RealtimeServer.Broadcast).
  def handle_info({:publish, event, data, except}, socket) do
    if socket.assigns.socket_id != except, do: push(socket, event, data)
    {:noreply, socket}
  end
end
