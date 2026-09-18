# Delta Review — Pattern Steering + Top-3 shortest + MateGeometry scorer redesign

Repository: https://github.com/chris-madsen/chess/tree/master  
Reviewed HEAD: `99afc09febe1b27841c60d00f5b033be6b2ff324`  
Previous reviewed HEAD: `e1fe6d875c1632eae553552e49a9d1709a74c33b`  
Date: 2026-09-18

Delta commits:

```text
59150d9 limit pattern targets to fastest three
99afc09 disable unreliable linux ansi redraw
```

---

# 0. Executive summary

The previous review needs one important correction.

The product policy is **not**:

```text
after discovery, take top-5 highest-affinity patterns
```

The intended policy is now:

```text
trigger target branches when affinity crosses the configured threshold
and keep/output three shortest target lines
```

The current code partially implements that intent:

```ts
export const MAX_PATTERN_TARGETS = 3;
```

and final target ordering is:

```text
Terminal first
↓
shorter target line first
↓
family-id tie-break
```

However, the current implementation is **not yet globally "top-3 shortest"**.

It currently behaves as:

```text
first 3 unique families that cross threshold
↓
run those 3 branches
↓
sort those same 3 by branch length
```

One semantic gap remains:

1. A fourth family that crosses the threshold later but would produce a much shorter mating line is never run.

If the intended product meaning is truly:

> among all eligible threshold-hit pattern branches, show the three shortest target lines,

then target selection still needs one more redesign.

Separately, the current named-pattern scorers remain too generic. This is a real semantic problem and should be fixed by replacing generic feature mixtures with **family-specific continuous MateGeometry scorers**, while preserving the desired non-binary attractor behavior.

---

# 1. What changed in the latest delta

## FIXED — target count is now 3

Current code:

```ts
export const MAX_PATTERN_TARGETS = 3;
```

`registerPatternTarget()` also caps `maxTargets` at 3.

This matches the new product limit.

## FIXED — final display order prefers terminal/shorter branches

After target branches finish, code now sorts:

```text
Terminal target lines first
then fewer `line.plies`
then family id
```

This is materially different from the old affinity-order wording.

## UI-only delta

`99afc09` disables unreliable Linux ANSI redraw. This does not change steering semantics.

---

# 2. IMPORTANT — current code is "first 3 hits, then shortest", not global top-3 shortest

Current registration has:

```ts
if (
  event.affinity < threshold
  || alreadyRegistered
  || targets.length >= limit
) {
  reject;
}
```

As soon as three families have crossed threshold, all later families are discarded.

Example:

```text
Pattern A crosses 0.97 first
→ branch takes 14 plies

Pattern B crosses second
→ branch takes 12 plies

Pattern C crosses third
→ branch takes 10 plies

Pattern D crosses later
→ would mate in 3 plies
```

Current code never runs D.

Final output is:

```text
C 10
B 12
A 14
```

not:

```text
D 3
C 10
B 12
```

So the commit name:

```text
limit pattern targets to fastest three
```

is stronger than what the implementation actually guarantees.

---

# 3. Recommended implementation for true top-3 shortest

There is an unavoidable tradeoff:

> You cannot know which three branches are shortest without evaluating more than three candidates.

If computation must be strictly limited to three branches, then the product behavior must honestly be named:

```text
first 3 threshold-hit targets, ordered by resulting length
```

If the product requirement is truly:

```text
top 3 shortest among all eligible pattern targets
```

then use a bounded search scheduler.

## Recommended algorithm

### Phase A — discovery

During the discovery line, record every unique family that reaches threshold:

```ts
TargetCandidate {
  family,
  triggerAffinity,
  triggerPly,
  triggerPosition,
  prefixPlies
}
```

Do not immediately discard candidate 4+.

There are only 19 steerable families, so this candidate set is naturally bounded.

### Phase B — bounded branch evaluation

Run at most 3 branch workers concurrently.

For every threshold-hit family:

```text
fixed-family steering from trigger position
↓
finish / terminal / horizon / error
↓
compute totalPlies
```

Maintain:

```text
bestThreeTerminalBranches
```

### Phase C — pruning

Once three terminal branches exist, a running branch can be stopped if:

```text
prefixPlies.length + currentBranchPlies
>=
worst totalPlies among current top 3
```

because it can no longer become shorter.

This gives bounded compute without permanently throwing away later candidates before their length is known.

### Final output

```text
top 3 terminal branches
ordered by total root-to-terminal plies
```

If fewer than three terminal branches exist, optionally append non-terminal branches after them as diagnostics.

---

# 4. The OpenSpec is now stale

Current spec still says:

```text
up to five independent target lines
```

and:

```text
target lines are ordered by maximum observed affinity
```

That no longer matches current code or intended policy.

Update the spec to state exactly one of:

## If policy is first-3 threshold hits

```text
The first three unique families crossing the affinity threshold
are evaluated, and completed target lines are displayed shortest-first.
```

## If policy is true top-3 shortest

```text
All unique threshold-hit families are eligible.
The system returns the three shortest completed target continuations,
measured from the original discovery start position.
```

Do not leave "five / highest affinity" in the spec.

---

# 5. What "named-pattern scorers are too generic" means

This remains a real issue.

For many families the current scorer asks questions like:

```text
Does attacker have a rook?
Does attacker have a knight?
Does some knight control an escape square?
Does some rook attack the king zone?
Are several escape squares unavailable?
```

These are useful **generic mating-pressure features**, but they do not uniquely describe a named mating family.

The clearest example in current code:

```text
HOOK
```

and:

```text
VUKOVIC
```

have effectively the same conditions:

```text
rook exists
knight exists
knight controls an escape
rook attacks king zone
```

Therefore the same position can naturally receive:

```text
HOOK     ≈ high affinity
VUKOVIC  ≈ high affinity
```

even when the actual piece geometry corresponds to only one of them.

The issue is not that affinity is continuous.

Continuous affinity is correct.

The issue is that the scorer is measuring:

```text
generic rook+knight mating pressure
```

instead of:

```text
continuous closeness to THIS named mating geometry
```

---

# 6. Do NOT fix this by returning to exact matching

Wrong fix:

```text
if exact Hook geometry exists:
    1
else:
    0
```

That would recreate the old failure:

```text
not yet a pattern
→ zero
→ planner cannot move toward it
```

The correct model is:

```text
family-specific geometry
+
continuous role proximity
```

Example:

```text
Hook affinity:
0.12
→ 0.28
→ 0.49
→ 0.74
→ 0.93
→ 1.00-ish
```

while a different family receives its own independent geometric score.

---

# 7. Replace generic PatternRelation scoring with MateGeometryDescriptor

The production abstraction should become something like:

```ts
type MateGeometryDescriptor = Readonly<{
  family: PatternFamilyId;
  variants: readonly MateGeometryVariant[];
}>;

type MateGeometryVariant = Readonly<{
  kingRegion: KingRegionDescriptor;
  roles: readonly MateRole[];
  requiredCoverage: RelativeSquareMask;
  preferredBlockers: RelativeSquareMask;
  forbiddenGeometry?: RelativeSquareMask;
}>;
```

A role describes **what a piece does relative to the defending king**, not whether there is merely a rook somewhere.

For example:

```ts
type MateRole = Readonly<{
  id: string;
  allowedPieceTypes: readonly PatternPieceType[];
  targetRelativeSquares?: readonly RelativeSquare[];
  requiredControlSquares?: RelativeSquareMask;
  requiredCorridor?: CorridorDescriptor;
  criticality: "critical" | "supporting";
}>;
```

---

# 8. Score roles continuously

For each family, score separate geometric components.

Example generic structure:

```text
KingRegionAffinity        0..1
PrimaryRoleAffinity       0..1
SupportRoleAffinity       0..1
RequiredCoverageAffinity  0..1
BlockerAffinity           0..1
CorridorAffinity          0..1
ContradictionPenalty      0..1
```

Then combine them.

Do NOT use only a plain average, because a missing critical mating role can still produce an artificially high score.

A better continuous form:

```text
base =
  0.20 * kingRegion
+ 0.25 * primaryRole
+ 0.20 * supportRole
+ 0.20 * requiredCoverage
+ 0.10 * blockers
+ 0.05 * corridor

criticalFactor =
  0.20 + 0.80 * min(primaryRole, requiredCoverage)

affinity =
  clamp(base * criticalFactor * (1 - contradictionPenalty))
```

This remains continuous.

A missing critical role does not make affinity exactly zero, but it prevents generic geometry from reaching absurd values like `0.97`.

---

# 9. Role assignment should be relative to the defending king

Canonicalize the board around the defender king.

Instead of:

```text
white rook on f7
black king on h8
```

represent:

```text
rook at relative (-2, -1)
king at (0,0)
```

Then mirrored/color-swapped versions map to the same pattern variant.

This gives family semantics without FEN memorization.

---

# 10. Use actual family role slots, not generic piece counts

Bad current-style feature:

```text
has knight = 1
```

Better:

```text
best attacking knight's affinity
to the family-specific knight role
```

Example conceptually:

```text
ideal role square           1.00
one useful move away        0.70
two useful moves away       0.40
geometrically remote        0.10
```

Likewise a rook/queen role should measure closeness to the actual mating corridor, not merely:

```text
heavy piece attacks some king-zone square
```

---

# 11. Use soft role matching, not a second chess engine

Pattern Layer should NOT calculate:

```text
is this sacrifice sound?
can defender tactically refute this?
is this pin valuable?
```

Tal already owns those questions.

Pattern Layer may calculate:

```text
how close is a piece to a family role?
does it cover the family-required escape mask?
is the correct corridor geometrically present?
are the characteristic defender blockers present?
```

This is geometry, not chess evaluation.

---

# 12. Derive each family descriptor from the existing Lichess corpus

Do not invent all 19 templates from memory.

The repository already has family-labelled Lichess trajectories.

Use them as the source of truth.

For each family:

```text
verified positive terminal positions
+
1 ply before
+
2 plies before
+
3-4 plies before
```

Canonicalize around the defending king and inspect:

```text
piece-role relative squares
escape-square masks
own-piece blockers
mating corridors
coverage masks
allowed substitutions
common mirrored variants
```

Then build the minimal family descriptor that explains those positives.

This avoids turning naming folklore into code.

---

# 13. Build a per-family fixture pack

For every one of the 19 steerable families, create:

```text
20-50 verified positive terminal/near-terminal positions
20-50 trajectory predecessor positions
20-50 hard negatives
confusing-family negatives
```

The most important hard negatives are not random positions.

They should be nearly identical geometry with one family-critical role broken.

Example structure:

```text
positive:
correct family knight-role coverage

hard negative:
same board, knight moved so one characteristic square is no longer covered
```

This teaches/validates the **difference between named families**.

---

# 14. Add pairwise confusion tests

A named-family recognizer should explicitly test families that share material.

Examples from the current code:

```text
HOOK vs VUKOVIC
BODEN vs DOUBLE_BISHOP
ANASTASIA vs other rook+knight edge nets
DOVETAIL vs other queen confinement patterns
CORNER vs generic edge/corner mates
```

Test form:

```text
on verified HOOK positive:
HOOK affinity > VUKOVIC affinity + margin

on verified VUKOVIC positive:
VUKOVIC affinity > HOOK affinity + margin
```

The exact margin can be calibrated.

Without this, `0.97` target triggers can be duplicate aliases for the same generic geometry.

---

# 15. Remove `prefilter` as semantic vocabulary

Production scoring no longer uses `prefilter`, but the interface still exposes it.

That is dangerous because a future coding agent may reintroduce:

```text
prefilter false → affinity 0
```

Either remove it, or rename it:

```text
retrievalHint
```

with a hard invariant:

> Retrieval hints MUST NOT change PatternAffinity semantics.

---

# 16. Fix edge/corner normalization while rewriting scorers

Current:

```ts
edgeAffinity = 1 - distanceToEdge / 4
```

gives a central king nontrivial edge affinity.

Current:

```ts
cornerAffinity = 1 - nearestCornerDistance / 14
```

gives a central king an especially inflated corner affinity.

These should be corrected before calibrating named-family target thresholds, otherwise corner/edge families receive systematically inflated scores.

---

# 17. Better scorer architecture

Recommended pipeline:

```text
Position
↓
MateGeometryContext
  - defender king canonical origin
  - relative piece positions
  - escape occupancy mask
  - attacker coverage mask
  - defender coverage mask
  - corridor masks
↓
for each family
  for each allowed geometry variant
      assign actual pieces to family roles
      compute continuous role affinities
      compute required-square coverage
      compute blockers/corridors
      compute contradiction penalty
  take best variant
↓
PatternAffinity 0..1
```

Because the chessboard and number of roles are tiny, this is practically constant-time.

No ML is required for this stage.

---

# 18. Role assignment can be exhaustive and still O(1) in practice

A pattern may need:

```text
1 rook/queen role
1 knight role
1 king-region role
```

There are only a handful of candidate pieces.

For a fixed 64-square board, brute-forcing all role assignments is tiny.

You do not need a large graph engine or ANN search.

For each family variant:

```text
enumerate candidate piece assignments
↓
score assignment
↓
take maximum
```

That is simple, deterministic, and fast.

---

# 19. Do not interpret affinity as probability yet

Even after family-specific geometry is fixed:

```text
affinity 0.97
```

still means:

```text
very close to the family geometry
```

not:

```text
97% probability of mating via that family
```

A true probability is a later layer:

```text
PatternReachability(s,p,Elo,N)
=
P(reach family p within N plies
  under Tal steering + Maia(Elo))
```

That can eventually use rollout data.

---

# 20. Recommended rollout of scorer rewrite

Do not rewrite all 19 blindly in one giant patch.

## Phase 1 — create the descriptor framework

Implement:

```text
MateGeometryContext
MateGeometryDescriptor
MateRole
RelativeSquareMask
role affinity
coverage affinity
corridor affinity
contradiction penalty
```

## Phase 2 — convert the five current first-wave families

```text
ANASTASIA
ARABIAN
BACK_RANK
BODEN
SMOTHERED
```

Validate them against:

```text
positives
trajectory predecessors
hard negatives
pairwise confusion
```

## Phase 3 — convert the other 14 Lichess core families

Remove `corePolicies` as each family receives a real descriptor.

## Phase 4 — only then consider extended families

The 15 extended families should remain catalog-only until their descriptors have comparable validation.

---

# 21. Acceptance criteria for a named-family scorer

For each family:

```text
[ ] terminal positives score very high
[ ] predecessor affinity generally rises toward terminal
[ ] hard negatives drop materially
[ ] confusing sibling families do not tie systematically
[ ] no exact-match requirement
[ ] far positions still get continuous low affinity
[ ] one missing critical role cannot still yield ~0.97
[ ] mirrored/color-swapped valid variants score similarly
[ ] scorer contains no tactical soundness evaluation
```

---

# 22. Previous P0s that remain current at HEAD `99afc09`

The latest two commits touched target count/order and terminal rendering only.

Therefore these previous correctness findings remain relevant.

## P0 — Tal fallback can fail open

`TAL_BEST_CANDIDATE_FALLBACK` can still accept a candidate even when no trustworthy exact Tal score exists.

Fallback must only choose among exact-scored candidates.

If there are zero exact scores:

```text
return an error / no safe candidate
```

not:

```text
accepted = true
```

## P0 — real CSTal score perspective still needs binary verification

PostMoveTalGate assumes:

```text
SIDE_TO_MOVE score perspective
```

The real binary smoke test still needs to validate cp/mate score signs, not only bestmove availability.

## P0/P1 — discovery `Incomplete` must not become a "complete" benchmark case

Case success must require a non-error discovery line as well as valid target branches.

---

# 23. Previous P1s still relevant

- live target branches share engine/Maia sessions with discovery and can perturb state/order;
- one Maia reply is still only an approximation, not expected value over reply probabilities;
- failed target branches currently can fail the whole session;
- rejected Tal candidates are not preserved in decision traces;
- target branch workers share queued UCI providers and therefore are not truly parallel;
- timeout is still primarily `Promise.race`, not cooperative cancellation;
- generic Pattern context still exposes unused tactical relations (`PINS`, `XRAYS`, etc.) and should be narrowed to MateGeometry;
- engine/gate caching and single-flight remain future performance work.

---

# 24. Corrected priority after the latest commits

## P0 — correctness before trusting benchmark output

```text
1. Fix Tal fallback fail-open.
2. Verify real CSTal score perspective/sign.
3. Ensure Incomplete discovery cannot be reported complete.
```

## P1 — target-branch semantics

```text
4. Decide exact meaning:
   A) first 3 threshold hits, shortest-first
   OR
   B) true top-3 shortest across all eligible families.

5. If B:
   evaluate all threshold-hit family candidates with bounded concurrency,
   rank by total root-to-terminal plies.

6. Update stale OpenSpec ("five", "maximum affinity").
7. Make optional target branch failures per-target.
8. Isolate branch provider state from discovery.
```

## P1 — scorer semantics

```text
9. Introduce MateGeometryDescriptor.
10. Fix edge/corner normalization.
11. Convert first 5 families.
12. Add hard-negative + pairwise-confusion tests.
13. Convert remaining 14 steerable families.
14. Remove generic corePolicies.
15. Remove/rename semantic `prefilter`.
```

## P1/P2 — probabilistic and performance evolution

```text
16. Move from one Maia reply to top-k weighted replies.
17. Add multi-source candidate provenance.
18. Add engine/gate caches and single-flight.
19. Add cooperative cancellation.
20. Add near-O(1) family retrieval after scorer semantics are correct.
```

---

# 25. Bottom line

The new `top 3` change is valid as a product decision.

But the current implementation should be described precisely:

```text
first three unique threshold hits
then order those three by terminal status and branch length
```

It is **not yet** guaranteed to return the globally shortest three pattern lines, because later threshold-hit families are not evaluated once three targets have already been registered.

The named-pattern scorer problem is separate and more important for pattern quality.

The right fix is not exact matching and not more generic tactical features.

The right fix is:

```text
continuous,
family-specific,
king-relative MateGeometry scoring
```

derived and validated against the existing Lichess-labelled trajectories.

That preserves the entire attractor idea:

```text
far
→ closer
→ closer
→ near
→ target
```

while finally making:

```text
HOOK ≠ VUKOVIC
BODEN ≠ generic two-bishop pressure
ANASTASIA ≠ any rook+knight attack on an edge king
```

in the scorer itself.
