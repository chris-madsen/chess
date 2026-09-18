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

## Requirement: Use the Lichess mate-theme core catalog

The MVP catalog SHALL expose the 19 Lichess mate themes and 15 extended named mate families as independent `PatternFamily` values with a canonical key, display name, and aliases. Source keys and direct training URLs SHALL remain application-boundary metadata rather than domain dependencies. The catalog SHALL remain separate from the 15 tactical motifs and any future unnamed structural clusters.

### Scenario: Assess a catalog family

- GIVEN a legal position and any family from the Lichess mate-theme core catalog
- WHEN Pattern Intelligence evaluates that family
- THEN it returns a bounded `PatternAssessment` with that family ID and structured evidence
- AND the scorer model version identifies the catalog-aware symbolic model
- AND the assessment SHALL NOT be treated as `TerminalMate` or `ForcedMateVerification`

### Scenario: Extended family assessment

- GIVEN a legal position and any family from the extended named family catalog
- WHEN Pattern Intelligence evaluates that family
- THEN it returns the same bounded `PatternAssessment` shape as for the core catalog
- AND its catalog tier remains `MVP_EXTENDED`

### Scenario: Dataset family validation

- GIVEN a JSONL dataset entry
- WHEN its family is parsed
- THEN the family is accepted only if it is present in the canonical catalog
- AND the parser SHALL NOT maintain a second independent list of supported family IDs

## Requirement: Keep tactical motifs separate

The MVP SHALL expose the planned tactical motifs as a separate `TacticalMotif` catalog. A tactical motif SHALL NOT be accepted as a `PatternFamilyId` and SHALL NOT be silently converted into a mating-family assessment.

### Scenario: Motif taxonomy lookup

- GIVEN the tactical motif catalog
- WHEN a caller looks up `SACRIFICE`
- THEN it receives motif metadata
- AND no `PatternAssessment` is created without an explicit mating-family target

## Requirement: Canonicalize pattern geometry

Pattern geometry SHALL be represented relative to the defending king and SHALL canonicalize file/rank mirror symmetries and attacker/defender roles. Canonicalization SHALL not use an exact FEN string as the pattern identity.

### Scenario: Mirrored geometry

- GIVEN two legal positions that differ only by a board-file mirror
- WHEN their canonical pattern positions are built
- THEN their canonical keys are equal
- AND the defending king is represented at relative coordinate `(0, 0)`

## Requirement: Preserve dataset provenance and hard negatives

Every dataset entry SHALL include a dataset version, example kind (`positive`, `hard_negative`, or `control`), and a source-position hash that matches the ingested FEN. A mismatched hash SHALL be rejected before engine work.

## Requirement: Validate independent forced-mate proofs

The forced-mate verifier ACL SHALL reject proofs for non-checkmate terminal positions, missing provider/limits, or a terminal-position hash mismatch. It SHALL never upgrade a pattern score or terminal mate fact into `VERIFIED` without an independent provider proof.

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
