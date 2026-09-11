## Requirement: Generate local StylePath lines

The system SHALL generate one `StylePath` ScenarioLine for each enabled local style engine.

### Scenario: FEN input creates local style lines

- GIVEN a valid FEN position
- AND enabled style engines Patricia, Jackal, and Seer
- WHEN local StylePath analysis is requested
- THEN the system creates three ScenarioLines
- AND their labels identify the originating local style engine.

### Scenario: Source order alternates local style engine and Maia

- GIVEN a local StylePath line for a player-to-move position
- WHEN the line is generated to horizon four
- THEN ply 1 is requested from the line's local style engine
- AND ply 2 is requested from Maia 1900
- AND ply 3 is requested from the same local style engine
- AND ply 4 is requested from Maia 1900.

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

### Scenario: CLI renders movetext before metadata

- GIVEN local StylePath one-shot output is rendered
- WHEN the CLI writes the result
- THEN StylePath SAN movetext appears before the analysis metadata block
- AND the metadata block still includes the generated timestamp, FEN position, and inferred Player side.

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
