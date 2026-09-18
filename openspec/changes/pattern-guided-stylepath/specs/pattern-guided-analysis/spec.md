# Capability: Pattern-guided StylePath analysis

## Requirement: Preserve existing StylePath semantics

Pattern analysis SHALL consume the existing provenance-bearing StylePath data and SHALL NOT replace Maia responses, invent moves, or relabel a mixed-source line as a single-engine principal variation.

### Scenario: Pattern analysis receives a StylePath line

- GIVEN a legal StylePath line with provenance on every ply
- WHEN Pattern Intelligence analyzes it
- THEN the original line remains available unchanged
- AND pattern facts refer to the supplied line and positions

## Requirement: Use family-level pattern identity

Pattern analysis SHALL represent a pattern family and structured evidence rather than requiring an exact historical FEN match.

### Scenario: Background material differs

- GIVEN two legal positions with the same relevant motif geometry and different irrelevant background material
- WHEN the same PatternFamily is evaluated
- THEN the evaluator may produce compatible evidence
- AND it SHALL NOT require identical FEN strings

## Requirement: Canonicalize reusable state

The system SHALL identify reusable chess state using piece placement, side to move, castling rights, and en-passant state, while keeping rule and history context separate.

### Scenario: Transposition reaches the same state

- GIVEN two move histories that reach the same board state and legal context
- WHEN cache keys are built
- THEN their Zobrist position keys are equal
- AND compatible analysis may be reused

### Scenario: Castling or en-passant differs

- GIVEN positions with the same piece placement but different castling or en-passant state
- WHEN cache keys are built
- THEN their Zobrist position keys differ

## Requirement: Isolate provider configuration

Cache entries SHALL include provider/model/policy configuration fingerprints sufficient to prevent incompatible reuse.

### Scenario: Maia Elo changes

- GIVEN the same position analyzed for two Maia Elo values
- WHEN Maia cache keys are built
- THEN the keys differ
- AND a response for one Elo is not an exact hit for the other Elo

## Requirement: Fail safely on cache miss or failure

Cache miss or cache I/O failure SHALL cause an explicit recomputation path or structured degraded result; it SHALL NOT create a move, evaluation, provenance record, or successful analysis that was not produced.

## Requirement: Forced mate takes precedence

Pattern steering SHALL stop once an independent verifier has established a forced mate, and the mate result SHALL remain separately labelled from pattern similarity.
