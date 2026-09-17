# Design: Local Style-Engine Lines

## Architecture

The domain remains a pure functional core. Application services orchestrate `StylePath` generation through provider ports. UCI subprocesses live only in adapters.

```text
CLI -> application/style-path -> chess rules port
                            -> LocalStyleEngineProvider
                            -> MaiaMoveProvider
                            -> domain ScenarioLine

adapters/uci owns child_process and UCI protocol details.
```

## Source order

For a position after ingesting FEN or RAW SAN notation, the side to move is treated as the Player side for this CLI. A `StylePath` line starts without a user candidate seed:

```text
ply 1: LocalStyleEngine for Player side
ply 2: Maia 1900 for Opponent side
ply 3: same LocalStyleEngine for Player side
ply 4: Maia 1900 for Opponent side
...
```

Each enabled local style engine produces an independent line. Provider failures are isolated per line.

## Enabled engines

The default local suite enables Patricia, Jackal, and Seer. The Windows CSTal suite enables CSTal ABSURD and CSTal EXTREME from `Chess-System-Tal-NNUE-2` v2.07 Windows AVX2 builds, with scalar builds as the fallback when AVX2 does not start.

The Windows suite keeps the same mixed-line semantics:

```text
CSTal ABSURD  -> Maia3 79M -> CSTal ABSURD  -> Maia3 79M -> ...
CSTal EXTREME -> Maia3 79M -> CSTal EXTREME -> Maia3 79M -> ...
```

## CLI input

- FEN mode validates a FEN string directly.
- RAW file mode parses ordinary SAN move text from the initial position, normalizes it to a final `PositionSnapshot`, and infers Player side from side-to-move.
- User-facing `--horizon` is removed. Local StylePath analysis starts at horizon 8 full moves. Patricia, Seer, CSTal ABSURD, and CSTal EXTREME start at depth 13; Jackal starts at depth 8 to keep watch updates responsive.
- `--engine-suite cstal-windows` selects the Windows CSTal suite. The default remains `local-style`.
- Watch mode reacts to file changes through `fs.watch` when available and has a polling fallback. Rendering refreshes with the latest completed or partial engine-line results.
- The current local style engines have fixed configured depths: Patricia and Seer depth 13, Jackal depth 8. Watch mode must not raise the global style-depth display into meaningless large values when every engine already has a fixed depth override.
- If the rendered line signature is stable for 10 seconds, watch mode increases horizon by 2 full moves. Horizon extension has no product-level maximum; generous subprocess timeouts, serial request queues, and clean shutdown remain technical guards.

## CLI rendering

One-shot output renders ScenarioLines first as ordinary SAN movetext, followed by the analysis metadata block. Watch mode redraws the previous local output block in place and must not emit global terminal reset, screen-clear, or scrollback-clear sequences. Frames are rendered only when line content, status, errors, or settings change; timestamp-only heartbeat frames are suppressed.

## Safety

The CLI is read-only with respect to external platforms. It does not submit moves to Lichess or any game platform. Every provider move is validated against the current position before being appended.

## Continuous mixed-line semantics

The UCI stream is an input to the local style-engine proposal side only. It must not replace Maia responses. A live frame may show the latest style-engine PV as the current odd-ply candidate view, but the canonical `StylePath` remains `LocalStyleEngine -> Maia -> LocalStyleEngine -> Maia`. Each accepted Maia response advances the concrete mixed line; each streamed style-engine PV is provisional until legal and accepted for the relevant odd ply. Watch state is continuous: horizon growth extends from the current tail and must not recompute already accepted plies from the root unless the input position changes.

### Jackal UCI compatibility

Jackal is treated as a local style engine with a documented UCI compatibility quirk: some positions produce `info ... pv ...` output but no terminating `bestmove`. The implementation may enable a Jackal-only fallback that accepts the first legal move from the latest observed PV after timeout. This fallback must not apply to Patricia, Seer, Maia, or future engines by default, and it must still reject missing or illegal PV moves. Other transient provider failures remain visible and retry the same ply after backoff; they must not be converted into invented moves.

### Runtime resource defaults

Patricia and Seer SHOULD run with 2 CPU threads and a 10 GB hash budget. Jackal SHOULD run with 1 CPU thread and a 10 GB hash budget. The Maia opponent model SHOULD run with 5 seconds movetime, 6 CPU threads/task workers/searchers, `MinibatchSize=32`, and a 10 GB RAM limit. These defaults are adapter configuration and must not leak into the pure domain model.
