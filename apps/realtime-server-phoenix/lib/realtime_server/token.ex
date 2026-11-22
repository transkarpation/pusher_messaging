defmodule RealtimeServer.Token do
  @moduledoc """
  Connection tokens issued by the Node API (`GET /api/realtime/phoenix/token`) and checked
  here without calling back: `<payload>.<signature>`, where the payload is base64url JSON
  `{"sub": userId, "exp": unixSeconds}` and the signature is its HMAC-SHA256 with the
  shared secret, base64url. Same format as `PhoenixGateway.issueToken` in apps/server.
  """

  @doc "The user id of a valid, unexpired token."
  @spec verify(term, binary, integer) :: {:ok, pos_integer} | :error
  def verify(token, secret, now \\ System.system_time(:second))

  def verify(token, secret, now) when is_binary(token) do
    with [payload, signature] <- String.split(token, ".", parts: 2),
         {:ok, signature} <- Base.url_decode64(signature, padding: false),
         true <- Plug.Crypto.secure_compare(mac(payload, secret), signature),
         {:ok, json} <- Base.url_decode64(payload, padding: false),
         {:ok, %{"sub" => user_id, "exp" => exp}}
         when is_integer(user_id) and user_id > 0 and is_integer(exp) <-
           Jason.decode(json),
         true <- exp > now do
      {:ok, user_id}
    else
      _ -> :error
    end
  end

  def verify(_token, _secret, _now), do: :error

  @doc "Signs a token the way the API does (for tests and local tools)."
  @spec sign(pos_integer, integer, binary) :: binary
  def sign(user_id, exp, secret) do
    payload = Base.url_encode64(Jason.encode!(%{sub: user_id, exp: exp}), padding: false)
    payload <> "." <> Base.url_encode64(mac(payload, secret), padding: false)
  end

  defp mac(payload, secret), do: :crypto.mac(:hmac, :sha256, secret, payload)
end
