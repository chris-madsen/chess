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

V1 enables Patricia, Jackal, and Seer. CSTal has useful E1162-EAS, ABSURD, and EXTREME releases, but the public release artifacts are Windows executables; integration is deferred until Wine or a Linux-compatible runtime is explicitly configured.

## CLI input

- FEN mode validates a FEN string directly.
- RAW file mode parses ordinary SAN move text from the initial position, normalizes it to a final `PositionSnapshot`, and infers Player side from side-to-move.
- User-facing `--horizon` is removed. Local StylePath analysis starts at horizon 8 full moves. Patricia and Seer start at depth 13; Jackal starts at depth 8 to keep watch updates responsive.
- Watch mode reacts to file changes through `fs.watch` when available and has a polling fallback. Rendering refreshes every two seconds with the latest pending, completed, or partial engine-line results.
- If the rendered line signature is stable for 5 seconds, watch mode increases requested style-engine depth by 2. If it is stable for 10 seconds, watch mode increases horizon by 2 full moves. These adaptive increases have no product-level maximum; generous subprocess timeouts, serial request queues, and clean shutdown remain technical guards.

## CLI rendering

One-shot output renders ScenarioLines first as ordinary SAN movetext, followed by the analysis metadata block. Watch mode emits one complete current frame only after a recomputation completes. It does not emit ANSI cursor movement, screen clearing, scrollback clearing, or stale heartbeat frames; this keeps redirected and terminal output free of duplicated scrolling blocks. Recomputations remain serialized, and a refresh tick during an active computation queues one follow-up computation.

## Safety

The CLI is read-only with respect to external platforms. It does not submit moves to Lichess or any game platform. Every provider move is validated against the current position before being appended.

## Continuous mixed-line semantics

The UCI stream is an input to the local style-engine proposal side only. It must not replace Maia responses. A live frame may show the latest style-engine PV as the current odd-ply candidate view, but the canonical `StylePath` remains `LocalStyleEngine -> Maia -> LocalStyleEngine -> Maia`. Each accepted Maia response advances the concrete mixed line; each streamed style-engine PV is provisional until legal and accepted for the relevant odd ply.
