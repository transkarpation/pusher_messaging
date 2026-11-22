import Config

config :realtime_server, RealtimeServerWeb.Endpoint, debug_errors: true

config :logger, :console, format: "[$level] $message\n"
config :phoenix, :stacktrace_depth, 20
