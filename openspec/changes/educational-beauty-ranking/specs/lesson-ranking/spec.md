## Requirement: continuation-only educational scoring

The system SHALL score only generated plies after the final position supplied
by `game.txt`. It SHALL preserve the input history for legal replay and
rendering, but SHALL NOT include that history in lesson length, sacrifice,
forcingness, repetition, or beauty metrics.

### Scenario: raw game root

- GIVEN a raw PGN with an existing prefix and a generated continuation
- WHEN the continuation is analyzed
- THEN all lesson metrics start at the raw PGN final position

## Requirement: explainable lesson ranking

The system SHALL rank complete unique lines using explicit continuation
length, forcingness, sacrifice, causal preparation, pattern clarity, and
technicality signals. A PatternFamily name SHALL NOT by itself determine
beauty.

### Scenario: ordinary mating geometry

- GIVEN a short forcing line with a causal exchange sacrifice and an ordinary
  queen-and-bishop mate
- WHEN lines are ranked
- THEN the line MAY outrank a shorter but quiet pattern-only line

## Requirement: shorter Tal alternative

When a distinct Tal baseline is more than seven generated full moves shorter
than the selected lesson and both lines are complete, the output SHALL expose
both lines. The comparison SHALL use full moves, not plies.

## Requirement: calibration distance

Positive-near calibration SHALL use the score of states whose actual
`distanceToTerminal` is within the near-terminal window, not the maximum score
from unrelated earlier trajectory states.
