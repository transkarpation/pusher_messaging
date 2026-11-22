defmodule RealtimeServer.Backend.Http do
  @moduledoc "Asks the Node API: `POST {API_URL}/api/realtime/phoenix/authorize` with the shared secret."
  @behaviour RealtimeServer.Backend
  require Logger

  @impl true
  def authorize(user_id, channel) do
    api_url = Application.fetch_env!(:realtime_server, :api_url)
    secret = Application.fetch_env!(:realtime_server, :shared_secret)

    case Req.post("#{api_url}/api/realtime/phoenix/authorize",
           json: %{userId: user_id, channel: channel},
           auth: {:bearer, secret},
           retry: false,
           receive_timeout: 5_000
         ) do
      {:ok, %Req.Response{status: 200, body: grant}} when is_map(grant) ->
        {:ok, grant}

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, status, error_message(body)}

      {:error, exception} ->
        Logger.warning("Authorizing #{channel} failed: #{Exception.message(exception)}")
        {:error, 503, "Authorization unavailable"}
    end
  end

  defp error_message(%{"error" => message}) when is_binary(message), do: message
  defp error_message(_body), do: "Forbidden"
end
