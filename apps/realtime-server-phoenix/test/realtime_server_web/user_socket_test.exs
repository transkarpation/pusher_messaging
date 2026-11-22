defmodule RealtimeServerWeb.UserSocketTest do
  use RealtimeServerWeb.ChannelCase, async: true
  alias RealtimeServer.Token
  alias RealtimeServerWeb.UserSocket

  defp token(user_id, ttl \\ 60),
    do: Token.sign(user_id, System.system_time(:second) + ttl, "test-secret")

  test "connects with a valid token and socket id" do
    assert {:ok, socket} =
             connect(UserSocket, %{"token" => token(5), "socket_id" => "abcdefgh12"})

    assert socket.assigns.user_id == 5
    assert socket.assigns.socket_id == "abcdefgh12"
  end

  test "refuses a bad or expired token, a bad socket id, and missing params" do
    assert {:error, :unauthorized} =
             connect(UserSocket, %{"token" => "nope", "socket_id" => "abcdefgh12"})

    assert {:error, :unauthorized} =
             connect(UserSocket, %{"token" => token(5, -1), "socket_id" => "abcdefgh12"})

    assert {:error, :unauthorized} =
             connect(UserSocket, %{"token" => token(5), "socket_id" => "bad id!"})

    assert {:error, :unauthorized} = connect(UserSocket, %{"token" => token(5)})
  end
end
