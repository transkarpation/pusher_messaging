defmodule RealtimeServer.Backend do
  @moduledoc """
  Channel access is decided by the Node API, the only place that knows room membership.
  A grant is the JSON `RealtimeService.authorize` returns: `%{}` for private channels,
  `%{"presence" => %{"id" => "42", "info" => %{...}}}` for the presence channel.
  """

  @callback authorize(user_id :: pos_integer, channel :: String.t()) ::
              {:ok, map} | {:error, status :: integer, reason :: String.t()}

  def authorize(user_id, channel), do: impl().authorize(user_id, channel)

  defp impl, do: Application.fetch_env!(:realtime_server, :backend)
end
