# ADR-002: Require Explicit Provenance for Every Scenario-Line Move

## Status

Accepted

## Context

A mixed line may contain a Player idea, an actually observed external bot move, a Maia prediction, and a Stockfish continuation. Without provenance, users and AI agents can falsely describe a scenario as a bot's principal variation or mistake a human-likelihood prediction for best play.

## Decision

Every move stores MoveProvenance. An external LeelaAlien or Boris-Trapsky probe can be attributed only to the first CandidateSeed actually observed from the same PositionSnapshot. Subsequent simulated plies retain their own generator identity.

## Consequences

- ScenarioLine is distinct from an engine PV.
- Rendering and LLM explanations must disclose source transitions.
- Reproducibility metadata is persisted with engine/model moves.
- Any adapter output without provenance is rejected.
