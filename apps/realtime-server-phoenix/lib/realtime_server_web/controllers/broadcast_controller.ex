defmodule RealtimeServerWeb.BroadcastController do
  use Phoenix.Controller, formats: [:json]

  @doc """
  `POST /api/broadcast` from the API:
  `{"channel": "private-room-1", "event": "message:created", "data": {...}, "exceptSocketId": "..."}`.
  """
  def create(conn, %{"channel" => channel, "event" => event, "data" => data} = params)
      when is_binary(channel) and is_binary(event) and is_map(data) do
    if String.starts_with?(event, ["phx_", "presence_"]) do
      bad_request(conn, "event names starting with phx_ or presence_ are reserved")
    else
      except = if is_binary(params["exceptSocketId"]), do: params["exceptSocketId"]
      RealtimeServer.Broadcast.publish(channel, event, data, except)
      Plug.Conn.send_resp(conn, 204, "")
    end
  end

  def create(conn, _params),
    do: bad_request(conn, "channel, event and an object data are required")

  defp bad_request(conn, message) do
    conn |> Plug.Conn.put_status(400) |> json(%{error: message})
  end
end
