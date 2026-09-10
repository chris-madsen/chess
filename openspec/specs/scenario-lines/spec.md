# Capability: Scenario Lines

## Purpose

Generate legal, explainable, mixed-source HumanPath lines that help the Player understand candidate ideas against likely human responses. The default output is pedagogical scenario analysis, not an engine principal variation.

## Requirement: Validate the seed before calculation

The system SHALL reject an illegal CandidateSeed before invoking Maia or Stockfish.

### Scenario: Reject an illegal candidate

- GIVEN a valid PositionSnapshot
- AND a CandidateSeed that is illegal in that position
- WHEN HumanPath generation is requested
- THEN no engine provider is called
- AND the result identifies the illegal move.

### Scenario: Reject seed without provenance

- GIVEN a legal move string without required seed provenance
- WHEN HumanPath generation is requested
- THEN the system rejects the seed
- AND no Maia, Stockfish, or external provider is called.

## Requirement: Follow HumanPath source order

For a Player-to-move position, a default HumanPath ScenarioLine SHALL alternate sources as CandidateSeed, Maia, Stockfish, Maia, Stockfish until horizon or game end.

### Scenario: Generate six plies

- GIVEN a legal CandidateSeed and a horizon of six plies
- WHEN HumanPath generation succeeds
- THEN all generated moves are legal in sequence
- AND provenance sources are `[seed source, MAIA, STOCKFISH, MAIA, STOCKFISH, MAIA]`.

### Scenario: Generate from opponent-to-move position

- GIVEN a valid PositionSnapshot where the Opponent is to move
- WHEN HumanPath generation is requested without a Player CandidateSeed
- THEN the first generated ply is requested from Maia
- AND the next Player-side ply is requested from Stockfish
- AND the source order is recorded explicitly.

## Requirement: Do not mislabel a mixed-source line

A mixed-source line SHALL be labelled according to its generation mode, not according to a single seed source.

### Scenario: External idea remains a one-move attribution

- GIVEN a CandidateSeed observed from LeelaAlien
- WHEN the system generates later Maia and Stockfish plies
- THEN only the first ply has source `LEELA_ALIEN_PROBE`
- AND the ScenarioLine label does not call the line a LeelaAlien PV.

### Scenario: Player idea remains distinct from engine continuation

- GIVEN a CandidateSeed from the Player
- WHEN Stockfish supplies a later continuation
- THEN the Player is credited only for the seed
- AND Stockfish provenance is attached only to Stockfish-generated plies.

## Requirement: Validate every appended move

Each move returned by a provider SHALL be validated against the board reached by previous line moves.

### Scenario: Provider returns illegal continuation

- GIVEN HumanPath generation has reached a provider ply
- AND the provider returns a move illegal in the current position
- WHEN the application validates the response
- THEN the move is rejected
- AND the line is marked incomplete with provider error details
- AND no later provider is called for that line.

## Requirement: Stop safely

Scenario generation SHALL stop at terminal states and explicit failure states.

### Scenario: Stop at game end

- GIVEN a ScenarioLine reaches checkmate, stalemate, draw by rule, or another terminal board state
- WHEN the requested horizon has not yet been reached
- THEN generation stops at the terminal state
- AND no provider is called for another move.

### Scenario: Stop after provider timeout

- GIVEN a provider times out while generating a ply
- WHEN the timeout is reported
- THEN the line is marked incomplete
- AND the partial legal prefix remains available for review
- AND missing plies are not invented.

## Requirement: Keep AdversarialCheck separate

Stockfish defensive analysis SHALL be represented as a separate `AdversarialCheck`, not as a replacement for Maia plies in HumanPath.

### Scenario: Adversarial check does not overwrite HumanPath

- GIVEN an existing HumanPath ScenarioLine with Maia opponent plies
- WHEN a Stockfish defensive check is requested
- THEN the result is stored under a separately labelled AdversarialCheck
- AND the original Maia plies remain unchanged.
