# Design

`src/domain/lessons` owns the immutable `LessonProfile` and motif/value types.
`src/application/use-cases/analyze-combination.ts` replays a `ScenarioLine`
from its analysis root and extracts continuation-only features. It never reads
the SAN prefix in `PositionSnapshot.pgn` for scoring.

`rank-lesson-lines.ts` applies eligibility and tiered deterministic ranking:
mate status, educational length budget, forcingness, causal preparation,
technical penalties, and then stable identifiers. Mate-family names remain
descriptive metadata rather than beauty weights.

Pattern target branches store the resulting profile and rank after exact
full-line deduplication. Existing live rendering remains compact; the final
renderer may expose the profile reasons and the optional shorter Tal
alternative.

Calibration uses scores from actual near-terminal trajectory states rather than
the maximum score anywhere in a positive trajectory.
