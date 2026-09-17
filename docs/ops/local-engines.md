# Local Chess Engine Runtime

## Purpose

This document records the local engine runtime expected by development adapters. Runtime binaries, model weights, and local path config are intentionally not committed.

## Installed local paths

The current local installation uses ignored project-local paths:

```text
.local/chess-engines/bin/stockfish19
.local/chess-engines/bin/lc0
.local/chess-engines/bin/maia9
.local/chess-engines/maia/maia-1900.pb.gz
engines.local.json
```

`engines.local.json` is ignored by git and contains local path hints only. It must never contain Lichess tokens or other secrets.

## Runtime identities

- Stockfish: official Stockfish 19 Linux x86-64 universal release.
- Lc0: Nix `nixpkgs#lc0`, version `0.32.1`.
- Maia-9: CSSLab `maia-1900.pb.gz` from `CSSLab/maia-chess` release `v1.0`, run through Lc0 with `--backend=eigen` and `go movetime 4000` for human-policy style probing.

## Verification

Run:

```bash
npm run verify:engines:local
```

Expected behavior:

- Stockfish returns `id name Stockfish 19`, `uciok`, `readyok`, and a `bestmove`.
- Maia-9/Lc0 loads `maia-1900.pb.gz`, returns `uciok`, `readyok`, and a `bestmove` for `go movetime 4000`. Runtime config gives Maia 6 CPU worker threads, matching task/search workers, `MinibatchSize=32`, and `RamLimitMb=10240`.

This command is intentionally not part of CI because the runtime files are local-only.

## Safety

- Do not commit engine binaries, downloaded archives, model weights, `.env`, or `engines.local.json`.
- Do not add Lichess API tokens to this file or to local runtime JSON.
- External bot probing remains future work and must be implemented as an automated bounded Lichess API game-probe lifecycle, not as manual UI work.

## Local StylePath engines

The Linux StylePath CLI suite uses these local providers:

- Patricia: latest GitHub release, prefer `patricia_v3` on Linux.
- Jackal: latest GitHub release, prefer Linux `x86-64-v3` with `x86-64-v2` fallback.
- Seer: build a local Linux UCI binary from source because current release assets are Windows executables.

The Windows CSTal suite is selected with:

```bash
npm run style:lines:cstal -- --fen "<fen>"
npm run style:lines:cstal -- --maia3-elo 1800 --fen "<fen>"
npm run style:lines:cstal -- --cstal-opponent maia1900 --fen "<fen>"
```

It uses:

- CSTal ABSURD: `Chess-System-Tal-NNUE-2` v2.07 AVX2 Windows build.
- CSTal EXTREME: `Chess-System-Tal-NNUE-2` v2.07 AVX2 Windows build.
- Maia3 79M: `maia3-uci --model maia3-79m`, or `python -m maia3.uci --model maia3-79m`, with `go movetime 4000`. Maia3 runs with `Elo`, `SelfElo`, and `OppoElo` from `--maia3-elo` (default `1900`), `Temperature=1.0`, `TopP=1.0`, `MultiPV=5`, and `--use-uci-history`. The Python Maia3 UCI wrapper handles those Maia-specific options; Lc0-style worker and memory options are not sent to Maia3. StylePath sends UCI history as `position startpos moves ...` for raw games and as `position fen ... moves ...` for continuations from an arbitrary FEN.
- Maia 1900: CSSLab `maia-1900.pb.gz` through Lc0 Windows CPU DNNL with the `blas` backend. Select it with `--cstal-opponent maia1900`. These comparison lines use the same `go movetime 4000` limit as the local Maia 1900 StylePath runtime, with 4 worker/search threads in the Windows CSTal suite.

Run:

```bash
npm run install:cstal-windows
npm run verify:cstal-windows
```

The installer writes ignored local paths to `engines.local.json` as `cstalAbsurdPath`, `cstalExtremePath`, and a default Maia3 command. On older CPUs, replace the CSTal AVX2 paths with scalar `.exe` paths if AVX2 does not start.

### Windows StylePath HTTP API

The Windows CSTal runtime can also be exposed as a local HTTP/SSE job server for a Linux client on the same trusted network:

```bash
set STYLE_SERVER_TOKEN=<secret>
set STYLE_SERVER_HOST=0.0.0.0
set STYLE_SERVER_PORT=8787
set STYLE_ALLOWED_COUNTRIES=EE
npm run style:server
```

When `STYLE_ALLOWED_COUNTRIES` is set, protected API endpoints require Cloudflare's `CF-IPCountry` header to match one of the comma-separated country codes. Use `EE` to allow Estonia only. `/health` remains unauthenticated for tunnel health checks.

Create a job by sending `game.txt` as base64:

```bash
curl -sS -X POST http://WINDOWS_HOST:8787/v1/style-lines/jobs \
  -H "Authorization: Bearer $STYLE_SERVER_TOKEN" \
  -H "content-type: application/json" \
  -d '{"rawGameBase64":"...","engineSuite":"cstal-windows","cstalOpponent":"maia3","maia3Elo":2100,"refreshMs":2000,"maxFullMoves":80,"timeoutMs":300000}'
```

Then stream events:

```bash
curl -N -H "Authorization: Bearer $STYLE_SERVER_TOKEN" \
  http://WINDOWS_HOST:8787/v1/style-lines/jobs/<jobId>/events
```

The server returns structured JSON events (`queued`, `started`, `progress`, `complete`, `error`, `cancelled`) and closes the SSE stream after the final event. `GET /v1/style-lines/jobs/<jobId>` returns the latest snapshot, and `DELETE /v1/style-lines/jobs/<jobId>` cancels running work. Jobs are in-memory only; restarting the server drops job state. The server keeps a single latest job: posting a new job cancels any unfinished previous job and starts the new calculation immediately.

When `npm run style:lines -- --raw-file game.txt --watch` runs on the Windows host and `STYLE_SERVER_TOKEN` or `.local/style-server-token.txt` is available, the CLI uses the local StylePath API instead of starting another in-process engine set. The CLI consumes SSE progress, deduplicates repeated snapshots, and redraws one live terminal frame. If stdout is redirected to a file, the ANSI redraw codes are preserved as text; run it in a normal terminal to see the live view.

All local engines are invoked through UCI adapters. Their raw output is untrusted until the returned move is validated against the current `PositionSnapshot`.

### Jackal compatibility note

The Jackal 2.0.0 Linux release binary may require `GLIBC_2.39`. If the host has an older glibc, `scripts/install-local-style-engines.mjs` falls back to building Jackal from source. The source build pre-downloads Jackal network files from HuggingFace into `.local/chess-engines/sources/Jackal/resources/networks/` so that Cargo build-script downloads are visible and retryable.

## Adaptive StylePath watch

Patricia and Seer use 2 CPU threads and `Hash=10240`. Jackal keeps 1 CPU thread for stability and also uses `Hash=10240`. CSTal ABSURD/EXTREME use 2 CPU threads per process in the Windows suite. Maia uses 6 CPU threads in the Linux local suite and 4 CPU threads for Maia 1900 comparison lines in the Windows CSTal suite.

The StylePath CLI no longer accepts a user-facing `--horizon` flag. It starts at horizon 8 full moves. Patricia and Seer start at fixed style-engine depth 13; CSTal ABSURD and CSTal EXTREME start at fixed style-engine depth 14; Jackal starts at fixed depth 8 because it is much slower on tactical positions. Watch mode updates engine lines independently as new plies are appended. Because all current style engines have fixed configured depths, watch mode does not increase the displayed global style depth into meaningless large values. Stable lines extend horizon by 2 full moves after 10 stable seconds. Horizon extension continues from the current tail and must not recalculate already accepted plies. There is no product-level maximum; stopping the CLI stops analysis. Technical guards remain: UCI requests are queued per provider, subprocesses are cleaned up on failure where possible, and depth-based UCI requests use generous timeouts derived from the requested depth. Transient provider timeouts remain visible and retry the same ply after a short backoff; no move is invented.

### Jackal UCI quirk

Jackal can emit usable `info ... pv ...` lines on tactical positions while never producing a final `bestmove` for `go depth`, `go nodes`, or `go movetime`. The UCI adapter therefore enables a Jackal-only fail-closed degradation: after the Jackal request timeout, if the adapter observed a legal first move in the latest PV, it uses that legal PV move as the provided move and restarts only the Jackal UCI session. Patricia and Seer do not use this fallback. If no legal PV move was observed, the line remains incomplete with the original provider error.
