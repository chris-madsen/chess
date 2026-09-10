# ADR-003: Use Hybrid Human-Path Scenario-Line Orchestration

## Status

Accepted

## Context

Pure Stockfish-versus-Stockfish analysis is valuable for objective chess but poorly models practical play against human opponents. The project needs strong continuation for the Player while maintaining a human-like model of the Opponent.

## Decision

The default HumanPath sequence for a Player-to-move position is:

```text
CandidateSeed -> Maia -> Stockfish 19 NNUE -> Maia -> Stockfish ...
```

The CandidateSeed may originate from the Player, an observed LeelaAlien move, or an observed Boris-Trapsky move. Maia supplies modeled Opponent replies. Stockfish supplies Player-side continuations. A separately labeled AdversarialCheck may use Stockfish to look for concrete refutations but does not overwrite HumanPath.

## Consequences

- Default output is pedagogical scenario analysis, not objective principal variation.
- The system can optimize for practical play against human-like opponents.
- Engine settings and model versions must be persisted.
- UI and coaching text must show that Maia moves are likely-human modeling, not claims of best defense.
