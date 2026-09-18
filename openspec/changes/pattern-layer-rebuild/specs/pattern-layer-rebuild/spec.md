# Pattern Layer Rebuild Specification

## Requirement: Fix attacker identity

The Pattern Layer SHALL receive an explicit attacker side for an analysis and SHALL preserve it across all plies, including Maia replies.

### Scenario: Alternating StylePath plies

- GIVEN a white attacker and alternating CSTal/Maia positions
- WHEN twelve plies are assessed
- THEN every PatternPositionContext reports white as attacker
- AND no context derives attacker identity from the current side to move

## Requirement: Discover families at runtime

Runtime Pattern retrieval SHALL work without a supplied family label. Labeled family assessment SHALL remain a separate offline benchmark operation.

### Scenario: Runtime family retrieval

- GIVEN a legal position and explicit attacker context
- WHEN runtime retrieval is requested
- THEN it returns ranked Pattern candidates with evidence
- AND it does not require a target family input

## Requirement: Use relational family matchers

The first-wave matchers SHALL distinguish Anastasia, Arabian, Back Rank, Boden, and Smothered using family-specific relations, missing conditions, and contradictions. A generic edge-king signal SHALL NOT be sufficient for Back Rank.

## Requirement: Canonicalize relevant geometry

Canonical Pattern identity SHALL be built after relevance filtering and SHALL ignore irrelevant background pieces while preserving relevant escape, attack, defense, pin, x-ray, capture, and interposition relations.

## Requirement: Isolate cache namespaces

Pattern context and Pattern assessment cache keys SHALL ignore move history. Maia and rollout cache keys SHALL include history only when their provider policy requires it. Provider configuration and model versions SHALL remain part of cache identity.

## Requirement: Preserve puzzle trajectories

Dataset ingest SHALL preserve solution moves, trajectory states, distance-to-terminal, and expected terminal metadata. Legacy string solution move input MAY be normalized to the canonical array form.

## Requirement: Separate benchmark metrics

Recognizer precision/recall/F1, hard-negative rejection, proximity metrics, and steering outcomes SHALL be reported independently. Calibration results SHALL NOT be included in held-out evaluation metrics.

## Requirement: Bounded batch execution

The authenticated batch API SHALL execute independent cases with bounded concurrency, preserve every case ID, and report incomplete/provider-error cases explicitly. Posting a batch case SHALL NOT cancel sibling batch cases. Existing live StylePath job cancellation semantics SHALL remain unchanged.
