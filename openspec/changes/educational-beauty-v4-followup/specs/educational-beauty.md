# Educational beauty semantics

## Requirements

### Fixed target identity

When a target family is supplied to Pattern steering, every evaluated
candidate and every resulting decision trace uses that family, even if another
family has a higher incidental affinity.

### Evidence labels

Lesson analysis SHALL use `functionalContribution` and
`tacticallySupported` for sacrifice evidence. It SHALL NOT expose inferred
intent as a causal or soundness claim.

### Geometry

`LINE_OPENING` requires a verified cleared ray to the defending king.
`REMOVAL_OF_DEFENDER` requires the captured piece to attack a later tactical
destination in the replayed position.

### Promotion conversion

A line with a promotion followed by a long non-forcing conversion receives a
positive promotion-grind penalty even when the final position is checkmate.
