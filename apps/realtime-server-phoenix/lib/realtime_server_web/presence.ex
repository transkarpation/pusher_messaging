defmodule RealtimeServerWeb.Presence do
  @moduledoc "Who is on a presence channel: keyed by user id, one meta (`%{info: ...}`) per connection."
  use Phoenix.Presence,
    otp_app: :realtime_server,
    pubsub_server: RealtimeServer.PubSub
end
