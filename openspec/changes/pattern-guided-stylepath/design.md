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

The MVP deliberately does not build a candidate pool or call MultiPV:

1. Run the existing CSTal ABSURD + Maia and CSTal EXTREME + Maia lines.
2. Look up compatible PatternAssessment values in the state cache.
3. Calculate pattern similarity/progress using only a configured prefix.
4. Select ABSURD or EXTREME without reading the rest of either line.
5. Evaluate the selected full line after selection using terminal-state facts and an independent forced-mate verifier.
6. Compare fixed baseline, Pattern treatment, and deterministic control arms with paired metrics.

Only a positive MVP result may justify a later candidate-pool/MultiPV increment.

`PatternMatch`, `TerminalMate`, and `ForcedMateVerification` are separate facts. A `BeautifulForcedCombination` is true only when all three are true. Pattern scoring never establishes forced mate.

The runner emits versioned JSONL records containing the dataset case, provider configurations, both complete lines, prefix selection scores, outcomes, and cache statistics. Fewer than 300 independent cases or unavailable forced-mate verification produce `INCONCLUSIVE`, never a positive claim.
