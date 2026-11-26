defmodule RealtimeServer.Backend do
  @moduledoc """
  Channel access is decided by the Node API, the only place that knows room membership.
  A grant is the JSON `RealtimeService.authorize` returns: `%{}` for room channels,
  `%{"roomActivity" => [room_id, ...]}` for the user's own channel, and
  `%{"presence" => %{"id" => "42", "info" => %{...}}}` for the presence channel.

  The API also keeps when people were last connected: `seen/2` reports who is connected
  (`online`) and whose last connection just closed (`left`).
  """

  @callback authorize(user_id :: pos_integer, channel :: String.t()) ::
              {:ok, map} | {:error, status :: integer, reason :: String.t()}

  @callback seen(online :: [pos_integer], left :: [pos_integer]) :: :ok

  def authorize(user_id, channel), do: impl().authorize(user_id, channel)
  def seen(online, left), do: impl().seen(online, left)

  defp impl, do: Application.fetch_env!(:realtime_server, :backend)
end
