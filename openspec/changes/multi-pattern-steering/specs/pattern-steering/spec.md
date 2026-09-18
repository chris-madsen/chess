## Requirement: Fixed target steering

The production steering path SHALL accept an optional fixed `PatternFamily`.

### Scenario: Fixed family

- GIVEN a target family is supplied
- WHEN an attacker-side decision is evaluated
- THEN every candidate is ranked using that family
- AND Maia defender plies and Tal tactical gating remain unchanged.

## Requirement: Bounded parallel target lines

The CLI SHALL discover all unique target families that cross the affinity
threshold, evaluate no more than three target branches concurrently, and SHALL preserve
the target family in live and final output.

### Scenario: Thresholded target output

- GIVEN multiple target lines are calculated
- WHEN a family reaches the configured affinity threshold
- THEN it becomes eligible for bounded target evaluation
- AND the final target set contains the three shortest completed terminal lines,
  measured from the original discovery start position
- AND unfinished or failed branches are retained only as diagnostics when fewer
  than three terminal lines exist.
