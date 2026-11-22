defmodule RealtimeServerWeb.RealtimeChannelTest do
  use RealtimeServerWeb.ChannelCase
  alias RealtimeServerWeb.RealtimeChannel

  test "joins a channel the API allows" do
    assert {:ok, %{presence: false}, _socket} =
             subscribe_and_join(socket_for(1), RealtimeChannel, "private-room-1")

    assert {:ok, %{presence: false}, _socket} =
             subscribe_and_join(socket_for(1), RealtimeChannel, "private-user-1")
  end

  test "refuses a channel the API forbids, with its status and reason" do
    assert {:error, %{status: 403, reason: "Forbidden channel"}} =
             subscribe_and_join(socket_for(1), RealtimeChannel, "private-user-2")

    assert {:error, %{status: 403}} =
             subscribe_and_join(socket_for(1), RealtimeChannel, "private-room-2")
  end

  test "presence: tracks the user and pushes the current state" do
    assert {:ok, %{presence: true}, _socket} =
             subscribe_and_join(socket_for(3), RealtimeChannel, "presence-online")

    assert_push "presence_state", %{"3" => %{metas: [%{info: %{"username" => "user3"}}]}}
  end

  test "publishing reaches subscribers, except the excluded socket" do
    {:ok, _, _} =
      subscribe_and_join(socket_for(1, "socket-aaaaaaaa"), RealtimeChannel, "private-room-1")

    RealtimeServer.Broadcast.publish("private-room-1", "message:created", %{"id" => 1}, nil)
    assert_push "message:created", %{"id" => 1}

    RealtimeServer.Broadcast.publish(
      "private-room-1",
      "message:created",
      %{"id" => 2},
      "socket-bbbbbbbb"
    )

    assert_push "message:created", %{"id" => 2}

    RealtimeServer.Broadcast.publish(
      "private-room-1",
      "message:created",
      %{"id" => 3},
      "socket-aaaaaaaa"
    )

    refute_push "message:created", %{"id" => 3}
  end
end
