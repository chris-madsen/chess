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
- Maia-9: CSSLab `maia-1900.pb.gz` from `CSSLab/maia-chess` release `v1.0`, run through Lc0 with `--backend=eigen` and `go movetime 3000` for human-policy style probing.

## Verification

Run:

```bash
npm run verify:engines:local
```

Expected behavior:

- Stockfish returns `id name Stockfish 19`, `uciok`, `readyok`, and a `bestmove`.
- Maia-9/Lc0 loads `maia-1900.pb.gz`, returns `uciok`, `readyok`, and a `bestmove` for `go movetime 3000`. Runtime config gives Maia 6 CPU worker threads, matching task/search workers, `MinibatchSize=32`, and `RamLimitMb=10240`.

This command is intentionally not part of CI because the runtime files are local-only.

## Safety

- Do not commit engine binaries, downloaded archives, model weights, `.env`, or `engines.local.json`.
- Do not add Lichess API tokens to this file or to local runtime JSON.
- External bot probing remains future work and must be implemented as an automated bounded Lichess API game-probe lifecycle, not as manual UI work.

## Local StylePath engines

The first StylePath CLI increment uses these local providers:

- Patricia: latest GitHub release, prefer `patricia_v3` on Linux.
- Jackal: latest GitHub release, prefer Linux `x86-64-v3` with `x86-64-v2` fallback.
- Seer: build a local Linux UCI binary from source because current release assets are Windows executables.
- CSTal: deferred; public v2.07 style builds are Windows `.exe` files and require Wine or another explicit runtime.

All local engines are invoked through UCI adapters. Their raw output is untrusted until the returned move is validated against the current `PositionSnapshot`.

### Jackal compatibility note

The Jackal 2.0.0 Linux release binary may require `GLIBC_2.39`. If the host has an older glibc, `scripts/install-local-style-engines.mjs` falls back to building Jackal from source. The source build pre-downloads Jackal network files from HuggingFace into `.local/chess-engines/sources/Jackal/resources/networks/` so that Cargo build-script downloads are visible and retryable.

## Adaptive StylePath watch

Patricia and Seer use 2 CPU threads and `Hash=10240`. Jackal keeps 1 CPU thread for stability and also uses `Hash=10240`. Maia uses 6 CPU threads and `RamLimitMb=10240`.

The StylePath CLI no longer accepts a user-facing `--horizon` flag. It starts at horizon 8 full moves. Patricia and Seer start at fixed style-engine depth 13; Jackal starts at fixed depth 8 because it is much slower on tactical positions. Watch mode updates each engine line independently as new plies are appended. Because all current style engines have fixed configured depths, watch mode does not increase the displayed global style depth into meaningless large values. Stable lines extend horizon by 2 full moves after 10 stable seconds. Horizon extension continues from the current tail and must not recalculate already accepted plies. There is no product-level maximum; stopping the CLI stops analysis. Technical guards remain: UCI requests are queued per provider, subprocesses are cleaned up on failure where possible, and depth-based UCI requests use generous timeouts derived from the requested depth. Transient provider timeouts remain visible and retry the same ply after a short backoff; no move is invented.

### Jackal UCI quirk

Jackal can emit usable `info ... pv ...` lines on tactical positions while never producing a final `bestmove` for `go depth`, `go nodes`, or `go movetime`. The UCI adapter therefore enables a Jackal-only fail-closed degradation: after the Jackal request timeout, if the adapter observed a legal first move in the latest PV, it uses that legal PV move as the provided move and restarts only the Jackal UCI session. Patricia and Seer do not use this fallback. If no legal PV move was observed, the line remains incomplete with the original provider error.
