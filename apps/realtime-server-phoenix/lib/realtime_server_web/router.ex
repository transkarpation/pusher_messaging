defmodule RealtimeServerWeb.Router do
  use Phoenix.Router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :internal do
    plug RealtimeServerWeb.RequireSharedSecret
  end

  scope "/api", RealtimeServerWeb do
    pipe_through :api

    get "/health", HealthController, :show

    # Called by the Node API only.
    scope "/" do
      pipe_through :internal
      post "/broadcast", BroadcastController, :create
      post "/presence/online", PresenceController, :online
    end
  end
end
