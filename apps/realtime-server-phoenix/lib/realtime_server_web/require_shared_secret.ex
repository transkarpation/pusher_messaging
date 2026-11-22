defmodule RealtimeServerWeb.RequireSharedSecret do
  @moduledoc "Lets a request through only with `Authorization: Bearer <PHOENIX_SHARED_SECRET>`."
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    secret = Application.fetch_env!(:realtime_server, :shared_secret)

    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] ->
        if Plug.Crypto.secure_compare(token, secret), do: conn, else: deny(conn)

      _ ->
        deny(conn)
    end
  end

  defp deny(conn) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(401, ~s({"error":"Unauthorized"}))
    |> halt()
  end
end
