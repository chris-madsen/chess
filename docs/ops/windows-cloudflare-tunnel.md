# Windows Cloudflare Tunnel for the StylePath API

This guide publishes the local read-only Chess Trainer StylePath API from a Windows host through Cloudflare Tunnel.

## Target shape

```text
Client
  -> https://chess-api.example.com/api/style-lines
  -> Cloudflare Tunnel
  -> cloudflared Windows Service
  -> http://127.0.0.1:8787/api/style-lines
  -> local CSTal/Maia UCI engines
```

The API still requires `Authorization: Bearer <CHESS_TRAINER_API_TOKEN>`. Cloudflare Tunnel does not replace the application token.

## 1. Start the local API on Windows

From the repository directory in PowerShell:

```powershell
$env:CHESS_TRAINER_API_TOKEN = "replace-with-a-long-random-secret"
$env:CHESS_TRAINER_API_HOST = "127.0.0.1"
$env:CHESS_TRAINER_API_PORT = "8787"
$env:CHESS_TRAINER_ENGINE_SUITE = "cstal-windows"
$env:CHESS_TRAINER_CSTAL_OPPONENT = "maia3"
$env:CHESS_TRAINER_MAIA3_ELO = "1900"
npm run style:api
```

The Windows engine paths remain in ignored local runtime config (`engines.local.json`). Do not commit engine paths that contain secrets or private tokens.

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

Analysis request:

```powershell
$headers = @{ Authorization = "Bearer $env:CHESS_TRAINER_API_TOKEN" }
$body = @{ fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; horizonMoves = 1 } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8787/api/style-lines -Method Post -Headers $headers -ContentType "application/json" -Body $body
```

## 2. Create a Cloudflare Tunnel

In Cloudflare Zero Trust / Cloudflare One:

1. Go to **Networks / Tunnels**.
2. Create a tunnel, for example `chess-trainer-windows`.
3. Select the Windows connector and copy the tunnel token / install command.
4. Add a public hostname route:
   - hostname: `chess-api.example.com`;
   - service: `http://127.0.0.1:8787`.

Cloudflare requires the domain to be in your Cloudflare account before publishing a stable hostname.

## 3. Install cloudflared as a Windows Service

Run PowerShell as Administrator and use the helper script:

```powershell
scripts\install-cloudflared-windows.ps1 -TunnelToken "<token-from-cloudflare>"
```

Equivalent direct command:

```powershell
cloudflared.exe service install <token-from-cloudflare>
```

Do not write the tunnel token to repository files. If you need a persistent secret store, use Windows service configuration, Windows Credential Manager, or your deployment tool.

## 4. Public request

```powershell
$headers = @{ Authorization = "Bearer <CHESS_TRAINER_API_TOKEN>" }
$body = @{ fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" } | ConvertTo-Json
Invoke-RestMethod https://chess-api.example.com/api/style-lines -Method Post -Headers $headers -ContentType "application/json" -Body $body
```

## Safety notes

- Bind the API to `127.0.0.1`; let `cloudflared` be the only public ingress path.
- Keep `CHESS_TRAINER_API_TOKEN` and the Cloudflare tunnel token out of git.
- Ordinary API analysis is read-only and must not create platform commands.
- Use Cloudflare Access or WAF rules as an additional layer if the URL is shared outside your own clients.
