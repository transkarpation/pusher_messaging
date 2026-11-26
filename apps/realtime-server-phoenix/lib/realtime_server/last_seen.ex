defmodule RealtimeServer.LastSeen do
  @moduledoc """
  Tells the API when people were last connected (`RealtimeServer.Backend.seen/2`):

  - whose last connection closed (`left/1`, from `RealtimeServerWeb.Presence`), in batches
    collected for `:last_seen_flush_ms`, leaving out anyone who reconnected meanwhile;
  - every `:last_seen_touch_ms`, who is connected to this node. If the node dies without
    reporting who left, their `lastSeenAt` is then at most that old.
  """
  use GenServer
  alias RealtimeServer.Backend
  alias RealtimeServerWeb.Presence

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc "The user's last connection closed."
  def left(user_id), do: GenServer.cast(__MODULE__, {:left, user_id})

  @impl true
  def init(_opts) do
    schedule(:touch, :last_seen_touch_ms)
    {:ok, %{left: MapSet.new(), flush_scheduled?: false}}
  end

  @impl true
  def handle_cast({:left, user_id}, state) do
    unless state.flush_scheduled?, do: schedule(:flush, :last_seen_flush_ms)
    {:noreply, %{state | left: MapSet.put(state.left, user_id), flush_scheduled?: true}}
  end

  @impl true
  def handle_info(:flush, state) do
    online = MapSet.new(Presence.online_among(MapSet.to_list(state.left)))

    case state.left |> MapSet.difference(online) |> MapSet.to_list() do
      [] -> :ok
      left -> report([], left)
    end

    {:noreply, %{state | left: MapSet.new(), flush_scheduled?: false}}
  end

  def handle_info(:touch, state) do
    schedule(:touch, :last_seen_touch_ms)

    case Presence.connected_here() do
      [] -> :ok
      online -> report(online, [])
    end

    {:noreply, state}
  end

  # In a task, so a slow API doesn't hold up the next batch.
  defp report(online, left), do: Task.start(fn -> Backend.seen(online, left) end)

  defp schedule(message, setting),
    do: Process.send_after(self(), message, Application.fetch_env!(:realtime_server, setting))
end
