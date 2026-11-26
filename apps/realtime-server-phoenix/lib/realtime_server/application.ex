defmodule RealtimeServer.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      {Phoenix.PubSub, name: RealtimeServer.PubSub},
      RealtimeServerWeb.Presence,
      RealtimeServer.LastSeen,
      RealtimeServerWeb.Endpoint
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: RealtimeServer.Supervisor)
  end

  @impl true
  def config_change(changed, _new, removed) do
    RealtimeServerWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
