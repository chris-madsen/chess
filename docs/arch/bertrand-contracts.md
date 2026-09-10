# Bertrand Contracts

## Purpose

Bertrand-Meyer contracts make Chess Trainer fail closed at boundaries and make impossible states unrepresentable where practical.

## BTC-01: Position ingest precondition

Invalid FEN must be rejected before provider calls.

## BTC-02: CandidateSeed precondition

A seed must be legal in the current position and must have provenance before HumanPath generation starts.

## BTC-03: Move legality postcondition

Every accepted scenario ply must be legal in the board reached by previous plies.

## BTC-04: Provenance invariant

No `ScenarioPly` exists without `MoveProvenance`.

## BTC-05: HumanPath source-order invariant

Default source order is seed, Maia, Stockfish, Maia, Stockfish. Source mismatch fails closed.

## BTC-06: External bot attribution invariant

LeelaAlien and Boris-Trapsky may be credited only for observed plies. Later simulated plies keep their own source.

## BTC-07: Provider failure postcondition

Timeout, malformed output, unavailable provider, or illegal provider move creates an incomplete line and never invented plies.

## BTC-08: Decision safety invariant

A `Decision` is analysis data and cannot become a platform command in ordinary analysis.

## BTC-09: FSM transition precondition

Illegal state transitions return typed domain errors.

## BTC-10: Architecture boundary invariant

Domain code must not import adapters, chess.js, HTTP, filesystem, child processes, UCI, Lichess, or LLM providers.
