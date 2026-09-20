# Educational beauty semantics

## Requirements

### Preferred target identity

When a target family is supplied to Pattern steering, it is the preferred
family for normal candidate evaluation and decision traces. A branch may
escape to a materially stronger calibrated family when it is stalled or a
repetition guard is active; it SHALL NOT switch merely because of a small
incidental-affinity difference.

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

### Repetition guard

Steering and lesson analysis SHALL identify repeated positions using board,
side to move, castling rights, and en-passant state. FEN halfmove and fullmove
counters SHALL NOT affect repetition detection.

### Conversion urgency

When a line is stalled or repeats, an available trusted mate-class candidate
has priority over pattern affinity, with the shortest reliable mate distance
preferred. In ordinary positions, mate-class selection remains urgency-first;
educational alternatives are compared after complete lines are generated.

### Output visibility

The normal CLI SHALL omit completed target branches whose lesson profile is
`SUPPRESSED`. The JSON artifact retains them for diagnostics, and `--debug`
may retain raw discovery and target frames in the final terminal display.
