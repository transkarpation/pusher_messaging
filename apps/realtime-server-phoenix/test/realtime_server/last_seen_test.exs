defmodule RealtimeServer.LastSeenTest do
  use RealtimeServerWeb.ChannelCase
  alias RealtimeServerWeb.RealtimeChannel

  setup do
    Application.put_env(:realtime_server, :seen_listener, self())
    on_exit(fn -> Application.delete_env(:realtime_server, :seen_listener) end)
  end

  defp join_own_channel(user_id) do
    {:ok, _, socket} =
      subscribe_and_join(socket_for(user_id), RealtimeChannel, "private-user-#{user_id}")

    Process.unlink(socket.channel_pid)
    socket
  end

  defp leave_channel(socket) do
    ref = leave(socket)
    assert_reply ref, :ok
  end

  test "reports a user once their last connection closes" do
    first = join_own_channel(41)
    second = join_own_channel(41)

    leave_channel(first)
    refute_receive {:seen, _, [41]}, 100

    leave_channel(second)
    assert_receive {:seen, [], [41]}, 500
  end

  test "leaves out a user who reconnected before the report" do
    socket = join_own_channel(42)
    leave_channel(socket)
    join_own_channel(42)
    refute_receive {:seen, _, [42]}, 100
  end

  test "reports who is connected on :touch" do
    join_own_channel(43)
    # Presence is tracked right after the join.
    Process.sleep(50)
    send(RealtimeServer.LastSeen, :touch)
    assert_receive {:seen, online, []}, 500
    assert 43 in online
  end
end
