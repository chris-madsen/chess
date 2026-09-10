# Change: ddd-hexagonal-domain-skeleton

## Summary

Introduce the first implementation skeleton for Chess Trainer: a TypeScript functional-core domain with hexagonal boundaries, ADTs, FSMs, deterministic chess position intelligence, fake provider ports, and Bertrand-Meyer contract tests.

## Motivation

The project needs a safe foundation before real Maia, Stockfish, Lichess, LeelaAlien, or Boris-Trapsky integrations. The skeleton must prevent known failure modes: imagined board state, illegal moves, missing provenance, source-order confusion, pseudo-PV attribution, and implicit external writes.

## Scope

In scope:

- TypeScript/Jest tooling and Makefile public commands.
- Domain ADTs and value objects.
- Chess legality through an adapter around `chess.js`.
- PositionFacts computation for deterministic coach input.
- AnalysisSession and ScenarioLine FSMs.
- HumanPath orchestration with fake Maia and fake Stockfish providers in tests.
- Contract tests for preconditions, postconditions, invariants, and architecture boundaries.

Out of scope:

- Real Stockfish process adapter.
- Real Maia runtime adapter.
- Lichess API, external bot probes, tokens, or platform writes.
- UI and database persistence.

## Expected outcome

`make gate` verifies the skeleton: lint, typecheck, Bertrand contracts, and contract tests.
