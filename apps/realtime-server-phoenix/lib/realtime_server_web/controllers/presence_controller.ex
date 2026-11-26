defmodule RealtimeServerWeb.PresenceController do
  use Phoenix.Controller, formats: [:json]

  @doc """
  `POST /api/presence/online` from the API: `{"userIds": [1, 2, 3]}` answers `{"online": [1, 3]}`,
  the users among them with an open connection.
  """
  def online(conn, %{"userIds" => user_ids}) when is_list(user_ids) do
    ids = Enum.filter(user_ids, &is_integer/1)
    json(conn, %{online: RealtimeServerWeb.Presence.online_among(ids)})
  end

  def online(conn, _params) do
    conn |> Plug.Conn.put_status(400) |> json(%{error: "userIds must be a list"})
  end
end
