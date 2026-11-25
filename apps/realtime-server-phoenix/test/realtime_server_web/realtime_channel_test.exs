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

  describe "room activity on the user channel" do
    test "forwards the activity of the user's rooms, except to the excluded socket" do
      {:ok, _, _} =
        subscribe_and_join(socket_for(1, "socket-aaaaaaaa"), RealtimeChannel, "private-user-1")

      RealtimeServer.Broadcast.publish("room-activity:1", "room:activity", %{"roomId" => 1}, nil)
      assert_push "room:activity", %{"roomId" => 1}

      RealtimeServer.Broadcast.publish(
        "room-activity:1",
        "room:activity",
        %{"roomId" => 1, "n" => 2},
        "socket-aaaaaaaa"
      )

      refute_push "room:activity", %{"n" => 2}

      RealtimeServer.Broadcast.publish("room-activity:2", "room:activity", %{"roomId" => 2}, nil)
      refute_push "room:activity", %{"roomId" => 2}
    end

    test "follows rooms the user is added to and removed from" do
      {:ok, _, _} = subscribe_and_join(socket_for(1), RealtimeChannel, "private-user-1")

      RealtimeServer.Broadcast.publish("private-user-1", "room:added", %{"id" => 2}, nil)
      assert_push "room:added", %{"id" => 2}

      RealtimeServer.Broadcast.publish("room-activity:2", "room:activity", %{"roomId" => 2}, nil)
      assert_push "room:activity", %{"roomId" => 2}

      RealtimeServer.Broadcast.publish("private-user-1", "room:removed", %{"roomId" => 2}, nil)
      assert_push "room:removed", %{"roomId" => 2}

      RealtimeServer.Broadcast.publish("room-activity:2", "room:activity", %{"roomId" => 2}, nil)
      refute_push "room:activity", %{"roomId" => 2}
    end

    test "adding a room twice forwards its activity once" do
      {:ok, _, _} = subscribe_and_join(socket_for(1), RealtimeChannel, "private-user-1")

      RealtimeServer.Broadcast.publish("private-user-1", "room:added", %{"id" => 1}, nil)
      assert_push "room:added", %{"id" => 1}

      RealtimeServer.Broadcast.publish("room-activity:1", "room:activity", %{"roomId" => 1}, nil)
      assert_push "room:activity", %{"roomId" => 1}
      refute_push "room:activity", %{"roomId" => 1}
    end

    test "room channels don't forward room activity" do
      {:ok, _, _} = subscribe_and_join(socket_for(1), RealtimeChannel, "private-room-1")

      RealtimeServer.Broadcast.publish("room-activity:1", "room:activity", %{"roomId" => 1}, nil)
      refute_push "room:activity", %{"roomId" => 1}
    end
  end
end
