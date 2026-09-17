# Design: StylePath HTTP API and Windows Cloudflare Tunnel

## Architecture

The HTTP server is an imperative-shell adapter around the existing application use case:

```text
HTTP client -> api/style-lines-http -> application/style-path -> chess rules port
                                                     -> UCI provider ports
                                                     -> domain ScenarioLine
```

The API does not parse UCI output, choose moves, or mutate domain records. It validates request shape, ingests FEN or RAW SAN text, invokes `generateStylePaths`, serializes structured `ScenarioLine` data, and optionally includes the same SAN movetext used by the CLI.

## Endpoints

- `GET /health` returns process health without exposing engine analysis.
- `POST /api/style-lines` requires `Authorization: Bearer <token>` and accepts exactly one of `fen` or `rawSan`.

## Authentication

The local API requires a bearer token for analysis requests. The token is provided by environment variable or an ignored local runtime file, never committed. Cloudflare Tunnel forwards to `http://127.0.0.1:<port>`.

## Windows tunnel

The Windows host runs two local services/processes:

1. the Chess Trainer API bound to `127.0.0.1`;
2. `cloudflared.exe` installed as a Windows Service with the tunnel token copied from Cloudflare Zero Trust.

Cloudflare owns the public hostname route, for example `https://chess-api.example.com -> http://127.0.0.1:8787`.

## Safety

The API is read-only with respect to external chess platforms. It only exposes the already implemented local StylePath analysis and never creates platform commands.
