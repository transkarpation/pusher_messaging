defmodule RealtimeServer.Backend.Http do
  @moduledoc """
  Calls the Node API with the shared secret: `POST {API_URL}/api/realtime/phoenix/authorize`
  and `POST {API_URL}/api/realtime/phoenix/seen`.
  """
  @behaviour RealtimeServer.Backend
  require Logger

  @impl true
  def authorize(user_id, channel) do
    case post("/api/realtime/phoenix/authorize", %{userId: user_id, channel: channel}) do
      {:ok, %Req.Response{status: 200, body: grant}} when is_map(grant) ->
        {:ok, grant}

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, status, error_message(body)}

      {:error, exception} ->
        Logger.warning("Authorizing #{channel} failed: #{Exception.message(exception)}")
        {:error, 503, "Authorization unavailable"}
    end
  end

  @impl true
  def seen(online, left) do
    case post("/api/realtime/phoenix/seen", %{online: online, left: left}) do
      {:ok, %Req.Response{status: 204}} ->
        :ok

      {:ok, %Req.Response{status: status}} ->
        Logger.warning("Reporting last seen failed: HTTP #{status}")

      {:error, exception} ->
        Logger.warning("Reporting last seen failed: #{Exception.message(exception)}")
    end

    :ok
  end

  defp post(path, body) do
    api_url = Application.fetch_env!(:realtime_server, :api_url)
    secret = Application.fetch_env!(:realtime_server, :shared_secret)

    Req.post("#{api_url}#{path}",
      json: body,
      auth: {:bearer, secret},
      retry: false,
      receive_timeout: 5_000
    )
  end

  defp error_message(%{"error" => message}) when is_binary(message), do: message
  defp error_message(_body), do: "Forbidden"
end
