defmodule RealtimeServerWeb.BroadcastControllerTest do
  use RealtimeServerWeb.ChannelCase
  import Plug.Conn
  import Phoenix.ConnTest
  alias RealtimeServerWeb.RealtimeChannel

  defp post_broadcast(body, secret \\ "test-secret") do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> secret)
    |> put_req_header("content-type", "application/json")
    |> post("/api/broadcast", Jason.encode!(body))
  end

  test "rejects requests without the shared secret" do
    assert post_broadcast(%{channel: "c", event: "e", data: %{}}, "wrong").status == 401
    assert build_conn() |> post("/api/broadcast", %{}) |> Map.fetch!(:status) == 401
  end

  test "validates the body" do
    assert post_broadcast(%{channel: "c", event: "e", data: [1]}).status == 400
    assert post_broadcast(%{channel: "c", event: "phx_reply", data: %{}}).status == 400
  end

  test "delivers the event to the channel" do
    {:ok, _, _} =
      subscribe_and_join(socket_for(1, "socket-aaaaaaaa"), RealtimeChannel, "private-room-1")

    assert post_broadcast(%{channel: "private-room-1", event: "room:members", data: %{roomId: 1}}).status ==
             204

    assert_push "room:members", %{"roomId" => 1}

    assert post_broadcast(%{
             channel: "private-room-1",
             event: "room:members",
             data: %{roomId: 2},
             exceptSocketId: "socket-aaaaaaaa"
           }).status == 204

    refute_push "room:members", %{"roomId" => 2}
  end

  test "health" do
    assert build_conn() |> get("/api/health") |> json_response(200) == %{"ok" => true}
  end
end
