defmodule RealtimeServerWeb.UserSocket do
  @moduledoc """
  A client connection. Connect params:

  - `token`: from the API's `GET /api/realtime/phoenix/token` (see `RealtimeServer.Token`)
  - `socket_id`: picked by the client for each connection. The client sends it to the API
    as `X-Socket-Id`, and events its own requests cause skip this connection.

  Channel names are the app's own (`presence-online`, `private-user-{id}`, `private-room-{id}`);
  every topic goes to `RealtimeChannel`, which asks the API whether the user may join.
  """
  use Phoenix.Socket

  channel "*", RealtimeServerWeb.RealtimeChannel

  @socket_id ~r/\A[A-Za-z0-9_-]{8,64}\z/

  @impl true
  def connect(%{"token" => token, "socket_id" => socket_id}, socket, _connect_info)
      when is_binary(socket_id) do
    secret = Application.fetch_env!(:realtime_server, :shared_secret)

    with true <- Regex.match?(@socket_id, socket_id),
         {:ok, user_id} <- RealtimeServer.Token.verify(token, secret) do
      {:ok, assign(socket, user_id: user_id, socket_id: socket_id)}
    else
      _ -> {:error, :unauthorized}
    end
  end

  def connect(_params, _socket, _connect_info), do: {:error, :unauthorized}

  # Lets the server drop all of a user's connections:
  # RealtimeServerWeb.Endpoint.broadcast("user_socket:42", "disconnect", %{})
  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.user_id}"
end
