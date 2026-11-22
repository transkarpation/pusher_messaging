defmodule RealtimeServer.Broadcast do
  @moduledoc "Delivers an event published by the API to everyone joined to its channel."

  alias RealtimeServerWeb.Endpoint

  @doc """
  Without `except`, Phoenix's broadcast (the payload is encoded once for all subscribers).
  With it, each channel process gets the event and skips pushing it when its socket id is
  `except`: the connection whose request caused the event already has the result.
  """
  def publish(channel, event, data, nil), do: Endpoint.broadcast(channel, event, data)

  def publish(channel, event, data, except),
    do: Phoenix.PubSub.broadcast(RealtimeServer.PubSub, channel, {:publish, event, data, except})
end
