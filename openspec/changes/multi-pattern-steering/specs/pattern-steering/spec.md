## Requirement: Fixed target steering

The production steering path SHALL accept an optional fixed `PatternFamily`.

### Scenario: Fixed family

- GIVEN a target family is supplied
- WHEN an attacker-side decision is evaluated
- THEN every candidate is ranked using that family
- AND Maia defender plies and Tal tactical gating remain unchanged.

## Requirement: Bounded parallel target lines

The CLI SHALL support up to five independent target lines and SHALL preserve
the target family in live and final output.

### Scenario: Thresholded target output

- GIVEN multiple target lines are calculated
- WHEN a line reaches the configured affinity threshold
- THEN it is shown in the final target set
- AND target lines are ordered by their maximum observed affinity
- AND no more than five target lines are run.

