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

The job/SSE endpoint used by remote pattern experiments also accepts exactly one
of `rawGameBase64` or `fen`. `fen` is required for benchmark positions that do
not have a RAW SAN prefix:

```json
{
  "fen": "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPPP1P/RNBQKBNR b KQkq - 0 2",
  "engineSuite": "cstal-windows",
  "cstalOpponent": "maia3",
  "maia3Elo": 1800,
  "maxFullMoves": 8,
  "timeoutMs": 900000
}
```

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

## CLI watch via the public API

The local CLI can read `game.txt` from the current machine while taking the fully constructed StylePath lines from the public API job stream:

```bash
npm run style:lines -- --raw-file game.txt --watch --refresh-ms 2000
```

For RAW-file watch mode the default bot engine is `tal`, which maps to the server-side Windows CSTal suite and renders the two API lines returned by the job stream:

- `CSTal ABSURD vs Maia3 79M StylePath`
- `CSTal EXTREME vs Maia3 79M StylePath`

Equivalent explicit form:

```bash
npm run style:lines -- --raw-file game.txt --watch --refresh-ms 2000 --bot-engine tal
```

To force the old local-provider orchestration instead of the API-backed server lines:

```bash
npm run style:lines -- --raw-file game.txt --watch --refresh-ms 2000 --bot-engine local
```

The API-backed CLI mode reads the RAW game file locally, submits it as `rawGameBase64` to:

```text
POST https://chess.network-communications.net/v1/style-lines/jobs
```

and renders snapshots from:

```text
GET https://chess.network-communications.net/v1/style-lines/jobs/{jobId}/events
```

Configure authentication with one of:

```bash
export CHESS_STYLE_API_TOKEN='...'
export CHESS_STYLE_API_TOKEN_FILE=/path/to/style-server-token.txt
```

On the current workstation, the fallback token file path is `/media/ilja/DATA/chess/chess-api.ken`. The token value itself must never be committed.
