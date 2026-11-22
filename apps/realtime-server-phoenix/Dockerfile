FROM elixir:1.19-alpine

WORKDIR /app
ENV MIX_ENV=prod

RUN mix local.hex --force && mix local.rebar --force

COPY mix.exs mix.lock ./
RUN mix deps.get --only prod && mix deps.compile

COPY config config
COPY lib lib
RUN mix compile

ENV PORT=4000
EXPOSE 4000
CMD ["mix", "phx.server"]
