defmodule RealtimeServerWeb.ChannelCase do
  @moduledoc false
  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest
      @endpoint RealtimeServerWeb.Endpoint

      # A connected socket for `user_id`, as UserSocket.connect/3 would assign it.
      defp socket_for(user_id, socket_id \\ "socket-#{System.unique_integer([:positive])}") do
        socket(RealtimeServerWeb.UserSocket, "user_socket:#{user_id}", %{
          user_id: user_id,
          socket_id: socket_id
        })
      end
    end
  end
end
