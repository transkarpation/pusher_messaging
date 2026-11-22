defmodule RealtimeServer.TokenTest do
  use ExUnit.Case, async: true
  alias RealtimeServer.Token

  @secret "test-secret"

  test "accepts a token it signed" do
    token = Token.sign(42, 2_000, @secret)
    assert Token.verify(token, @secret, 1_000) == {:ok, 42}
  end

  test "rejects an expired token" do
    assert Token.verify(Token.sign(42, 1_000, @secret), @secret, 1_000) == :error
  end

  test "rejects another secret, tampering and junk" do
    token = Token.sign(42, 2_000, @secret)
    [payload, signature] = String.split(token, ".")
    forged = Base.url_encode64(~s({"sub":1,"exp":2000}), padding: false)

    assert Token.verify(token, "other-secret", 1_000) == :error
    assert Token.verify(forged <> "." <> signature, @secret, 1_000) == :error
    assert Token.verify(payload, @secret, 1_000) == :error
    assert Token.verify("a.b", @secret, 1_000) == :error
    assert Token.verify(nil, @secret, 1_000) == :error
  end

  test "reads a token encoded the way the API encodes it" do
    payload = Base.url_encode64(~s({"sub":7,"exp":1800000000}), padding: false)
    signature = :crypto.mac(:hmac, :sha256, @secret, payload) |> Base.url_encode64(padding: false)
    assert Token.verify(payload <> "." <> signature, @secret, 1_700_000_000) == {:ok, 7}
  end
end
