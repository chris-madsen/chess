# Capability: Engine Adapters

## Purpose

Connect the Scenario Analysis context to local Maia and Stockfish runtimes without leaking protocol details into the domain.

## Requirement: Isolate protocol details

The application SHALL call typed domain ports, while adapters own UCI/process/runtime implementation details.

### Scenario: Convert a Stockfish request

- GIVEN a valid PositionSnapshot and configured Stockfish request
- WHEN StockfishMoveProvider is called
- THEN the adapter sends a valid engine request
- AND returns a legal domain move with complete MoveProvenance
- AND no UCI transcript type enters the domain model.

### Scenario: Convert a Maia request

- GIVEN a valid PositionSnapshot and configured Maia request
- WHEN MaiaMoveProvider is called
- THEN the adapter invokes the Maia runtime with configured human-likelihood settings
- AND returns a domain move with complete MoveProvenance
- AND no runtime tensor or vendor-specific object enters the domain model.

## Requirement: Validate external output

The application SHALL treat all provider output as untrusted until parsed and legality-checked.

### Scenario: Reject an illegal engine move

- GIVEN a provider returns a move illegal in the supplied PositionSnapshot
- WHEN the application validates the result
- THEN the result is rejected
- AND the error identifies the provider and input position.

### Scenario: Reject malformed provider output

- GIVEN a provider returns an unparsable move, empty response, corrupted transcript, or unsupported notation
- WHEN the adapter parses the response
- THEN it returns a structured provider error
- AND no ScenarioLine move is appended.

## Requirement: Maia models the opponent in HumanPath

### Scenario: Request Maia on opponent ply

- GIVEN HumanPath generation reaches an Opponent ply
- WHEN a move is requested
- THEN the MaiaMoveProvider is called with configured human-like policy settings
- AND the provenance labels the move as modeled, not objectively best defense.

### Scenario: Do not call Maia for Stockfish continuation ply

- GIVEN HumanPath generation reaches the Player's continuation ply after a Maia response
- WHEN a move is requested
- THEN the StockfishMoveProvider is called
- AND Maia is not asked to choose the Player continuation in default mode.

## Requirement: Stockfish supplies configured calculation

Stockfish output SHALL be tied to declared calculation settings.

### Scenario: Record Stockfish limits

- GIVEN Stockfish is asked for a continuation
- WHEN a move is accepted
- THEN provenance records relevant limits such as depth, nodes, time, threads, hash, MultiPV, skill, contempt/options when available
- AND records binary/version identity when available.

## Requirement: Providers fail closed

### Scenario: Engine unavailable

- GIVEN Stockfish or Maia is not installed, not configured, or fails readiness check
- WHEN a scenario requires that provider
- THEN generation returns an explicit provider-unavailable error
- AND the system does not substitute another provider silently.

### Scenario: Timeout produces partial line

- GIVEN a provider exceeds configured timeout
- WHEN the timeout fires
- THEN the provider returns `PROVIDER_TIMEOUT`
- AND Scenario Analysis may retain the legal prefix only.
