defmodule RealtimeServerWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :realtime_server

  # Clients connect to /socket/websocket (phoenix.js appends the transport).
  socket "/socket", RealtimeServerWeb.UserSocket,
    websocket: [timeout: 45_000],
    longpoll: false

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:json],
    pass: ["application/json"],
    json_decoder: Jason,
    length: 1_000_000

  plug RealtimeServerWeb.Router
end
