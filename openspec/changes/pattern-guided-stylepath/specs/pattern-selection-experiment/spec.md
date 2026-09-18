# Capability: PatternSelectionExperiment

## Requirement: Do not use MultiPV in the MVP

The MVP SHALL compare the existing CSTal ABSURD and CSTal EXTREME StylePath trajectories and SHALL NOT require MultiPV, a large candidate pool, or CSTal source changes.

### Scenario: Produce two existing trajectories

- GIVEN a valid dataset position and configured Maia opponent
- WHEN the experiment runs
- THEN it requests one ABSURD trajectory and one EXTREME trajectory
- AND every returned ply retains its original provenance

## Requirement: Select using prefix information only

The Pattern selector SHALL score only the configured prefix before selecting a trajectory.

### Scenario: Avoid future leakage

- GIVEN two complete trajectories
- AND a prefix limit
- WHEN the selector chooses a treatment line
- THEN assessments after the prefix are not read by the selector
- AND the complete trajectories are used only for post-selection evaluation

## Requirement: Keep outcome facts independent

The experiment SHALL report `PatternMatch`, `TerminalMate`, and `ForcedMateVerification` separately.

### Scenario: Forced mate is unavailable

- GIVEN a line with a pattern match and terminal checkmate
- AND no independent verifier is configured
- WHEN the outcome is evaluated
- THEN `ForcedMateVerification` is `UNAVAILABLE`
- AND `BeautifulForcedCombination` is false

## Requirement: Require statistical evidence

The report SHALL compare fixed baseline, Pattern treatment, and deterministic control arms.

### Scenario: Corpus is too small

- GIVEN fewer than 300 independent cases
- WHEN the report is generated
- THEN its status is `INCONCLUSIVE`
- AND it SHALL NOT claim that Pattern Layer improved the result.

### Scenario: Treatment improvement is accepted

- GIVEN at least 300 independent cases
- AND treatment improves the primary metric by at least five percentage points
- AND the paired 95% confidence interval lower bound is above zero
- AND completion safety has not regressed
- WHEN the report is generated
- THEN its status is `SUCCESS`.
