# Domain Model

## Purpose

This document defines the first anemic DDD model for Chess Trainer. Records carry data; pure functions and FSM tables implement behavior.

## Bounded contexts

| Context | Responsibility | Primary aggregate |
|---|---|---|
| Player Coaching | Player reasoning, feedback, and decision records | AnalysisSession |
| Position Intelligence | Validated board state and tactical facts | PositionSnapshot |
| Scenario Analysis | HumanPath and future RefutationPath lines | ScenarioLine |
| Engine Execution | Provider ports for Maia and Stockfish | ProviderRun |
| External Idea Probe | Observed first-move seeds from public bots | ExternalProbe |
| Run Registry | Reproducibility and provenance metadata | ProviderRun |
| Puzzle Training | Future tactics mode with forcing-move discipline | PuzzleAttempt |
| Pattern Intelligence | Pattern families, progress, reachability, and mate precedence | PatternAssessment |
| Analysis Cache | Reusable provider/pattern state and rollout suffixes | CacheEntry |

## Entities and aggregates

### AnalysisSession

Consistency boundary for one training conversation around one starting position. It owns the player assessment, plan, candidate seeds, generated lines, coaching review references, and decision record.

### PositionSnapshot

Immutable canonical board state. It owns FEN, side to move, position hash, and derived legal context.

### ScenarioLine

Ordered legal plies from one starting position. It owns source ordering, horizon, terminal/incomplete status, and per-ply provenance.

### ProviderRun

One request to a modeled or engine provider. It owns request ID, provider identity, input position hash, configuration, status, and returned move/error.

### ExternalProbe

One bounded automated Lichess API game lifecycle to observe an external bot move. It owns bot identity, position hash, challenge/game identifiers, relay moves when needed, observed move, probe ID, cleanup outcome, timestamp, and status.

### PuzzleAttempt

Future aggregate for puzzle mode. It owns puzzle position, candidate answer sequence, tactical facts, and result classification.

### PatternAssessment

An immutable analysis result for one `PositionSnapshot` and `PatternFamily`. It owns similarity, progress, evidence, reachability context, model version, and the separate forced-mate status.

### CacheEntry

A versioned reusable value keyed by canonical position state, namespace, provider/model configuration, and policy version. It is not authoritative chess truth until its stored moves and provenance pass the same validation gates as fresh provider output.

## Value objects

- `Fen`, `Pgn`, `SanMove`, `UciMove`.
- `PositionHash`, `RunId`, `RequestId`.
- `ProviderIdentity`, `ScenarioHorizon`, `PlyIndex`.
- `MoveProvenance`, `LegalMove`, `PositionFacts`.
- `ZobristPositionKey`, `RuleContext`, `HistorySignature`.
- `PatternFamily`, `PatternProgress`, `HumanReachability`.
- `AnalysisCacheKey`, `CacheEntry`.

## Domain services

- `PositionIngestService`: validates raw position input and freezes it.
- `PositionFactsService`: derives material, legal checks, captures, terminal state, and tactical notes.
- `CandidateSeedPolicy`: accepts or rejects first moves.
- `HumanPathPolicy`: computes expected source sequence.
- `ScenarioLineService`: appends validated plies and stops on terminal/error states.
- `ContractPolicy`: checks preconditions, postconditions, and invariants.
- `PatternProgressPolicy`: scores structured progress without making legality decisions.
- `CacheReusePolicy`: accepts only compatible exact or partial cache entries.

## Invariants

- No move is accepted without legality in the current position.
- No scenario ply exists without MoveProvenance.
- External bot provenance applies only to observed moves.
- Maia and Stockfish sources are not interchangeable in HumanPath.
- A Decision is not a PlatformCommand.
- Provider failures produce explicit incomplete states, never invented moves.
- Zobrist identity never replaces rule/history context.
- Forced mate is separate from Pattern similarity and disables further beauty steering.
