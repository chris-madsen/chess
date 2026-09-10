# Capability: Move Provenance

## Purpose

Make every scenario-line move auditable, explainable, and reproducible enough to distinguish observed facts from modeled or engine-generated moves.

## Requirement: Provenance is mandatory

Every move in a ScenarioLine SHALL include `MoveProvenance`.

### Scenario: Persist engine metadata

- GIVEN Maia or Stockfish generates a move
- WHEN the move is accepted into a ScenarioLine
- THEN provenance contains generator source, display name, engine/model version when available, binary or model identity when available, configuration, request ID, input position hash, and observation/modeling status.

### Scenario: Persist external observation metadata

- GIVEN ExternalProbe observes a legal first move from Boris-Trapsky
- WHEN that move becomes a CandidateSeed
- THEN provenance identifies Boris-Trapsky, source position hash, probe identifier, game/request identifier when available, and observation timestamp when available.

### Scenario: Persist player-entered metadata

- GIVEN the Player submits a legal CandidateSeed
- WHEN the seed is accepted
- THEN provenance identifies source `PLAYER_IDEA`
- AND records the session ID and timestamp when available.

## Requirement: Prohibit unknown provenance

The system SHALL reject unlabelled moves in scenario lines.

### Scenario: Reject unlabelled adapter output

- GIVEN an adapter returns a legal chess move without required provenance
- WHEN Scenario Analysis attempts to append it
- THEN the move is rejected
- AND the line is marked incomplete with an explicit adapter error.

### Scenario: Reject vague bot attribution

- GIVEN a move is labelled only as `BOT` or `ENGINE`
- WHEN the move is ingested for a ScenarioLine
- THEN ingestion fails
- AND the error requests a concrete source kind and provider identity.

## Requirement: Preserve source semantics

The system SHALL preserve the meaning of each source kind.

### Scenario: Maia is modeled, not observed

- GIVEN Maia returns an opponent move
- WHEN provenance is stored
- THEN observation status is `MODELED_LOCAL`
- AND the move is not labelled as externally observed.

### Scenario: External probe is observed, not evaluated

- GIVEN LeelaAlien plays one move in a bounded probe
- WHEN provenance is stored
- THEN observation status is `OBSERVED_EXTERNAL`
- AND no engine evaluation is inferred from the observation.

## Requirement: Support reproducibility checks

Provenance SHALL carry enough metadata to identify drift even when exact engine determinism is unavailable.

### Scenario: Compare runs across engine versions

- GIVEN two ScenarioLines from the same PositionSnapshot and CandidateSeed
- WHEN their provenance contains different Stockfish versions or settings
- THEN the system can report that the lines are not directly comparable.

### Scenario: Missing optional timestamp is explicit

- GIVEN a source cannot provide a reliable timestamp
- WHEN provenance is stored
- THEN timestamp absence is represented explicitly
- AND the system does not invent a timestamp.
