import Config

# Settings from the environment (also inside a release). See README.md.
if config_env() != :test do
  shared_secret =
    System.get_env("PHOENIX_SHARED_SECRET") ||
      raise """
      PHOENIX_SHARED_SECRET is not set. Use the same value as PHOENIX_SHARED_SECRET in apps/server/.env.
      """

  config :realtime_server,
    shared_secret: shared_secret,
    # Where the Node API runs; asked whether a user may join a channel.
    api_url: String.trim_trailing(System.get_env("API_URL", "http://localhost:3000"), "/")

  # Clients authenticate with a token in the connect params, not a cookie, so accepting
  # any origin is safe. CHECK_ORIGIN (comma-separated origins) narrows it down anyway.
  check_origin =
    case System.get_env("CHECK_ORIGIN", "") do
      "" -> false
      list -> String.split(list, ",", trim: true)
    end

  config :realtime_server, RealtimeServerWeb.Endpoint,
    http: [ip: {0, 0, 0, 0, 0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT", "4000"))],
    check_origin: check_origin,
    server: true
end
