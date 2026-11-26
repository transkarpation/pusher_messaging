defmodule RealtimeServerWeb.PresenceControllerTest do
  use RealtimeServerWeb.ChannelCase
  import Plug.Conn
  import Phoenix.ConnTest
  alias RealtimeServerWeb.RealtimeChannel

  defp post_online(body, secret \\ "test-secret") do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> secret)
    |> put_req_header("content-type", "application/json")
    |> post("/api/presence/online", Jason.encode!(body))
  end

  test "rejects requests without the shared secret" do
    assert post_online(%{userIds: [1]}, "wrong").status == 401
  end

  test "validates the body" do
    assert post_online(%{userIds: "1"}).status == 400
  end

  test "a user is online while their own channel is open" do
    assert online([1, 2]) == []

    {:ok, _, socket} = subscribe_and_join(socket_for(1), RealtimeChannel, "private-user-1")
    # A room channel alone doesn't count.
    {:ok, _, _} = subscribe_and_join(socket_for(2), RealtimeChannel, "private-room-1")
    assert eventually(fn -> online([1, 2]) end, [1]) == [1]

    Process.unlink(socket.channel_pid)
    ref = leave(socket)
    assert_reply ref, :ok
    assert eventually(fn -> online([1, 2]) end, []) == []
  end

  defp online(ids), do: post_online(%{userIds: ids}) |> json_response(200) |> Map.fetch!("online")

  # Presence is tracked right after the join and untracked once the channel process is gone.
  defp eventually(fun, expected, tries \\ 20) do
    case fun.() do
      ^expected -> expected
      other when tries == 0 -> other
      _ -> Process.sleep(25) && eventually(fun, expected, tries - 1)
    end
  end
end
