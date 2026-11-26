defmodule RealtimeServerWeb.Presence do
  @moduledoc """
  Who is on a presence channel: keyed by user id, one meta (`%{info: ...}`) per connection.

  Also who is connected at all: every client keeps its user's own channel open, and that channel
  tracks the user on `connected_topic/0` (an internal topic no client joins), with the node the
  connection is on (`%{node: node()}`). When a user's last connection on this node closes and
  they have none left anywhere, `RealtimeServer.LastSeen` is told.
  """
  use Phoenix.Presence,
    otp_app: :realtime_server,
    pubsub_server: RealtimeServer.PubSub

  @connected_topic "internal:connected-users"

  def connected_topic, do: @connected_topic

  @doc "Tracks the calling channel process's user as connected."
  def track_connected(user_id),
    do: track(self(), @connected_topic, to_string(user_id), %{node: node()})

  @doc "Which of `user_ids` have at least one open connection."
  def online_among(user_ids) do
    connected = list(@connected_topic)
    Enum.filter(user_ids, &Map.has_key?(connected, to_string(&1)))
  end

  @doc "Ids of the users with a connection on this node."
  def connected_here do
    for {id, %{metas: metas}} <- list(@connected_topic), Enum.any?(metas, &local?/1) do
      String.to_integer(id)
    end
  end

  @impl true
  def init(_opts), do: {:ok, %{}}

  # Every node sees every diff; only the node the connection was on reports the leave.
  @impl true
  def handle_metas(@connected_topic, %{leaves: leaves}, presences, state) do
    for {id, %{metas: metas}} <- leaves,
        Enum.any?(metas, &local?/1),
        Map.get(presences, id, []) == [] do
      RealtimeServer.LastSeen.left(String.to_integer(id))
    end

    {:ok, state}
  end

  def handle_metas(_topic, _diff, _presences, state), do: {:ok, state}

  defp local?(meta), do: Map.get(meta, :node) == node()
end
