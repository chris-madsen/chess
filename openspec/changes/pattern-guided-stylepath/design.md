# Design: Pattern-guided StylePath with state cache

## Context map

```text
StylePath / Scenario Analysis
        -> Pattern Intelligence
        -> Analysis Cache port
        -> Engine Execution ports
```

Pattern Intelligence consumes validated `PositionSnapshot` and provenance-bearing lines. It does not call UCI, Maia, filesystem, HTTP, or a database directly.

## Position identity

`ZobristPositionKey` is derived from piece placement, side to move, castling rights, and en-passant state. The existing SHA-256 `PositionHash` remains a compatibility and audit identifier; it is not the transposition key.

`RuleContext` is kept beside the Zobrist key and contains the halfmove clock and, when an input contains move history, a history signature. This prevents a board-only hit from silently changing repetition- or history-sensitive behavior.

## Cache namespaces

- `POSITION_EVALUATION`: engine evaluation/candidate data.
- `MAIA_RESPONSE`: human-model response keyed by model, Elo, runtime configuration, and history when enabled.
- `PATTERN_ASSESSMENT`: symbolic/embedding pattern facts keyed by pattern model version.
- `ROLLOUT_SUFFIX`: a complete reusable continuation keyed by all provider and policy configuration.

An exact hit may reuse the complete value. A partial hit may reuse only compatible facts; Maia responses and human reachability must be recalculated when Elo or history-sensitive settings differ.

## Runtime stages

1. Build a candidate pool from CSTal best move and, when available, external MultiPV sources.
2. Look up compatible state and suffix entries.
3. Run missing CSTal × Maia rollouts to terminal state, timeout, or configured horizon.
4. Calculate pattern similarity/progress and human reachability.
5. Verify forced mate independently.
6. Use pattern steering only before a verified forced mate; preserve the original line and provenance in all cases.

The first code increment exposes the pure identity and cache port. Persistent/shared storage and provider orchestration are subsequent adapters using the same contract.
