defmodule RealtimeServer.BackendStub do
  @moduledoc "Test stand-in for the Node API: the same rules as RealtimeService, room 1 only."
  @behaviour RealtimeServer.Backend

  @impl true
  def authorize(user_id, "presence-online") do
    {:ok, %{"presence" => %{"id" => "#{user_id}", "info" => %{"username" => "user#{user_id}"}}}}
  end

  def authorize(user_id, "private-user-" <> id) do
    # Everyone is in room 1 only.
    if id == "#{user_id}",
      do: {:ok, %{"roomActivity" => [1]}},
      else: {:error, 403, "Forbidden channel"}
  end

  def authorize(_user_id, "private-room-1"), do: {:ok, %{}}
  def authorize(_user_id, _channel), do: {:error, 403, "Forbidden channel"}

  # Sent to the test process that asked for it with `Application.put_env(:realtime_server, :seen_listener, self())`.
  @impl true
  def seen(online, left) do
    if pid = Application.get_env(:realtime_server, :seen_listener),
      do: send(pid, {:seen, online, left})

    :ok
  end
end
