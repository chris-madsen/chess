## Requirement: Expose StylePath through HTTP API

The system SHALL expose one-shot local StylePath generation through an authenticated HTTP API while preserving ScenarioLine provenance.

### Scenario: API returns structured StylePath lines

- GIVEN the HTTP API receives a valid FEN request
- AND authentication succeeds
- WHEN StylePath analysis completes
- THEN the response contains one result per configured style engine
- AND every ply includes UCI, SAN, source, provider identity, request ID, input position hash, and configuration.

### Scenario: API-rendered FEN lines are PGN documents

- GIVEN an authenticated StylePath job was created from a FEN file
- WHEN the CLI renders an event snapshot
- THEN each returned line is rendered as a standalone PGN document
- AND the document contains `Variant "From Position"` and the starting FEN
- AND status/errors are represented as PGN comments rather than non-PGN metadata lines.

### Scenario: API-rendered PGN lines preserve the PGN origin

- GIVEN an authenticated StylePath job was created from a PGN file
- WHEN the CLI renders an event snapshot
- THEN each returned line is rendered as a standalone PGN document
- AND the original SAN prefix is preserved
- AND the final post-game position is not used as a false starting FEN tag.

### Scenario: API rejects invalid input before providers

- GIVEN the HTTP API receives malformed JSON, invalid FEN, invalid RAW SAN, or both FEN and RAW SAN
- WHEN the request is handled
- THEN it returns a structured error
- AND no style engine or Maia provider is called.

## Requirement: CLI can render server-constructed StylePath jobs

The StylePath CLI SHALL support PGN-file and FEN-file watch modes in which the local process reads the selected file but obtains fully constructed lines from the authenticated StylePath job API.

### Scenario: PGN-file watch uses Tal API by default

- GIVEN a user runs `npm run style:lines -- --file-pgn game.txt --watch --refresh-ms 2000`
- AND an API base URL and bearer token are configured
- WHEN the RAW file is read
- THEN the CLI submits the RAW game as `rawGameBase64` to `/v1/style-lines/jobs`
- AND the default bot engine is `tal`
- AND the rendered lines come from `/v1/style-lines/jobs/{jobId}/events` rather than local provider orchestration.

### Scenario: FEN-file watch uses Tal API by default

- GIVEN a user runs `npm run style:lines -- --file-fen game-fen.txt --watch --refresh-ms 2000`
- AND `game-fen.txt` contains one valid FEN record
- AND an API base URL and bearer token are configured
- WHEN the FEN file is read
- THEN the CLI submits the FEN as `fen` to `/v1/style-lines/jobs`
- AND it does not submit `rawGameBase64`
- AND the default bot engine is `tal`
- AND the rendered lines come from the SSE job stream.

### Scenario: File input changes restart the server job

- GIVEN a Tal API watch is running for either `--file-pgn` or `--file-fen`
- WHEN the selected file changes
- THEN the active event stream is aborted
- AND a new job is created from the updated file contents
- AND PGN and FEN fields are never sent together.

### Scenario: Bot engine can be selected

- GIVEN a user passes `--bot-engine tal`
- WHEN the CLI creates the API job
- THEN the request uses `engineSuite` `cstal-windows`
- AND renders the two server lines returned by the API.

### Scenario: API mode does not invent missing lines

- GIVEN the StylePath job API returns progress or complete events
- WHEN the CLI renders a watch frame
- THEN it renders only lines present in the event payload
- AND it does not locally append or calculate additional plies.
