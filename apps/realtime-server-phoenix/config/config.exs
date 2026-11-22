import Config

config :realtime_server, RealtimeServerWeb.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  url: [host: "localhost"],
  render_errors: [formats: [json: RealtimeServerWeb.ErrorJSON], layout: false],
  pubsub_server: RealtimeServer.PubSub

# Who decides channel access: the Node API over HTTP (stubbed in tests).
config :realtime_server, :backend, RealtimeServer.Backend.Http

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
