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
- Maia-9: CSSLab `maia-1900.pb.gz` from `CSSLab/maia-chess` release `v1.0`, run through Lc0 with `--backend=eigen` and `go nodes 1` for human-policy style probing.

## Verification

Run:

```bash
npm run verify:engines:local
```

Expected behavior:

- Stockfish returns `id name Stockfish 19`, `uciok`, `readyok`, and a `bestmove`.
- Maia-9/Lc0 loads `maia-1900.pb.gz`, returns `uciok`, `readyok`, and a `bestmove` for `go nodes 1`.

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

The StylePath CLI no longer accepts a user-facing `--horizon` flag. It starts at horizon 8 full moves. Patricia and Seer start at style-engine depth 13; Jackal starts at depth 8 because it is much slower on tactical positions. Watch mode renders an immediate pending frame, then updates each engine line independently as soon as that line completes. While watch mode is running, unchanged line signatures increase requested depth by 2 after 5 stable seconds and increase horizon by 2 full moves after 10 stable seconds. There is no product-level maximum; stopping the CLI stops analysis. Technical guards remain: UCI requests are queued per provider, subprocesses are cleaned up on failure where possible, and depth-based UCI requests use generous timeouts derived from the requested depth.
