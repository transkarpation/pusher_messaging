import Config

config :realtime_server, RealtimeServerWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  server: false

config :realtime_server,
  shared_secret: "test-secret",
  api_url: "http://api.invalid",
  backend: RealtimeServer.BackendStub,
  last_seen_flush_ms: 10,
  # Tests send :touch themselves.
  last_seen_touch_ms: 3_600_000

config :logger, level: :warning
