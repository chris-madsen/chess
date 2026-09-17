# StylePath HTTP API

The StylePath HTTP API exposes the same read-only mixed-line analysis that the CLI provides, but through a local authenticated HTTP endpoint.

## Purpose

Use this API when a remote client needs CSTal/Maia StylePath lines from the Windows engine host without shelling into the machine.

The API is still an analysis surface only. It does not submit moves, create Lichess games, send chat, resign, abort, or create any `PlatformCommand`.

## Public endpoint

The Cloudflare hostname reserved for the Windows host is:

```text
https://chess.network-communications.net
```

Configured route:

```text
https://chess.network-communications.net/*
  -> Cloudflare Tunnel: chess-trainer-windows
  -> http://127.0.0.1:8787/* on the Windows host
```

Until the Windows `cloudflared` connector is installed and running, the hostname may return a Cloudflare tunnel/connector error even though DNS and tunnel configuration exist.

## Local API process

Start the API on the Windows host from the repository checkout:

```powershell
$env:CHESS_TRAINER_API_TOKEN = "replace-with-a-long-random-secret"
$env:CHESS_TRAINER_API_HOST = "127.0.0.1"
$env:CHESS_TRAINER_API_PORT = "8787"
$env:CHESS_TRAINER_ENGINE_SUITE = "cstal-windows"
$env:CHESS_TRAINER_CSTAL_OPPONENT = "maia3"
$env:CHESS_TRAINER_MAIA3_ELO = "1900"
npm run style:api
```

Health endpoint:

```http
GET /health
```

Analysis endpoint:

```http
POST /api/style-lines
Authorization: Bearer <CHESS_TRAINER_API_TOKEN>
Content-Type: application/json
```

Request body accepts exactly one of `fen` or `rawSan`:

```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "horizonMoves": 1,
  "includeRenderedText": true
}
```

Successful response includes:

- generated timestamp;
- canonical FEN, position hash, side to move;
- settings used by the run;
- one line per configured style engine;
- UCI/SAN move data;
- source and provider provenance for every ply;
- optional CLI-style rendered SAN movetext.

## Windows Cloudflare connector token

The Cloudflare tunnel and DNS route have already been created for:

```text
chess.network-communications.net
```

The connector token was saved on this Linux workstation at:

```text
.local/cloudflare/chess-trainer-windows.tunnel-token
```

That path is ignored by git. Do not commit or paste the token into docs, issues, logs, or chat transcripts. Transfer it to the Windows machine through a private channel and install the connector from an elevated PowerShell session:

```powershell
scripts\install-cloudflared-windows.ps1 -TunnelToken "<token-from-private-channel>"
```

Equivalent direct command:

```powershell
cloudflared.exe service install <token-from-private-channel>
```

After installation, verify the service:

```powershell
sc.exe query cloudflared
```

Then test the public endpoint:

```powershell
Invoke-RestMethod https://chess.network-communications.net/health
```

Analysis request through Cloudflare:

```powershell
$headers = @{ Authorization = "Bearer <CHESS_TRAINER_API_TOKEN>" }
$body = @{
  fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  horizonMoves = 1
} | ConvertTo-Json

Invoke-RestMethod https://chess.network-communications.net/api/style-lines `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

## Security checklist

- Bind the API to `127.0.0.1`, not a public Windows interface.
- Keep `CHESS_TRAINER_API_TOKEN` outside git.
- Keep the Cloudflare tunnel token outside git.
- Prefer Cloudflare Access or WAF rules as an additional control if the endpoint is reachable by clients outside your own automation.
- Rotate tokens if they are printed into terminals that are logged or shared.
