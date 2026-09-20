## Requirement: Lesson evidence is measured from the completed line

The system SHALL use calibrated pattern evidence and complete future positions when scoring a lesson line, and SHALL NOT infer evidence from a target label alone.

### Scenario: Target label honesty
- GIVEN a branch launched for a target family
- WHEN its completed continuation no longer supports that family
- THEN its PatternClarity remains low rather than receiving an artificial floor

## Requirement: Candidate ranking covers all distinct completed lines

The system SHALL deduplicate and rank discovery, target, and plain Tal lines together.

### Scenario: Plain Tal wins
- GIVEN a plain ABSURD or EXTREME line with the best eligible lesson profile
- WHEN lesson candidates are ranked
- THEN that line may become the recommended lesson

## Requirement: Technical conversions remain visible to the scorer

The system SHALL penalize prolonged promotion conversion even when the line eventually checkmates.
