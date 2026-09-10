# Delta: position-intelligence

## ADDED Requirements

### Requirement: Domain skeleton supports contract-first implementation

The system SHALL expose typed domain records, freeze/ingest boundaries, and contract tests before real external engine or platform adapters are introduced.

#### Scenario: Skeleton uses fake providers only

- GIVEN this change is active
- WHEN scenario generation is tested
- THEN provider behavior is supplied by fake Maia and fake Stockfish ports
- AND no real Stockfish, Maia, Lichess, LeelaAlien, or Boris-Trapsky integration is invoked.
