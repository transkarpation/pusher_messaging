import Config

config :realtime_server, RealtimeServerWeb.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  url: [host: "localhost"],
  render_errors: [formats: [json: RealtimeServerWeb.ErrorJSON], layout: false],
  pubsub_server: RealtimeServer.PubSub

# Who decides channel access: the Node API over HTTP (stubbed in tests).
config :realtime_server, :backend, RealtimeServer.Backend.Http

# Last seen (RealtimeServer.LastSeen): leaves are reported in batches collected for a second;
# who is connected, once a minute.
config :realtime_server, last_seen_flush_ms: 1_000, last_seen_touch_ms: 60_000

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
