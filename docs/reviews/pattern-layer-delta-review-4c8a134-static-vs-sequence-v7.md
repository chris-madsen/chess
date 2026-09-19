# Pattern Steering Review — regression after MateGeometry + source-aware Tal gate

Repository: `chris-madsen/chess`  
Reviewed HEAD: `e7ffd60791a5f9dd2b53eba7664bdfdb8eb6b34b`  
Date: 2026-09-19

Relevant commits:

```text
4c8a134  replace generic scorers with all-family mate geometry
6e3b0cd  add pattern taxonomy and trajectory scoring
5ed25bc  disable redundant Tal gate for pattern steering
e7ffd60  make Tal gate source aware
```

Observed regression from the same `game.txt` start position:

```text
1. c4 Nf6 2. Nc3 g6 3. e4 Bg7 4. g3 d6 5. Bg2 O-O
6. Nge2 e5 7. O-O Be6 8. d3 Nc6 9. h3 Qc8 10. g4 Nd7
11. Kh1 Nd4 12. Nxd4 exd4 13. Nd5 Qd8 14. f4 c6
15. f5 cxd5
```

Current run eventually produced:

```text
...
25. Rxd4 g5
26. Bxe5 Qh5
27. Qxh5 ...
...
33. Qxh6#
```

and:

```text
No target reached 97%.
```

Earlier code produced a much more coherent mating line and identified a Morphy-family attractor.

---

# 1. Executive conclusion

There are several independent problems.

They must not be collapsed into “the source-aware Tal gate broke the system”.

The current evidence points to:

```text
P0  MateGeometry threshold/model mismatch:
    several core families cannot mathematically reach 0.97
    in their intended board regions.

P0  MateGeometry descriptor/context mismatch:
    requiredCoverage sometimes requests squares that
    coverageAffinity can never observe.

P0  Maia-response selection bias:
    each attacker candidate receives a separate Maia reply,
    and selection optimizes post-Maia PatternAffinity.
    If Maia is stochastic, the optimizer prefers candidates
    that happen to receive an unusually bad defender sample.

P1  geometry is not fully symmetry-normalized.

P1  role proximity uses generic Manhattan distance rather
    than piece-aware mating geometry.

P1  greedy role assignment can choose the wrong mapping
    when several same-type pieces can fill several roles.

P1  source-aware Tal gate loses multi-source provenance
    when Patricia and CSTal propose the same UCI move.

P1  current tests validate plumbing, not recognizer correctness:
    they do not prove that canonical real mate examples actually
    score above the production trigger.

P2  trajectory descriptors are currently very generic and must
    not be enabled for the 15 extended families without fixtures.
```

The source-aware gate itself is directionally correct:

```text
CSTal ABSURD own candidate  → trusted
CSTal EXTREME own candidate → trusted
Patricia exploration        → Tal admissibility gate
```

Do not revert this architecture merely because the current run looks bad.

The large regression is primarily in the Pattern model and Maia-selection semantics.

---

# 2. First important correction: `...Qh5` was not CSTal sacrificing its own queen

The raw input finishes on:

```text
15...cxd5
```

so the next side to move is White.

The steering attack side is therefore White.

The iterative path is:

```text
White attacker ply:
    CSTal/Patricia candidate selection

Black defender ply:
    Maia
```

Therefore in:

```text
26. Bxe5 Qh5
27. Qxh5
```

the move:

```text
26...Qh5
```

is a **Maia defender reply**.

It is not a CSTal ABSURD/EXTREME candidate and is not affected by the Tal gate.

This distinction matters because changing CSTal trusted/gated behavior cannot directly prevent this particular queen blunder.

The correct question is:

> Why did candidate selection choose a branch whose modeled Maia response was `...Qh5`?

That leads to the next issue.

---

# 3. P0 — single sampled Maia reply creates optimizer bias

Current candidate evaluation does approximately this:

```text
candidate A
→ call Maia
→ response A
→ affinity after response A

candidate B
→ call Maia
→ response B
→ affinity after response B

candidate C
→ call Maia
→ response C
→ affinity after response C

choose candidate with maximum post-response affinity
```

The selection code prioritizes:

```text
afterResponseScore
then patternDelta
then top post-response pattern score
```

This objective is sensible **only if the Maia response used for ranking is stable and representative**.

## Current Maia3 configuration

The Windows wiring configures Maia3 with:

```text
Temperature = 1.0
TopP        = 1.0
MultiPV     = 5
```

and the generic UCI provider then consumes a single returned `bestmove`.

Whether this is actually stochastic depends on Maia3's UCI implementation, but the configuration is explicitly sampling-capable and there is currently no repeatability contract proving deterministic argmax behavior.

If repeated requests can return different moves, the current optimizer has a serious selection-bias problem.

## Why

Suppose six attacker candidates are reasonable.

Maia gives five normal replies and one accidental bad sample:

```text
A → solid reply     → affinity .55
B → solid reply     → affinity .61
C → solid reply     → affinity .58
D → solid reply     → affinity .63
E → blundered reply → affinity .88
F → solid reply     → affinity .60
```

The planner chooses E.

It did not discover that E is intrinsically the best steering move.

It discovered that:

> E happened to receive the most cooperative defender sample.

As candidate breadth grows, this bias gets worse because the planner gets more chances to observe an unusually weak defender sample.

This is analogous to selecting the maximum from noisy measurements.

---

# 4. Correct Maia semantics for candidate ranking

## MVP

Candidate evaluation should use the **most likely deterministic Maia reply** for every candidate.

Conceptually:

```text
for each candidate:
    reply = argmax P_Maia(reply | position, Elo)
    score = PatternAffinity(after reply)

choose highest score
```

If Maia3 supports deterministic argmax through `Temperature=0`, a policy mode, or another documented option, use it.

Do not merely assume `bestmove` is deterministic.

Add a contract/smoke test:

```text
same position
same Elo
same history
same config
repeat 20 times
→ same defender move
```

for the ranking provider.

If Maia3 intentionally samples even in UCI mode, add a separate deterministic adapter.

## Better future model

The principled objective is:

```text
ExpectedAffinity(move, pattern)
=
Σ P_Maia(reply | position, Elo)
  × Affinity(position after move+reply, pattern)
```

Use Maia top-k replies with policy weights.

Then one rare blunder cannot dominate the selection merely because it happened to be sampled once.

Recommended staged implementation:

```text
Stage 1:
deterministic top-1 Maia

Stage 2:
top-3 / top-5 weighted Maia expectation

Stage 3:
optional stochastic rollout only for simulation/output,
not for candidate ranking
```

---

# 5. Separate "ranking Maia" from "play Maia"

If realism requires stochastic human play, use two distinct concepts:

```text
MaiaPolicyEvaluator
    deterministic / probability-weighted
    used to rank attacker candidates

MaiaPlaySampler
    optional stochastic human-like sample
    used after an attacker move has already been chosen
```

Do not use the same random draw both as:

```text
the evidence used to choose our move
```

and:

```text
the simulated opponent response
```

Otherwise the optimizer implicitly searches for branches where the random defender happened to cooperate.

---

# 6. P0 — global `0.97` survived a complete scorer rewrite without recalibration

Before `4c8a134`, affinity came from a very different symbolic model.

Then the implementation was replaced by:

```text
MateGeometryDescriptor
+
role proximity
+
king region
+
coverage
+
blockers
```

but the target trigger remained:

```ts
assessment.similarity >= 0.97
```

This is not a safe migration.

A score of `0.97` under model A has no guaranteed relationship to `0.97` under model B.

The new model must be calibrated from its own score distributions.

The current:

```text
No target reached 97%.
```

does not mean:

```text
"No mating-pattern geometry emerged."
```

It currently only means:

```text
"No new MateGeometry score crossed an inherited,
uncalibrated numerical constant."
```

Those are very different statements.

---

# 7. P0 — some core families cannot mathematically reach 0.97

This is more serious than mere calibration.

For several families, the current descriptor/context combination makes `0.97` structurally unreachable.

## Why

`coverageAffinity()` builds its observable set exclusively from:

```ts
context.escapeSquares
```

`escapeSquares` are created by:

```ts
adjacentSquares(targetKing)
```

Therefore coverage can only observe squares one king-step away.

But descriptors sometimes ask for relative squares outside that set.

---

# 8. Concrete example: BACK_RANK has impossible requiredCoverage

Current BACK_RANK descriptor includes:

```text
requiredCoverage:
(-1, 0)
(+1, 0)
( 0,-1)
( 0,+1)
( 0,+2)
( 0,-2)
```

But `coverageAffinity()` can never observe:

```text
(0,+2)
(0,-2)
```

because they are not adjacent king escape squares.

Additionally, on the defender's home rank one of `(0,+1)` / `(0,-1)` points off the board depending on orientation.

So for a real back-rank king, only a subset of the six requested squares can ever appear in `escapeSquares`.

The scorer then uses:

```text
criticalFactor =
0.20 + 0.80 * min(primary, coverage)
```

so impossible coverage does not merely reduce one minor feature.

It suppresses the whole final score.

This means a correct Back Rank geometry can be permanently capped far below the production `0.97` trigger.

That is a model bug, not a threshold-tuning issue.

---

# 9. Generic edge/corner requiredCoverage also makes many families unreachable

A shared helper defines:

```text
sideSquares =
(-1,0)
(+1,0)
(0,-1)
(0,+1)
```

Many EDGE/CORNER descriptors use all four as required coverage.

But a king physically on an edge has at least one of those four squares off-board.

A corner king has two off-board.

Because off-board squares can never appear in `context.escapeSquares`:

```text
edge maximum coverage  <= 3/4
corner maximum coverage <= 2/4
```

For an otherwise perfect EDGE descriptor with:

```text
kingRegion = 1
primary    = 1
support    = 1
coverage   = .75
blockers   = 1
```

the current formula gives approximately:

```text
base ≈ .95
criticalFactor = .20 + .80 × .75 = .80
similarity ≈ .76
```

So a family with this geometry can have a practical mathematical ceiling around:

```text
0.76
```

while target creation requires:

```text
0.97
```

This is catastrophic for target discovery.

---

# 10. Families particularly affected

The exact ceiling depends on the orientation and descriptor, but the current design makes the following core families especially suspicious:

```text
BACK_RANK
BLIND_SWINE
DOVETAIL
HOOK
KILL_BOX
MORPHYS
OPERA
TRIANGLE
VUKOVIC
```

because requiredCoverage is derived from king-adjacent directional masks while kingRegion forces edge/home/corner geometry.

`SMOTHERED` has a related issue through `preferredBlockers`:

```text
four orthogonal blocker squares
```

for a corner king, where at most two exist on-board.

Even with otherwise ideal values, its maximum blocker contribution is artificially capped.

This alone is sufficient to explain why a system that previously hit named-pattern thresholds now frequently prints:

```text
No target reached 97%.
```

---

# 11. Correct fix: descriptor squares must have explicit semantics

Do not use one `RelativeSquare[]` abstraction for different concepts.

Split them.

For example:

```ts
type EscapeRequirement =
  | { kind: "KING_ESCAPE"; square: RelativeSquare }
  | { kind: "ATTACK_CONTROL"; square: RelativeSquare }
  | { kind: "BLOCKER"; square: RelativeSquare }
  | { kind: "CORRIDOR"; ray: RelativeRay };
```

Then:

```text
KING_ESCAPE
```

is evaluated only over legal/on-board king-neighborhood squares.

```text
ATTACK_CONTROL
```

can refer to any on-board square and must query board attack/control directly.

```text
BLOCKER
```

must query occupancy directly.

```text
CORRIDOR
```

must inspect a line/ray.

Do not force all of these through `escapeSquares`.

---

# 12. Off-board squares must be excluded, not counted as failed conditions

For a canonical relative mask:

```text
(-1,0), (+1,0), (0,-1), (0,+1)
```

first transform each relative square into an absolute board square.

Then:

```text
if off-board:
    not applicable
```

rather than:

```text
required but false
```

Affinity should normalize over **applicable requirements**.

Example:

```text
corner king:
4 theoretical orthogonal directions
2 exist on board

score:
controlledApplicable / applicableCount

not:
controlledApplicable / 4
```

This is mandatory if king-relative templates are to work at edges and corners.

---

# 13. P1 — production scorer is not fully symmetry-canonical

`relativeSquare()` normalizes rank direction based on defender color:

```ts
defender white
  ? square.rank - king.rank
  : king.rank - square.rank
```

but file remains:

```ts
square.file - king.file
```

No general horizontal mirror is applied.

There is also no full canonical transform for:

```text
a-file ↔ h-file
top corner ↔ bottom corner
left corner ↔ right corner
```

Some descriptors manually list positive and negative variants.

Others do not.

Therefore mirrored instances of the same mating geometry can score differently.

---

# 14. Existing canonicalization test gives false confidence

There is a test asserting:

```text
canonical pattern state is invariant under file mirror
```

But production `scoreMateGeometry()` does not score the canonicalized state.

It scores:

```text
extractPatternPositionContext(...)
```

directly.

Therefore:

```text
canonicalizePatternPosition() is mirror invariant
```

does **not prove**:

```text
MateGeometry score is mirror invariant
```

Add the test that actually matters:

```text
given position P
and exact horizontal mirror mirror(P)

for every geometry family:
    abs(score(P) - score(mirror(P))) <= epsilon
```

Also test:

```text
color swap + 180° rotation
```

against the actual scorer.

---

# 15. Correct fix: canonical king frame

Before scoring a descriptor, map the position into a canonical king-relative coordinate frame.

For example:

```text
1. normalize attacker/defender color
2. normalize defender forward direction
3. mirror file axis so equivalent edge/corner configurations
   map to the same canonical side
4. map valid board geometry into canonical relative coordinates
```

Then descriptors can describe one semantic geometry rather than manually trying to list every sign permutation.

This also reduces descriptor duplication and makes hard-negative tests easier to reason about.

---

# 16. P1 — Manhattan role proximity is chess-geometrically wrong

Current role proximity is:

```ts
distance =
abs(fileDelta) + abs(rankDelta)

proximity =
1 - distance / 5
```

for **all piece types**.

That is not an adequate geometric metric.

## Bishop example

A bishop can be Manhattan-distance 1 from an ideal bishop role square while standing on the wrong square color.

It may receive:

```text
proximity = .8
```

despite being unable ever to occupy that target square.

## Knight example

Knight movement geometry is non-Manhattan.

Two squares with similar Manhattan distance can have radically different knight reachability.

## Rook example

Being one Manhattan unit from a target is not necessarily more useful than being several squares away on the correct open rank/file.

---

# 17. Correct fix: piece-aware role distance

Use a geometry-specific role affinity.

Conceptually:

```text
Knight:
    knight graph distance to role set

Bishop:
    same-color requirement
    diagonal relation
    geometric move distance

Rook:
    rank/file alignment
    line distance

Queen:
    rook/bishop geometry minimum

Pawn:
    side-relative attack/advance geometry
```

Pattern Layer still does not need to evaluate tactical soundness.

This is pure geometric reachability.

Occupancy may be incorporated as a soft structural penalty, while Tal remains responsible for whether the maneuver is tactically viable.

---

# 18. P1 — role assignment is greedy, not globally optimal

Current assignment roughly does:

```text
role 1:
    take best available piece

role 2:
    take best remaining piece

role 3:
    ...
```

This can produce a worse total assignment than another mapping.

Example:

```text
piece A:
    role1 .90
    role2 .89

piece B:
    role1 .88
    role2 .20
```

Greedy:

```text
A → role1 = .90
B → role2 = .20
```

Better:

```text
B → role1 = .88
A → role2 = .89
```

For mating patterns the number of relevant pieces and roles is tiny.

There is no reason to use greedy assignment.

---

# 19. Correct fix: exhaustive / bipartite role assignment

For each descriptor variant:

```text
enumerate feasible piece→role assignments
score each assignment
take the maximum
```

The board has a fixed maximum of 32 pieces and practical relevant-piece sets are much smaller.

For 1–3 pattern roles this is trivial computation.

This makes scoring deterministic and semantically correct.

---

# 20. P1 — source-aware Tal gate is correct, but dedupe destroys provenance

Current intended architecture is good:

```text
CSTal ABSURD  → trusted
CSTal EXTREME → trusted
Patricia      → gate
```

But `composeCandidateGenerators()` deduplicates by UCI move using a single:

```ts
seen: Set<string>
```

and sources are queried in order.

In `createWindowsCstalPatternCandidateGenerator()` Patricia is placed before the CSTal sources.

Therefore:

```text
Patricia proposes e4
CSTal ABSURD also proposes e4
```

becomes:

```text
e4 provenance = Patricia
```

and the CSTal proposal is discarded as a duplicate.

Later:

```ts
isTrustedTalCandidate(seed)
```

sees only Patricia provenance and treats the move as external.

So the source-aware policy is currently not truly multi-source-aware.

---

# 21. Correct candidate model: preserve `proposedBy[]`

A canonical candidate should be something like:

```ts
type CandidateSeed = {
  move: LegalMove;
  proposedBy: readonly MoveProvenance[];
  primaryProvenance: MoveProvenance;
}
```

or equivalent metadata.

Dedup should:

```text
same UCI
→ merge sources
```

not:

```text
same UCI
→ throw later sources away
```

Then:

```text
trusted =
proposedBy.some(source =>
  source.provider is cstal-absurd or cstal-extreme
)
```

This also improves diagnostics:

```text
Move Rxf7 proposed by:
- Patricia rank 3
- CSTal EXTREME bestmove
```

which is exactly the information needed to understand why an unusual move entered the pool.

---

# 22. P1 — current trace hides rejected exploration candidates

`decision.trace.candidates` is built from:

```text
evaluated
```

and rejected Tal-gated candidates are skipped before that collection.

Therefore the artifact cannot answer:

```text
Did Patricia propose the move?
Did CSTal reject it?
What score caused the rejection?
```

This is bad for debugging.

Record every generated candidate.

Suggested trace:

```ts
{
  uci,
  proposedBy,
  talGate: {
    required,
    accepted,
    score,
    reason
  },
  pattern?: {
    family,
    before,
    afterCandidate,
    afterMaia
  },
  maiaReply?: ...
}
```

Rejected candidates can omit expensive Pattern evaluation if desired.

---

# 23. P0/P1 — current tests verify plumbing, not semantic correctness

The test suite now checks useful structural contracts:

```text
all 34 descriptors exist
score is between 0 and 1
trajectory descriptors are bounded
source-aware gate sends Patricia to gate
trusted CSTal survives
```

But these tests do not prove the recognizer works.

There is no strong production contract of the form:

```text
canonical real Back Rank mate
→ BACK_RANK is high

canonical real Morphy mate
→ MORPHYS is high

canonical real Smothered mate
→ SMOTHERED is high
```

nor:

```text
MORPHYS positive
→ MORPHYS outranks HOOK/VUKOVIC/OPERA
```

A scorer can be completely unusable while all current boundedness/plumbing tests remain green.

That appears to be what happened.

---

# 24. Mandatory regression suite for the 19 core families

For every production family, add:

## Positive terminal fixtures

At least:

```text
16 controlled positives already claimed by taxonomy audit
+
real Lichess/reference positives
```

Test:

```text
expected family appears top-1 or top-k
expected score exceeds calibrated family threshold
```

## Pre-terminal trajectory states

For:

```text
mate
mate - 1 attacker move
mate - 2 plies
mate - 4 plies
```

test that affinity generally becomes stronger as geometry forms.

Do not require strict monotonicity on every ply, but measure it statistically.

## Hard negatives

Create near-identical boards where one defining relation is broken.

Example:

```text
same pieces
same king
move supporting bishop one square so it no longer supports the mate
```

Expected family score should fall materially.

## Pairwise confusion tests

Especially:

```text
HOOK vs VUKOVIC
BODEN vs DOUBLE_BISHOP
MORPHYS vs OPERA
ANASTASIA vs generic rook+knight edge net
SMOTHERED vs SUFFOCATION
```

---

# 25. Thresholds must be calibrated from fixtures, not guessed

For each family collect:

```text
positive terminal scores
near-terminal scores
hard-negative scores
confusing-family scores
```

Then select a trigger threshold using actual distributions.

Example procedure:

```text
threshold_family =
value maximizing precision/recall objective
or
a chosen high-precision operating point
```

The product may still choose:

```text
very high precision
```

for launching expensive target branches.

That is fine.

But “high precision” must come from measured distributions, not the aesthetic appeal of `0.97`.

---

# 26. Family-specific threshold is probably superior to one global threshold

Different geometry descriptors naturally have different score distributions.

A global:

```text
0.97
```

assumes all families are calibrated onto the same numerical scale.

Current implementation does not establish that.

Prefer:

```ts
patternThresholdFor(family)
```

derived from calibration metadata.

Example only:

```text
BACK_RANK  .88
MORPHYS    .82
BALESTRA   .94
...
```

Do not use these example numbers without measurement.

---

# 27. Add a hard invariant: canonical positives must be reachable

A useful CI guard:

```text
for each production family:
    max score across verified positive fixtures
    must exceed trigger threshold by margin
```

For example:

```text
maxPositive >= threshold + 0.02
```

or preferably:

```text
p50/p75 positive >= threshold
```

depending desired semantics.

This would have immediately caught descriptors whose mathematical ceiling is below `0.97`.

---

# 28. The old Morphy line is an excellent regression fixture

Earlier observed line:

```text
...
21. Bg5 Re8
22. Rf1 Bf6
23. Bxf6+ Qxf6
24. Rxf6 Nxg4
25. Qxe8+ Kg7
26. Qf8#
```

should be preserved as a named regression case.

Important:

Do not simply assert:

```text
this must be MORPHYS because old code said so
```

First verify its family labeling against the intended source taxonomy.

But once its expected family is confirmed, preserve:

```text
start PGN/FEN
full continuation
terminal position
expected family
historical old/new scores
```

Then future scorer rewrites cannot silently lose it.

---

# 29. Current MORPHYS descriptor is suspiciously restrictive

Current definition requires:

```text
kingRegion = EDGE
critical heavy piece near horizontal king corridor
supporting bishop/knight role
required sideSquares coverage
```

The earlier terminal king in the observed line is on `g7`, which is not a board edge.

Therefore `kingRegionAffinity` becomes only:

```text
0.25
```

Even before checking the exact heavy-piece/supporting-role geometry, the family is heavily penalized.

If the old line is genuinely a valid Morphy family example, the new descriptor is semantically wrong for the project's taxonomy.

This is exactly why descriptors must be derived from verified positives rather than handwritten from a one-line textual intuition.

---

# 30. Descriptor authoring should be corpus-derived

For each family:

```text
collect verified positives
canonicalize around defender king
inspect role-square distributions
inspect escape masks
inspect support roles
inspect blockers
inspect terminal and pre-terminal states
```

Then encode the minimal geometry explaining the family.

Do not start from:

```text
"this pattern sounds like rook + bishop + edge king"
```

and hand-pick relative squares.

Use the corpus as ground truth.

---

# 31. P2 — trajectory scorer is currently too generic for future extended steering

The new sequence layer is a good architectural placeholder, but its events are currently:

```text
KING_REGION_CHANGE
COVERAGE_INCREASE
BLOCKER_CHANGE
```

and families such as Legal, Anderssen, Max Lange, Lolli, etc. are expressed as combinations of these generic events.

That is not yet sufficient to identify historical mating combinations.

Example:

```text
BLOCKER_CHANGE
```

only compares the fraction of adjacent defender-occupied king squares.

It does not identify:

```text
which blocker moved
which line opened
which sacrificed piece caused it
whether a specific bishop/queen corridor emerged
```

Similarly:

```text
KING_REGION_CHANGE
```

returns 1 for any region change, regardless of whether it moves toward the family-specific required region.

`COVERAGE_INCREASE` starts from a baseline around `.5` even for no change.

This should remain catalog-only until grounded fixtures exist.

That is consistent with the current production decision to keep the 15 extended families disabled.

---

# 32. Source-aware Tal policy — keep it

Do not respond to the regression by returning to:

```text
CSTal candidate
→ CSTal self-veto
```

The current source-aware policy better matches the project roles:

```text
CSTal ABSURD/EXTREME
    trusted style authority

Patricia
    breadth/exploration

Tal gate
    admission control for external exploration

Pattern Layer
    mating-direction selector

Maia
    defender model
```

This is coherent.

---

# 33. One design question remains: who should judge Patricia?

Current gate uses:

```text
CSTal ABSURD
```

as the unified safety judge.

That is a defensible conservative policy, but it is a product choice.

Potential consequence:

```text
Patricia proposes a move EXTREME would embrace
ABSURD considers it too wild
→ move rejected
```

If that becomes a real benchmark problem, alternatives include:

```text
accept if ABSURD approves
OR EXTREME approves
```

or separate exploration pools per style.

Do not complicate this yet.

First fix the current scorer and Maia semantics and measure actual rejection behavior.

---

# 34. Immediate debugging instrumentation needed

For every attacker ply, write one compact trace table:

```text
candidate
proposedBy
trusted?
Tal gate result
Tal score
Maia reply
target family
before affinity
after candidate affinity
after Maia affinity
selected?
```

For the observed `...Qh5` case this would immediately show:

```text
which White candidate caused Maia to reply Qh5
whether that candidate came from ABSURD / EXTREME / Patricia
what all competing Maia replies were
why its post-response affinity won
```

Without this trace, debugging is unnecessarily inferential.

---

# 35. Add Maia repeatability diagnostic

For one fixed position/history/Elo:

```text
call Maia 50 times
record returned move frequencies
```

Run under current config.

If multiple moves appear:

```text
candidate ranking is stochastic today
```

Then test deterministic ranking config and assert:

```text
50/50 same move
```

Also record whether Maia requires full move history for identical behavior.

---

# 36. Recommended implementation plan

## Phase 0 — do not destroy the good source-aware change

Keep:

```text
CSTal trusted
Patricia gated
```

Fix provenance merging.

---

## Phase 1 — stabilize defender evaluation

Implement:

```text
deterministic Maia ranking policy
```

Add repeatability tests.

Do not use stochastic reply samples to choose attacker candidates.

---

## Phase 2 — make PatternGeometry internally coherent

Fix:

```text
off-board requirement handling
arbitrary-square control
canonical symmetry
piece-aware role distance
optimal role assignment
```

Do not calibrate thresholds before these semantics are fixed.

---

## Phase 3 — regression fixtures

For all 19 production families:

```text
verified terminal positives
pre-terminal states
hard negatives
confusion pairs
mirrors/color swaps
```

Add the earlier Morphy-like line once its family label is source-verified.

---

## Phase 4 — calibrate

Produce a report:

```text
family
positive score distribution
negative distribution
confusion distribution
recommended trigger
precision
recall
```

Then replace the hardcoded global threshold.

---

## Phase 5 — expected Maia replies

After deterministic top-1 works:

```text
top-k Maia probabilities
→ ExpectedAffinity
```

This is the correct probabilistic form of human-aware steering.

---

## Phase 6 — extended sequence/hybrid families

Only after source fixtures are collected for the 15 extended families:

```text
replace generic transition events
with family-specific trajectory semantics
```

Then calibrate them separately before production enablement.

---

# 37. Suggested architecture after fixes

```text
POSITION
│
├─ CSTal ABSURD best idea ─────────── trusted
├─ CSTal EXTREME best idea ────────── trusted
└─ Patricia MultiPV ── Tal admission gate
                    │
                    ▼
         canonical candidate pool
         with proposedBy[]
                    │
                    ▼
        for each admitted candidate
                    │
        deterministic / weighted Maia
                    │
                    ▼
             resulting positions
                    │
                    ▼
          calibrated PatternAffinity
                    │
                    ▼
       choose best candidate/family pair
                    │
                    ▼
       if calibrated trigger crossed
          launch target branch
```

Longer term:

```text
ExpectedAffinity =
Σ MaiaPolicy(reply) × PatternAffinity(after reply)
```

---

# 38. Acceptance criteria before trusting the next benchmark

Do not run a large “quality benchmark” until these pass.

## Candidate semantics

```text
[ ] duplicate move preserves all proposing sources
[ ] CSTal-origin move always remains trusted
[ ] Patricia-only move is gated
[ ] rejected exploration appears in traces
```

## Maia semantics

```text
[ ] ranking Maia is deterministic, OR weighted top-k
[ ] same input/history/Elo gives repeatable ranking result
[ ] no candidate is favored merely because of a lucky random reply
```

## Pattern geometry

```text
[ ] all descriptor requirements can actually be observed
[ ] off-board relative squares are excluded from denominator
[ ] mirror/color transforms preserve score
[ ] piece roles use piece-aware geometry
[ ] role assignment is globally optimal for descriptor
```

## Recognition

```text
[ ] each of 19 production families has verified positives
[ ] each family's positives exceed its calibrated trigger
[ ] hard negatives fall below trigger at chosen precision target
[ ] confusion matrix is reviewed
```

## End-to-end

```text
[ ] earlier beautiful-line regression fixtures remain discoverable
[ ] target branches actually trigger
[ ] terminal mating lines are independently verified
[ ] no provider error/incomplete case is counted as quality failure/success
```

---

# 39. Priority list

## P0 — fix before interpreting current Pattern results

```text
1. Fix impossible `requiredCoverage` semantics.
2. Remove off-board squares from applicable requirements.
3. Stop using uncalibrated global 0.97 with the new scorer.
4. Make Maia candidate-ranking reply deterministic
   or probability-weighted.
5. Add real positive regression fixtures for all 19 core families.
```

## P1 — correctness and observability

```text
6. Full geometry symmetry normalization.
7. Piece-aware role distance.
8. Optimal role assignment.
9. Merge candidate provenance instead of first-source-wins dedupe.
10. Trace rejected candidates and Maia reply per candidate.
11. Add pairwise confusion tests.
```

## P2 — later expansion

```text
12. Calibrated top-k Maia expectation.
13. Source-ground the 15 extended families.
14. Replace generic trajectory events with family-specific transitions.
15. Enable sequence/hybrid steering only after calibration.
```

---

# 40. Bottom line

The current failure should **not** be diagnosed as:

```text
"trusted CSTal candidates were a mistake"
```

That source-aware change is conceptually sound.

The actual state is closer to:

```text
candidate architecture: improved

Pattern scorer architecture: improved in shape,
but currently internally inconsistent and uncalibrated

Maia integration: vulnerable to sampled-reply selection bias

tests: strong on plumbing, weak on semantic recognition
```

The most severe concrete bug is that descriptor requirements and the data available to `coverageAffinity()` do not match.

As a result, several intended mating families can be structurally prevented from ever reaching the hardcoded production trigger.

That alone invalidates:

```text
No target reached 97%.
```

as meaningful evidence about the chess position.

At the same time, the `...Qh5` queen loss is on the defender side and points to a separate Maia-selection problem, not CSTal self-sacrifice.

The correct repair is therefore **not** another architecture swing.

Do this instead:

```text
keep source-aware Tal admission
+
stabilize Maia ranking
+
repair MateGeometry semantics
+
build real family fixtures
+
calibrate thresholds
+
then benchmark
```

Only after that will a number such as:

```text
MORPHYS affinity = 0.91
```

mean something stable enough to steer on.
