## Requirement: Generate local StylePath lines

The system SHALL generate one `StylePath` ScenarioLine for each enabled local style engine.

### Scenario: FEN input creates local style lines

- GIVEN `game-fen.txt` contains a valid FEN position
- AND the user invokes the CLI with `--file-fen game-fen.txt`
- AND enabled style engines Patricia, Jackal, and Seer
- WHEN local StylePath analysis is requested
- THEN the system creates three ScenarioLines
- AND their labels identify the originating local style engine.

### Scenario: Windows CSTal suite creates local style lines

- GIVEN `game-fen.txt` contains a valid FEN position
- AND the user invokes the CLI with `--file-fen game-fen.txt`
- AND the Windows CSTal engine suite is selected
- WHEN local StylePath analysis is requested
- THEN the system creates two ScenarioLines
- AND their labels are `CSTal ABSURD StylePath` and `CSTal EXTREME StylePath`.

### Scenario: Source order alternates local style engine and Maia

- GIVEN a local StylePath line for a player-to-move position
- WHEN the line is generated to horizon four
- THEN ply 1 is requested from the line's local style engine
- AND ply 2 is requested from Maia 1900
- AND ply 3 is requested from the same local style engine
- AND ply 4 is requested from Maia 1900.

### Scenario: CSTal source order alternates CSTal and Maia3

- GIVEN a Windows CSTal StylePath line for a player-to-move position
- WHEN the line is generated to horizon four
- THEN ply 1 is requested from that line's CSTal engine
- AND ply 2 is requested from Maia3 79M
- AND ply 3 is requested from the same CSTal engine
- AND ply 4 is requested from Maia3 79M.

### Scenario: Provider failure is isolated

- GIVEN multiple enabled style engines
- AND one style engine times out or returns malformed output
- WHEN local StylePath analysis is requested
- THEN only that engine's ScenarioLine becomes incomplete
- AND other ScenarioLines continue independently.

### Scenario: CLI renders one current watch frame

- GIVEN local StylePath watch mode is running
- WHEN a completed recomputation is rendered
- THEN the output frame contains each enabled StylePath line at most once
- AND no frame contains global terminal reset, screen-clear, or scrollback-clear controls
- AND timestamp-only heartbeat frames are suppressed.

### Scenario: CLI requires one file input

- GIVEN a user invokes the StylePath CLI
- WHEN neither `--file-pgn <path>` nor `--file-fen <path>` is supplied, or both are supplied
- THEN option parsing rejects the request with a structured usage error
- AND the removed `--raw-file` and inline `--fen` options are rejected.

### Scenario: FEN file preserves position metadata

- GIVEN `game-fen.txt` contains a valid FEN with black to move and fullmove number 17
- WHEN the user runs `npm run style:lines:cstal -- --file-fen game-fen.txt`
- THEN analysis starts from that FEN position
- AND rendered continuation starts with `17...`
- AND no PGN prefix is added.

### Scenario: Both file inputs support API watch

- GIVEN a valid PGN file or a valid FEN file
- WHEN the user runs the corresponding command with `--watch --refresh-ms 2000` and Tal API mode is active
- THEN a file change cancels the current job and starts a new job
- AND PGN input is sent as `rawGameBase64` or FEN input as `fen`
- AND the other input field is absent.

### Scenario: CLI renders every line as PGN

- GIVEN local StylePath one-shot output is rendered from a FEN file
- WHEN the CLI writes the result
- THEN the output is a standalone PGN document
- AND it contains `[Variant "From Position"]`
- AND it contains the starting `[FEN "..."]`
- AND the SAN movetext uses the FEN side-to-move and fullmove number.

### Scenario: PGN input does not receive a false FEN header

- GIVEN local StylePath one-shot output is rendered from a PGN file
- WHEN the CLI writes the result
- THEN the output is a standalone PGN document
- AND the original SAN prefix is preserved
- AND the post-game position is not emitted as the starting FEN.

### Scenario: Watch mode keeps fixed engine depths stable

- GIVEN local StylePath watch mode is running
- AND every enabled style engine has a configured fixed depth
- WHEN the rendered line signature remains stable
- THEN the displayed style depth does not grow into a meaningless global value
- AND each style engine continues to use its configured depth.

### Scenario: Watch mode extends stable horizon

- GIVEN local StylePath watch mode is running
- AND the rendered line signature does not change for 10 seconds
- WHEN the next analysis settings are computed
- THEN horizon increases by 2 full moves
- AND no product-level max horizon cap stops the increase while the process is running
- AND the line is extended from the current tail rather than recomputed from the root.

### Scenario: User horizon flag is removed

- GIVEN a user invokes the StylePath CLI with `--horizon`
- WHEN CLI options are parsed
- THEN the request is rejected with a typed error
- AND the usage text describes adaptive horizon behavior instead.

### Scenario: Transient provider timeout retries same ply

- GIVEN local StylePath watch mode is extending a line
- AND a provider returns a transient timeout or unavailable error
- WHEN the error is recorded
- THEN the affected line remains incomplete with causal error details
- AND the same ply is retried after backoff
- AND no replacement move is invented.
