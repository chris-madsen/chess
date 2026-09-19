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

## Requirement: Tal tactical gate

Pattern steering SHALL evaluate exploration candidates (such as Patricia) through a CSTal/Tal tactical gate before Pattern ranking. Candidates originating from the trusted CSTal style engines ABSURD and EXTREME SHALL remain selectable without being vetoed by that gate. A rejected exploration candidate SHALL NOT be selected even when its PatternProgress is higher than an accepted candidate's progress.

### Scenario: Tal veto wins over Pattern similarity

- GIVEN exploration candidate A has higher PatternProgress but is rejected by the Tal gate
- AND candidate B is accepted by the Tal gate
- WHEN the steering decision is made
- THEN candidate B SHALL be the only selectable result
- AND PatternAssessment SHALL NOT declare candidate A unsafe or safe by itself

### Scenario: Trusted CSTal ideas bypass self-veto

- GIVEN a candidate originates from CSTal ABSURD or CSTal EXTREME
- WHEN the steering decision is made
- THEN the candidate SHALL not be submitted to the Tal gate
- AND the candidate SHALL remain selectable for Maia response and Pattern ranking

## Requirement: Iterative Tal-Maia steering

Production steering SHALL repeat candidate generation, Tal gating, and Pattern family progress on every attacker-side ply. Defender-side plies SHALL be supplied by Maia according to HumanPath semantics. A generic Stockfish continuation SHALL NOT replace the Tal candidate loop.

### Scenario: Maia ranking is repeatable

- GIVEN the same position history, Maia model, Elo, and ranking configuration
- WHEN the ranking provider is queried repeatedly
- THEN it SHALL use deterministic top-1 policy settings for candidate ranking
- AND a stochastic play sample SHALL NOT be used as the sole evidence for attacker candidate selection

## Requirement: Candidate provenance and diagnostics

The canonical candidate pool SHALL merge duplicate UCI moves while retaining every proposing provider provenance. Pattern steering diagnostics SHALL include rejected exploration candidates with their Tal decision, proposing providers, and Maia reply when one was evaluated.

### Scenario: Duplicate proposals retain source identity

- GIVEN Patricia and CSTal propose the same legal UCI move
- WHEN the candidate pool deduplicates the move
- THEN the resulting candidate SHALL retain both proposing provenance records
- AND trusted-CSTal detection SHALL consider every retained proposer

## Requirement: Applicable geometry requirements

MateGeometry coverage and blocker requirements SHALL normalize over applicable on-board squares only. Pattern role assignment SHALL use piece-aware reachability and select the maximum-scoring non-conflicting assignment rather than greedily consuming pieces.

### Scenario: Edge geometry excludes off-board requirements

- GIVEN a target king is on an edge or corner
- WHEN a descriptor contains relative coverage or blocker requirements
- THEN off-board relative squares SHALL be excluded from the denominator
- AND mirrored equivalent positions SHALL receive equivalent geometry scores

### Scenario: Repeated attacker decisions

- GIVEN a non-terminal position and a bounded horizon
- WHEN PatternSteeredTalPath is generated
- THEN attacker plies SHALL be committed from Tal-gated candidate decisions
- AND intervening defender plies SHALL be sourced from Maia
- AND every committed ply SHALL retain MoveProvenance.

## Requirement: Legacy separation

The post-hoc PatternSelectionExperiment and legacy scorer SHALL remain explicitly labelled legacy benchmark operations. The production steering CLI SHALL invoke iterative PatternSteeredTalPath and SHALL NOT rank completed StylePath lines after the fact.

## Requirement: Continuous attractor semantics

Production steering SHALL use soft `PatternAffinity` for steerable families. A
matcher retrieval hints MAY reduce retrieval cost but SHALL NOT semantically replace
the affinity with zero. Display states such as `far` and `near` SHALL remain
descriptive labels, not control-flow gates.

### Scenario: Low-affinity steering

- GIVEN all Tal-safe candidates have affinity below the display threshold
- WHEN steering ranks candidates
- THEN it still returns the candidate with the strongest post-Maia affinity
- AND it does not report pattern-not-found/provider failure

## Requirement: Tal safety and lifecycle

The tactical gate SHALL use a verified UCI `searchmoves` implementation when
that capability is available. For CSTal 2.07, whose deployed binaries ignore
`searchmoves`, the ACL SHALL apply each legal candidate first and evaluate the
resulting defender-to-move position with an identical search budget
(`POST_MOVE_EVALUATION`). Scores SHALL be normalized to the attacker
perspective, compared with an explicit mate/cp comparator and allowed-loss
policy, and at least the best Tal candidate SHALL be preserved. Candidate
generators, tactical gates, and Maia providers SHALL be disposed in a
`finally` boundary for every local or remote case.

### Scenario: Terminal candidate

- WHEN a selected attacker candidate produces checkmate or stalemate
- THEN Maia SHALL NOT be called on the terminal position
- AND the resulting ScenarioLine status SHALL be `Terminal`.

## Requirement: Opt-in remote steering mode

The pattern batch API SHALL accept `mode: "steering"` as an explicit opt-in. Omitted mode and `mode: "posthoc"` SHALL preserve the existing ABSURD/EXTREME batch contract.

### Scenario: Remote iterative steering

- GIVEN an authenticated batch request with `mode: "steering"`
- WHEN a bounded Windows worker processes a case
- THEN it runs the iterative Tal gate, Pattern progress, and Maia defender loop
- AND it returns a validated `PatternSteeredTalPath` result
- AND provider errors or incomplete lines are not reported as successful
