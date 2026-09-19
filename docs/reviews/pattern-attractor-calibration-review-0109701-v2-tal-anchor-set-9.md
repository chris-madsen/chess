# Pattern Attractor Review — calibration and final semantic gaps

Repository: `chris-madsen/chess`  
Reviewed HEAD: `0109701f79791275a1e3fc3e5bc2d028f647d5f8`  
Date: 2026-09-19

Relevant semantic commit:

```text
26b6435 complete Tal Patricia Maia mating attractor review
```

Later commits through `0109701` are mostly terminal/live-output work.

This review is focused only on the remaining semantic gaps after the latest implementation.

The high-level engine roles are now mostly correct.

The remaining problems are concentrated in:

```text
Pattern calibration
cross-family attractor comparability
role-assignment correctness
remote forced-mate wiring
target outcome semantics
```

The recommendation is:

> Do not redesign the architecture again.
>
> Keep the current Tal + Patricia + Maia separation and finish the attractor mathematics.

---

# 1. Executive summary

Current production roles are now largely correct:

```text
CSTal ABSURD
    trusted attacking idea

CSTal EXTREME
    trusted attacking idea

Patricia
    exploration / candidate breadth

TalGate
    admission control for Patricia-only ideas

Maia
    modeled human defender

Pattern Layer
    mating-direction selector
```

Major earlier architecture problems are fixed:

```text
✓ CSTal no longer self-vetoes ABSURD/EXTREME roots
✓ Patricia-only candidates require Tal admission
✓ EXTERNAL_ADMISSION no longer forces a rejected Patricia survivor
✓ duplicate candidates preserve proposedBy[]
✓ Maia ranking is deterministic top-1
✓ cross-family selection has a calibrated-score layer
✓ presence and target-trigger functions now exist separately
✓ exact-role-square reachability has been fixed
✓ target branches can carry forcedMate verification
✓ local CLI wires an independent Stockfish forced-mate verifier
```

However the new calibration layer is currently mathematically too weak to justify the name:

```text
CalibratedAttractorScore
```

The biggest remaining issues are:

```text
P0  calibration trajectory flips attacker side on alternating plies

P0  targetTrigger = 0.95 × max positive score
    ignores hard negatives completely

P0  calibratedAttractorScore = raw / trigger
    saturates at 1.0 and is not a genuine cross-family calibration

P1  raw cross-family affinity can re-enter via tie-breaks after saturation

P1  role assignment contains Math.min(...critical, 0),
    making critical-quality comparison always zero

P1  presenceThreshold = targetTrigger × .75 is still a heuristic,
    not separately calibrated semantics

P1  matcher state thresholds (.25/.45/.65/.82),
    recognizer threshold, presence threshold and target trigger
    are currently separate inconsistent systems

P1  forced-mate verification is wired locally but not into the
    normal remote server Pattern path

P1  target ranking treats all Terminal lines alike instead of
    distinguishing HumanPath checkmate from non-mating terminal states
```

Until these are fixed, I would say:

> The engine-role architecture is right,
> but the mating-attractor mathematics is not finished.

---

# 2. What should NOT be changed

Keep the current engine-role architecture.

Do not:

```text
reintroduce Tal self-veto for ABSURD/EXTREME

let Patricia bypass Tal admission

replace Maia with Stockfish as ordinary defender

turn Pattern Layer into tactical/material evaluation

return to raw global 0.97

fix one pattern family at discovery start

reintroduce stochastic one-sample Maia ranking
```

Those earlier mistakes are already repaired.

The remaining work should be surgical.

---

# 3. EXTERNAL_ADMISSION is now correct

Current PostMoveTalGate behavior contains:

```ts
if (
  policy.mode !== "EXTERNAL_ADMISSION"
  && relative.length > 0
  && !relative.some(result => result.accepted)
) {
  ...
  TAL_BEST_CANDIDATE_FALLBACK
}
```

This means in Pattern Steering:

```text
Patricia A → rejected
Patricia B → rejected
Patricia C → rejected

→ all remain rejected
```

while trusted CSTal roots survive independently.

This is the intended behavior.

Do not change it.

---

# 4. Cross-family ranking now has the correct abstraction point

`PatternSteeringCandidate` now contains:

```text
calibratedBeforeScore
calibratedAfterResponseScore
calibratedProgress
```

and family selection uses calibrated values first.

That is the correct architectural direction.

The problem is not the abstraction.

The problem is the current implementation of calibration.

---

# 5. P0 — calibration flips attacker side along the trajectory

This is the most serious concrete bug in the new calibration pipeline.

In `pattern-calibrate.ts`:

```ts
const scoreAt = (...) => {
  ...
  const context = extractPatternPositionContext(
    position.value,
    facts.value,
    makePatternAnalysisContext(position.value.sideToMove)
  );
}
```

This makes:

```text
attackerSide = current side to move
```

for every trajectory state independently.

That is wrong.

In production steering, attacker identity is stable across alternating plies.

Example:

```text
White = attacking CSTal side
Black = Maia defender

S0 sideToMove = White
→ attacker = White

White moves

S1 sideToMove = Black
→ attacker is STILL White
```

But current calibrator evaluates:

```text
S0 → attacker White
S1 → attacker Black
S2 → attacker White
S3 → attacker Black
...
```

Therefore the same positive mating trajectory is scored alternately from opposite attacking perspectives.

Then `maxCaseScore()` takes the maximum across that mixed sequence.

This corrupts calibration.

---

# 6. Correct calibration attacker semantics

For each dataset case:

```text
attackerSide
```

must be derived once from the case start / source labeling and then held constant across the whole trajectory.

Conceptually:

```ts
const analysis = makePatternAnalysisContext(caseStart.sideToMove);

for (const trajectoryState of trajectory) {
  scoreState(trajectoryState, analysis);
}
```

This should match production `PatternSteeredTalPath`.

Required invariant:

```text
Pattern calibration and production steering
must use identical attacker-side semantics.
```

Add a regression test where:

```text
same positive trajectory
odd/even plies alternate sideToMove
```

and confirm family score is always measured for the original attacker.

---

# 7. P0 — target threshold currently uses only MAX positive score

Current:

```ts
const bestThreshold = (scores: Scores): number =>
  Math.max(
    0.05,
    Math.max(...scores.positive, 0) * 0.95
  );
```

This is not a robust calibration.

It means:

```text
take the single highest positive trajectory score
multiply by 0.95
call that the target trigger
```

Example:

```text
positive maxima:

.31
.34
.37
.39
.42
.44
.47
.90
```

Current trigger:

```text
.90 × .95 = .855
```

Seven ordinary positives may never reach it.

A single outlier controls production behavior.

---

# 8. Hard negatives are collected but ignored by threshold generation

The calibrator stores:

```ts
type Scores = {
  positive: number[];
  negative: number[];
}
```

but `bestThreshold()` uses only:

```text
positive
```

and never reads:

```text
negative
```

Therefore:

```text
hard-negative corpus exists
but does not influence production threshold selection
```

This defeats much of the point of having hard negatives.

A threshold must trade off:

```text
true positive coverage
vs
false positive triggers
```

not merely sit below the single strongest positive.

---

# 9. Correct presence-threshold calibration

For recognition/presence:

For each family collect:

```text
positive scores
hard-negative scores
control scores
```

Then choose an operating point from actual distributions.

Possible MVP policy:

```text
maximize F1
```

or preferably for production:

```text
choose high-precision threshold
subject to minimum acceptable recall
```

Example:

```text
precision >= .95
maximize recall
```

The exact product objective can be chosen explicitly.

But hard negatives must participate.

---

# 10. Target trigger is NOT the same as presence threshold

Presence answers:

```text
Does this look recognizably like family X?
```

Target trigger answers:

```text
Are we deep enough in family X's attractor basin
to launch a fixed-family branch?
```

Therefore target trigger should use trajectory structure.

For each positive trajectory, measure:

```text
distance to terminal mate
first score crossing
future family stability
target branch completion success
```

Then calibrate basin entry.

Do not derive target trigger simply as:

```text
some multiple of presence score
```

---

# 11. Current presenceThreshold = targetTrigger × .75 is still a placeholder

Current:

```ts
patternPresenceThresholdFor(family)
=
patternTargetTriggerFor(family) * 0.75
```

This is convenient but unsupported.

There is no evidence that:

```text
75% of basin-trigger score
```

corresponds to recognizable pattern presence for every family.

The two thresholds should be fitted independently.

---

# 12. P0 — current CalibratedAttractorScore is not real calibration

Current implementation:

```ts
calibratedAttractorScore(raw, family)
=
clamp(
  raw / patternTargetTriggerFor(family)
)
```

This means:

```text
raw = trigger/2
→ calibrated = .5

raw = trigger
→ calibrated = 1

raw > trigger
→ calibrated = 1
```

So all states beyond the trigger collapse to:

```text
1.0
```

This discards useful information.

---

# 13. Saturation destroys attractor depth

Example:

```text
Morphy raw .45
trigger    .44
→ calibrated 1.0

Morphy raw .90
trigger    .44
→ calibrated 1.0

Double Bishop raw .17
trigger           .16
→ calibrated 1.0
```

These three geometrically very different states become indistinguishable.

That is not a meaningful common scale.

It is merely:

> fraction of trigger reached, clipped at 100%.

---

# 14. Cross-family raw affinity leaks back through tie-breaks

`selectPatternSteeringCandidate()` uses calibrated scores first.

Good.

But once many scores saturate at `1.0`, later tie-breaks include:

```text
top raw postResponse family score
```

So raw cross-family values can again affect selection.

That reintroduces the exact semantic problem calibration was meant to remove.

Once a common cross-family score exists, tie-breaks should remain on:

```text
calibrated/family-neutral quantities
```

not raw heterogeneous scores.

---

# 15. Correct common attractor calibration

The project needs a true monotonic family-specific mapping:

```text
raw affinity
↓
calibrated attractor evidence
```

Possible MVP approaches:

```text
empirical CDF / percentile mapping
piecewise-linear calibration
isotonic regression
logistic calibration
```

A simple deterministic piecewise map is enough.

Important property:

```text
raw values above trigger
must still preserve ordering
```

Example desirable behavior:

```text
raw .45 → calibrated .72
raw .60 → calibrated .84
raw .90 → calibrated .98
```

not all `1.0`.

---

# 16. What the common calibrated score should mean

For now, avoid calling it probability.

Use:

```text
CalibratedAttractorScore
```

Interpretation:

```text
0.0 → far outside verified family distribution

0.5 → moderately family-like / ambiguous

0.8 → strongly within family-like geometry

1.0 → extreme/deep positive-family evidence
```

Later:

```text
PatternReachability(position,family,Elo)
```

may become an actual probabilistic model.

Do not conflate the two.

---

# 17. P1 — role assignment critical comparator contains a code bug

Current assignment quality:

```ts
const quality = (values) => {
  const critical = ...
  const supporting = ...

  return [
    Math.min(...critical, 0),
    Math.min(...supporting, 1),
    sum
  ];
}
```

Because all role scores are in:

```text
0..1
```

this:

```ts
Math.min(...critical, 0)
```

always returns:

```text
0
```

Examples:

```text
Math.min(.95, .80, 0) = 0
Math.min(.20, .10, 0) = 0
```

Therefore the attempted:

```text
weakest critical role first
```

objective does not work.

---

# 18. Correct role assignment quality

Use:

```ts
const criticalQuality =
  critical.length === 0
    ? 0
    : Math.min(...critical);

const supportingQuality =
  supporting.length === 0
    ? 1
    : Math.min(...supporting);
```

Then compare:

```text
criticalQuality
supportingQuality
sum
```

Even better:

Evaluate each assignment through the same final variant scoring function and choose the assignment producing maximum final similarity.

The search space is tiny.

---

# 19. Exact target-square reachability is now correct

This earlier bug is fixed:

```ts
if (file === 0 && rank === 0) return 1;
```

Keep this.

Add/retain explicit tests for:

```text
bishop exactly on target
rook exactly on target
queen exactly on target
knight exactly on target
```

to prevent regression.

---

# 20. Pattern-state semantics are currently inconsistent with calibration

`matchers.ts` still classifies:

```text
far         < .25
promising   >= .25
forming     >= .45
near        >= .65
mate_basin  >= .82
```

globally for every family.

Meanwhile production now has family-specific:

```text
presenceThreshold
targetTrigger
```

And recognizer still has a separate globally fitted F1 threshold.

So there are currently three separate semantic systems:

```text
1. hardcoded PatternState thresholds

2. recognizer global calibration threshold

3. production family-specific presence/target thresholds
```

These should not drift independently.

---

# 21. Correct state semantics

Prefer deriving state from the calibrated common scale.

For example:

```text
CalibratedAttractorScore

< .25   far
.25-.45 promising
.45-.65 forming
.65-.85 near
>=.85   mate_basin
```

The exact cutoffs may remain global **because the input is now calibrated cross-family**.

Do not apply universal states to raw family-local affinity.

---

# 22. Recognizer should use the same calibration model

Current recognizer still separately finds:

```text
one global F1 threshold
```

from raw scores.

Instead:

```text
raw family score
↓
family calibration map
↓
calibrated score
```

Then recognizer metrics should operate on calibrated score.

Presence threshold can be family-specific or expressed on the common calibrated scale.

This creates one coherent semantics across:

```text
recognizer
display
PatternState
production steering
target triggering
```

---

# 23. Forced-mate architecture is partially implemented correctly

There is now:

```text
ForcedMateVerifier
ForcedMateProofProvider
Stockfish UCI go mate N
```

Target branches contain:

```ts
forcedMate?: ForcedMateVerification
```

This is good.

The verifier also correctly distinguishes:

```text
VERIFIED
NOT_VERIFIED
UNAVAILABLE
```

and validates that the terminal position is actually checkmate before accepting proof.

---

# 24. Local CLI wires forced-mate verification

Local path now does:

```text
stockfish19Path
↓
createUciForcedMateProofProvider
↓
createForcedMateVerifier
↓
generatePatternTargetSession({
    verifyForcedMate
})
```

This is correct.

---

# 25. P1 — remote production path does NOT wire forced-mate verification

The normal remote server path calls:

```ts
generatePatternTargetSession({
  discovery,
  runTarget,
  onProgress
})
```

but does not supply:

```ts
verifyForcedMate
```

Therefore:

```text
--provider local
```

can produce independent forced-mate verification,

while:

```text
--provider remote
```

does not.

The user primarily runs remote Windows Pattern experiments.

So production forced-mate integration is incomplete.

---

# 26. Correct remote forced-mate wiring

The server should construct a forced-mate verifier if:

```text
stockfish19Path
```

is configured.

Then pass it into every `generatePatternTargetSession()` exactly as the local CLI does.

Also dispose/cleanup provider resources correctly.

Required remote integration test:

```text
remote target reaches checkmate
forced mate provider mocked VERIFIED
→ serialized target includes forcedMate.status=VERIFIED
```

and:

```text
provider absent
→ target remains usable
→ forcedMate is undefined/UNAVAILABLE by explicit semantics
```

---

# 27. P1 — target ranking treats any Terminal as equally good

Current ranking prioritizes:

```text
line.status === "Terminal"
```

But terminal chess states may include:

```text
checkmate
stalemate
draw
other terminal rule result
```

For a mating-attractor system these are not equivalent.

A target branch ending in stalemate must not outrank a longer branch ending in mate merely because both are `Terminal`.

---

# 28. Add explicit HumanPath outcome semantics

Each target should know:

```text
humanPathTerminal
humanPathMate
```

or equivalent chess facts.

Ranking should prefer:

```text
HumanPath checkmate
>
other terminal
>
incomplete
```

Within HumanPath mates:

```text
shorter target continuation
```

remains reasonable.

Forced-mate status can be shown separately:

```text
HumanPathMate = true
ForcedMate = VERIFIED
```

This preserves the important distinction:

```text
human model fell into mate
```

vs

```text
mate was objectively forced
```

---

# 29. Forced-mate proof boundary is conceptually good

The UCI proof provider starts search from:

```text
target trigger position
```

and issues:

```text
go mate N
```

This is a reasonable independent verification boundary.

Keep provenance:

```text
provider
mateMoves limit
timeout
reported mate score
verified position
```

Do not let Pattern Layer itself claim forced truth.

---

# 30. Target trigger should use raw or calibrated score consistently

Current discovery emits target affinities based on:

```text
assessment.similarity >= patternTargetTriggerFor(family)
```

This compares raw affinity to raw family trigger.

That is acceptable **if targetTrigger is explicitly defined in raw family-score space**.

If target trigger later moves to the common calibrated scale, update this boundary accordingly.

Do not mix:

```text
raw trigger for one family
calibrated trigger for another
```

Pick one documented semantics.

Recommended future form:

```text
CalibratedAttractorScore >= TargetBasinThreshold
```

where calibration already absorbs family-specific raw distributions.

---

# 31. Current calibration artifact includes extended families with fake defaults

`pattern-calibration.json` contains the 15 extended families with:

```text
positiveCount = 0
hardNegativeCount = 0
presenceThreshold = .038
targetTrigger = .05
```

They remain outside production steering, so this currently does not break production.

But semantically these values are not calibrated.

Better representation:

```text
calibrationStatus: "UNAVAILABLE"
```

or omit them from calibration artifact.

Do not create numerical pseudo-calibration for zero-evidence families.

---

# 32. Recommended calibration artifact format

Example:

```json
{
  "family": "MORPHYS",
  "status": "CALIBRATED",
  "positiveCount": 8,
  "hardNegativeCount": 4,
  "rawCalibration": {
    "points": [
      [0.10, 0.05],
      [0.25, 0.30],
      [0.40, 0.68],
      [0.60, 0.88],
      [0.90, 0.99]
    ]
  },
  "presenceThreshold": 0.68,
  "targetTrigger": 0.86
}
```

Extended:

```json
{
  "family": "GRECO",
  "status": "UNAVAILABLE",
  "reason": "no verified calibration fixtures"
}
```

---

# 33. Calibration must use only calibration split

Keep the current good invariant:

```text
fit calibration on calibration split only
```

Evaluation split must be held out.

After generating calibration, run:

```text
evaluation precision
evaluation recall
evaluation confusion
trajectory monotonicity
false target trigger rate
```

Do not tune against evaluation results afterward without creating a new split/version.

---

# 34. Target-trigger evaluation metrics

For each core family report:

```text
presence precision/recall

target trigger precision

hard-negative target-trigger rate

median distance-to-terminal at first trigger

target branch HumanPath mate rate

forced mate VERIFIED rate

family confusion at first trigger
```

This is what determines whether the attractor is actually useful.

---

# 35. Current dataset size is still MVP-level

Current calibration artifact reports:

```text
8 positive calibration
4 hard-negative calibration
per core family
```

This is enough to build the machinery.

It is not enough to trust a sophisticated calibration curve long-term.

After mechanics are fixed, expand common families toward:

```text
50–100 positives
50 hard negatives
confusing-family negatives
```

where source data allows.

Do not block current bug fixes on dataset expansion.

---

# 36. Required code fixes — P0

## P0.1 Stable attacker side in calibration

Replace per-state:

```ts
makePatternAnalysisContext(position.sideToMove)
```

with one analysis context derived from the dataset case attacker.

---

## P0.2 Replace max-positive threshold

Delete:

```text
target = max(positive) × .95
```

Use positive and negative distributions.

---

## P0.3 Build real family calibration maps

Replace:

```text
raw / trigger
```

with monotonic family calibration preserving ordering above trigger.

---

## P0.4 Remove raw cross-family tie-breaks

Once calibrated ranking is available, all cross-family ranking/tie-break semantics must remain calibrated or family-neutral.

---

# 37. Required code fixes — P1

```text
[ ] fix Math.min(...critical, 0)

[ ] independently calibrate presence and target trigger

[ ] move PatternState classification onto calibrated score

[ ] make recognizer consume same family calibration

[ ] wire forced mate verifier into remote server path

[ ] distinguish HumanPath checkmate from generic Terminal in ranking

[ ] mark zero-evidence extended families UNCALIBRATED
```

---

# 38. Recommended implementation order

## Step 1

Fix calibration attacker-side bug.

Do this first because current calibration artifact is contaminated.

---

## Step 2

Fix roleAssignment critical comparator.

Small code bug; do before regenerating calibration.

---

## Step 3

Regenerate raw family score distributions from the corrected scorer.

Do not reuse current thresholds.

---

## Step 4

Fit real raw→calibrated mappings using positives + hard negatives.

---

## Step 5

Fit:

```text
presence threshold
target basin trigger
```

separately.

---

## Step 6

Update steering to use only common calibrated attractor scores across families.

Remove raw fallback tie-break.

---

## Step 7

Unify:

```text
PatternState
recognizer
display
steering
```

around the same calibration semantics.

---

## Step 8

Wire remote forced-mate verification.

---

## Step 9

Make target ranking mate-aware rather than merely Terminal-aware.

---

# 39. Acceptance tests — calibration attacker identity

Construct a positive trajectory:

```text
attacker White
plies alternate White/Black
```

For every state assert:

```text
analysis.attackerSide === White
```

The score must never flip perspective merely because `sideToMove` changed.

---

# 40. Acceptance tests — hard negatives must influence threshold

Create controlled distributions:

```text
positives:
.60 .65 .70 .75

hard negatives:
.55 .58 .62
```

Changing negatives to:

```text
.10 .15 .20
```

must change the chosen presence threshold / calibration behavior.

A calibration function that returns the same threshold in both cases is not using negative evidence.

---

# 41. Acceptance test — no saturation collapse

Given one family:

```text
raw .45
raw .65
raw .90
```

all above some basin trigger,

require:

```text
calibrated(.45)
<
calibrated(.65)
<
calibrated(.90)
```

unless the calibration model has a documented genuine ceiling at the final point.

Do not permit:

```text
1,1,1
```

immediately after threshold crossing.

---

# 42. Acceptance test — cross-family comparability

Controlled calibration:

```text
Morphy raw=.40 → calibrated=.85
Anastasia raw=.70 → calibrated=.55
```

Expected:

```text
Morphy wins
```

and no raw tie-break may reverse it.

---

# 43. Acceptance test — role assignment critical objective

Create two possible assignments:

```text
A:
critical = [.95,.20]

B:
critical = [.55,.55]
```

Expected:

```text
B selected
```

because the weakest critical role is stronger.

This test would immediately catch:

```ts
Math.min(...critical, 0)
```

---

# 44. Acceptance tests — remote forced mate

Mock remote server configuration with a proof provider.

Case 1:

```text
target HumanPath mate
proof VERIFIED
```

Expected serialized remote session:

```text
forcedMate.status = VERIFIED
```

Case 2:

```text
target HumanPath mate
proof NOT_VERIFIED
```

Expected:

```text
human path remains valid
forcedMate.status = NOT_VERIFIED
```

---

# 45. Acceptance test — mate-aware target ranking

Targets:

```text
A: stalemate in 4 plies
B: checkmate in 6 plies
C: incomplete in 3 plies
```

Expected ranking:

```text
B
A
C
```

not:

```text
A
B
C
```

merely because A is a shorter Terminal.

---

# 46. Definition of Done for this review

I would sign off on the attractor layer when:

```text
1. Calibration keeps one attacker identity through trajectories.

2. Positives and hard negatives both influence calibration.

3. Cross-family score is a genuine monotonic calibrated mapping,
   not raw/trigger clipping.

4. Stronger raw evidence above trigger remains distinguishable.

5. Cross-family selector never falls back to raw affinity tie-breaks.

6. Presence and basin trigger are independently calibrated.

7. PatternState and recognizer use the same calibrated semantics.

8. Critical-role assignment actually optimizes weakest critical role.

9. Remote production target branches perform independent mate verification.

10. HumanPath checkmate is distinguished from generic Terminal.

11. Extended zero-fixture families expose no fake calibration numbers.
```

At that point the remaining architecture would match the intended system:

```text
Tal
    chess/style authority

Patricia
    breadth

Maia
    likely human defense

Pattern Layer
    calibrated mating attractors

Forced-mate verifier
    objective truth
```

---



---

# 48. NEW — Pattern Layer is currently too authoritative over Tal move choice

The long, dull lines observed in current Pattern runs are not explained well by "Maia became stronger".

A direct comparison shows:

```text
plain CSTal + Maia3 Elo 2200
→ mate around move 32

Pattern pipeline + Maia3 Elo 2000
→ mate around moves 55–64
```

A weaker Maia producing systematically much longer games is a strong sign that the extra delay is introduced by the Pattern-selection layer.

The important architectural difference is:

## Plain style path

```text
CSTal ABSURD or CSTal EXTREME
↓
that engine's own bestmove
↓
Maia
↓
same engine chooses again
```

The engine preserves its own attacking plan from move to move.

## Current Pattern path

```text
CSTal ABSURD bestmove
CSTal EXTREME bestmove
Patricia MultiPV candidates
          ↓
      admitted pool
          ↓
 Maia reply for each candidate
          ↓
Pattern scorer chooses the winner
```

Therefore CSTal no longer owns the final move decision.

It only supplies candidates.

This is a semantic inversion of the intended role split.

The intended system is:

```text
Tal = chess brain / attacking plan
Pattern = mating-direction influence
```

The current system is closer to:

```text
Tal = candidate supplier
Pattern = primary move selector
```

That is too strong.

---

# 49. The divergence already appears on the first attacker move

In the observed example both pipelines share the same game until:

```text
15...cxd5
```

Plain CSTal continues:

```text
16.exd5
```

and enters a forcing attacking sequence that mates around move 32.

The Pattern run instead chooses:

```text
16.fxe6
```

and immediately leaves that natural Tal continuation.

This means the long-game regression starts before any long endgame behavior or unusual defender strength can explain it.

The first Pattern-selected attacker move already overrides Tal's own continuation.

This is strong evidence that candidate-ranking semantics, not Maia strength, are the primary cause.

---

# 50. Pattern selection currently ignores Tal's preference strength

Trusted CSTal candidates are represented approximately as:

```text
accepted = true
reason = TRUSTED_TAL_CANDIDATE
```

But the selector does not retain a meaningful concept such as:

```text
Tal rank
Tal preference
forcing priority
mate class
own-engine confidence
```

So these can become semantically equivalent inputs:

```text
ABSURD:
"this is my best move and continuation"

Patricia:
"this is another legal Tal-admissible possibility"
```

If Patricia's move has slightly higher Pattern score, Pattern can replace the Tal move.

That gives Pattern Layer more authority than intended.

---

# 51. Do NOT solve this by choosing ABSURD as the only fixed anchor

There are two trusted Tal personalities:

```text
CSTal ABSURD
CSTal EXTREME
```

And empirical use shows:

```text
sometimes ABSURD produces the shorter / better mating line
sometimes EXTREME does
```

Therefore the system should NOT define:

```text
ABSURD = permanent primary anchor
EXTREME = secondary alternate
```

That would throw away one of the reasons both engines are present.

Instead define a:

```text
Tal Anchor Set
```

containing both trusted CSTal root candidates.

Conceptually:

```text
TalAnchorSet(position) =
{
    ABSURD bestmove,
    EXTREME bestmove
}
```

Both are first-class Tal ideas.

---

# 52. Correct hierarchy: two trusted Tal anchors + bounded Pattern override

The intended hierarchy should be:

```text
LEVEL 0
Immediate checkmate
→ always wins

LEVEL 1
Reliable/proven mate-class candidates
→ preferred over non-mate-class moves

LEVEL 2
Trusted Tal anchor set
→ ABSURD + EXTREME

LEVEL 3
Pattern chooses between trusted Tal ideas
→ using mating-attractor information

LEVEL 4
External Patricia candidate may override
→ only after Tal admission
→ only with meaningful attractor advantage
→ only with real positive attractor progress
```

This preserves both Tal personalities while preventing the Pattern layer from replacing Tal with generic attractor optimization.

---

# 53. Pattern should choose BETWEEN ABSURD and EXTREME freely

Because either Tal mode may produce the shorter or more beautiful tactical route, Pattern is allowed to prefer:

```text
ABSURD candidate
```

or:

```text
EXTREME candidate
```

on each attacker ply.

There should be no permanent ABSURD preference.

Example:

```text
ABSURD:
calibrated attractor .71
progress +.03

EXTREME:
calibrated attractor .79
progress +.09

→ choose EXTREME
```

Another position:

```text
ABSURD:
mate-class / forcing line
calibrated .72

EXTREME:
calibrated .78
but no progress / slower plan

→ ABSURD may remain preferable
```

The key point is:

> Pattern may arbitrate between Tal's own trusted ideas much more freely than it may replace both of them with a Patricia-only idea.

---

# 54. Patricia override should require a meaningful margin

Current semantics effectively allow:

```text
trusted Tal score .74

Patricia-only score .75
→ Patricia wins
```

That is too sensitive.

A Patricia-only candidate should override the trusted Tal anchor set only when it is clearly better under the attractor objective.

Conceptually:

```text
bestTal = best candidate among ABSURD/EXTREME

bestExternal = best admitted Patricia candidate
```

Then:

```text
select bestExternal only if:

bestExternal.calibratedAfter
    >= bestTal.calibratedAfter + overrideMargin

AND

bestExternal.calibratedProgress
    >= minimumProgress
```

Otherwise:

```text
select bestTal
```

Example policy parameters should be calibrated, not guessed permanently.

But the architecture should contain the distinction explicitly.

---

# 55. Tal-first does NOT mean Pattern is useless

The desired behavior is not:

```text
always play Tal bestmove
```

Pattern still matters.

It may:

```text
choose ABSURD over EXTREME

choose EXTREME over ABSURD

prefer one Tal line because it moves into a mating basin

admit a Patricia idea that Tal approves and that strongly improves
the mating attractor

switch target family as Maia changes the position
```

What Pattern should not do is:

```text
replace Tal's coherent tactical plan for a tiny geometry-score advantage
```

That distinction is central.

---

# 56. Immediate checkmate must have absolute priority

Current selector ranks primarily by attractor score.

That creates a theoretical failure:

```text
Candidate A:
Qh7#
calibrated attractor .65

Candidate B:
Kh1
calibrated attractor .83
```

Pattern must never choose B.

The rule must be:

```text
CHECKMATE NOW
>
EVERYTHING
```

Pattern affinity is irrelevant once one candidate ends the game by checkmate.

Required selection tier:

```text
if any candidate is immediate checkmate:
    choose from immediate checkmates only
```

If several immediate mates exist, Pattern may be a beauty/tie-break signal among them.

---

# 57. Mate class should outrank ordinary attractor improvement

If Tal or an independent verifier can establish:

```text
candidate A → forced mate / reliable mate score

candidate B → merely strong geometry
```

then candidate A should not lose merely because B has a higher PatternAffinity.

Correct hierarchy:

```text
immediate mate

then proven/reliable mate-class

then trusted Tal anchors + Pattern steering

then admitted external exploration
```

Within the same mate class, Pattern can choose aesthetics if desired.

---

# 58. Add anti-stall semantics

The observed sequence:

```text
...Qf8
Kg1 Qe7
Kh1 Qf8
Kg1 Qe7
```

is a characteristic failure mode.

Pattern scoring rewards:

```text
remaining inside a high-affinity geometry
```

but does not sufficiently penalize:

```text
making no meaningful progress toward mate
```

A mating attractor must attract.

It must not become a stable orbit.

---

# 59. Pattern stall fallback

Track progress over attacker plies.

For example:

```text
if calibratedProgress <= epsilon
for N consecutive attacker decisions:
    release Pattern override
    choose from TalAnchorSet
```

Possible trace reason:

```text
PATTERN_STALL_FALLBACK_TO_TAL
```

The exact `epsilon` and `N` should be measured.

Conceptually 2–3 attacker plies without meaningful progress is enough to justify restoring Tal control.

This is not chess evaluation.

Pattern is merely admitting:

> "I am not improving my own objective, so I should stop overriding the chess brain."

---

# 60. Add repetition / oscillation protection

Pattern lines should detect short steering oscillations such as:

```text
Kg1
Kh1
Kg1
```

or repeated equivalent positions.

If Pattern selection repeatedly returns to the same position/geometry without increased attractor value:

```text
suppress the repeating Pattern override
→ choose a trusted Tal alternative
```

This can use:

```text
position hash history
calibrated attractor history
```

and does not require a new chess evaluator.

---

# 61. Add family-switch hysteresis during discovery

Dynamic family switching remains correct.

Do not fix one family from the start.

But noisy switching should require a meaningful advantage.

Instead of:

```text
Morphy .73
Hook   .74
→ switch to Hook

next ply:
Morphy .75
Hook   .74
→ switch back
```

use:

```text
switch only if:

newFamilyScore >= currentFamilyScore + switchMargin
```

or if the current family's progress has stalled materially.

This keeps the attractor dynamic without making it noisy.

---

# 62. Fixed target branches must not become pattern prisons

Current target branch fixes:

```text
targetFamily = HOOK
```

and then scores only that family.

This is useful for asking:

> Can we deliberately continue toward Hook?

But it must not prevent a clearly superior mate.

A fixed-family target branch needs escape rules.

At minimum:

```text
1. immediate checkmate always allowed

2. verified/proven forced mate always allowed

3. substantially shorter mating conversion may escape the preferred family

4. otherwise prefer the fixed target family
```

Interpret:

```text
targetFamily = preferred mating attractor
```

not:

```text
targetFamily = mandatory decorative endpoint at all costs
```

Patterns are attractors, not handcuffs.

---

# 63. Target branches should optimize completion, not only resemblance

Once a family has crossed a basin trigger, the objective should gradually shift from:

```text
approach family
```

toward:

```text
finish the attack
```

Possible phase semantics:

```text
FORMING:
maximize calibrated attractor progress

BASIN:
preserve family + prefer forcing Tal moves

MATE CLASS:
finish mate
```

This can prevent 30 additional moves of maintaining a recognizable geometry after the mating idea is already mature.

---

# 64. Long raw-file horizon is an amplifier, not the root cause

Pattern raw-file mode allows a large default horizon.

The ordinary StylePath example has a shorter horizon.

This explains why Pattern is allowed to wander into move 60+.

It does not explain why it wanders.

Reducing the horizon would merely hide the problem.

Do not "fix" this regression by shortening the horizon.

Fix selection semantics.

---

# 65. Calibration bugs amplify the long-line problem

The previously identified calibration problems remain relevant:

```text
attacker side flips during calibration trajectory

target trigger uses max positive × .95

hard negatives are ignored

raw / trigger calibration saturates at 1
```

These can cause:

```text
early false target triggers
wrong family choice
overconfident attractor scores
```

Then a fixed-family branch may start too early and remain active for dozens of moves.

Therefore calibration repair is still required.

But it is not the only fix.

Even perfect calibration will not solve the architectural issue if:

```text
Pattern remains the unconditional primary move selector.
```

---

# 66. Recommended production selector

Conceptual algorithm:

```text
candidates =
    trusted ABSURD
  + trusted EXTREME
  + Tal-admitted Patricia

if immediateMateCandidates non-empty:
    return best immediate mate

if verifiedMateClassCandidates non-empty:
    return best mate-class candidate

talAnchors =
    candidates proposed by ABSURD or EXTREME

bestTal =
    best trusted Tal candidate
    under calibrated attractor + progress + forcing metadata

bestExternal =
    best Patricia-only admitted candidate

if bestExternal exists
and bestExternal exceeds bestTal by meaningful calibrated margin
and bestExternal makes meaningful positive progress:
    return bestExternal

return bestTal
```

This is the intended power relationship.

---

# 67. How to choose the best trusted Tal candidate

Because neither ABSURD nor EXTREME should be permanent primary, compare both.

Candidate ranking inside the Tal anchor set may use:

```text
mate/immediate terminal class

reliable Tal mate score if available

calibrated attractor after Maia

calibrated progress

forcing / tactical metadata if already available

stable deterministic tie-break
```

The important invariant is:

```text
ABSURD and EXTREME are peers.
```

No hardcoded permanent ABSURD priority.

---

# 68. Preserve Tal plan continuity where possible

Another useful signal is source continuity.

If previous attacker move came from EXTREME and EXTREME's next bestmove continues a concrete attack, a tiny Pattern difference should not arbitrarily switch to Patricia or ABSURD.

Do not make source continuity a hard lock.

Use it only as a weak tie-break / hysteresis signal.

This helps preserve multi-move Tal combinations.

---

# 69. Required candidate trace additions

For diagnosing long lines, each decision trace should make clear:

```text
candidate UCI
proposedBy[]
trustedTalOrigin
which Tal source: ABSURD / EXTREME / both
Tal gate result for Patricia-only
Maia reply
target family
raw affinity
calibrated affinity
progress
candidate class:
    IMMEDIATE_MATE
    MATE_CLASS
    TAL_ANCHOR
    EXTERNAL
override margin vs bestTal
selected reason
```

Suggested selected reasons:

```text
IMMEDIATE_CHECKMATE
FORCED_MATE_CLASS
BEST_TAL_ANCHOR
PATTERN_OVERRIDE_EXTERNAL
PATTERN_STALL_FALLBACK_TO_TAL
TARGET_FAMILY_PREFERRED
TARGET_ESCAPE_TO_MATE
```

Without explicit selection reasons, future regressions will again be hard to interpret.

---

# 70. Add an A/B diagnostic matrix

For the same raw game run:

```text
A. ABSURD + Maia
B. EXTREME + Maia
C. TalAnchorSet {ABSURD,EXTREME} + Maia
D. TalAnchorSet + Pattern, no Patricia
E. TalAnchorSet + Patricia + TalGate + Pattern
```

Report:

```text
terminal move count
checkmate?
source sequence
first divergence from plain Tal
number of Pattern overrides
number of external Patricia overrides
number of stall fallbacks
first target trigger ply
target family
```

This isolates whether long lines come from:

```text
mixing ABSURD/EXTREME
Pattern steering
Patricia exploration
target-family locking
```

---

# 71. Add the observed short Tal line as a regression baseline

Preserve the known plain CSTal + Maia continuation as a baseline example.

Do not require the Pattern system to reproduce the exact same moves.

But enforce a quality regression guard.

Example:

```text
plain Tal baseline:
HumanPath mate in ~N plies

Pattern version:
must not systematically inflate mate length by 2×
without a corresponding explicit objective reason
```

Potential metric:

```text
PatternLineLength / bestTrustedTalBaselineLength
```

Track this over a corpus.

Do not hardcode one absolute ratio forever, but large systematic inflation should fail quality review.

---

# 72. Add "mating urgency" metrics

For every end-to-end run report:

```text
plies to HumanPath mate
plies from first basin trigger to mate
number of non-progress attacker plies
number of repeated-position attacker decisions
number of family switches
number of Patricia overrides
```

This turns "душная партия" into measurable regression data.

---

# 73. Revised Definition of Done

In addition to the previous calibration requirements, I would now require:

```text
1. ABSURD and EXTREME are both trusted peer Tal anchors.

2. Neither is hardcoded as permanent primary.

3. Pattern can choose freely between ABSURD and EXTREME.

4. Patricia-only moves require Tal admission.

5. Patricia may override the best Tal anchor only by a meaningful,
   calibrated attractor margin and positive progress.

6. Immediate checkmate always outranks PatternAffinity.

7. Reliable/proven mate class outranks ordinary geometry improvement.

8. Pattern stall returns control to the Tal anchor set.

9. Repetition/oscillation cannot be rewarded indefinitely.

10. Target family is a preferred attractor, not a prohibition
    against a clearly superior mate conversion.

11. Fixed target branches have an escape-to-mate rule.

12. End-to-end Pattern lines are measured against plain
    ABSURD and EXTREME Tal baselines for mate-length inflation.
```

When these are true **together with the calibration fixes**, then the intended relationship is finally correct:

```text
Tal plays chess.

ABSURD and EXTREME provide two trusted Tal ideas.

Patricia broadens the search.

Maia models the human response.

Pattern nudges the trusted chess toward mating geometry.

Pattern does not replace Tal's plan merely because a scalar
geometry score is slightly larger.

And once mate is available, the system finishes the mate.
```

---

# 74. Final architectural statement

The target design should be understood as:

```text
                 ┌─ CSTal ABSURD ─┐
POSITION ────────┤                 ├─ trusted Tal anchor set
                 └─ CSTal EXTREME ┘
                           │
                 Patricia exploration
                           │
                    Tal admission gate
                           │
                           ▼
                     admitted pool
                           │
                     Maia response
                           │
                           ▼
                  mating-attractor scores
                           │
              ┌────────────┴────────────┐
              │                         │
        choose between             external override
        Tal anchors                only by margin
              │                         │
              └────────────┬────────────┘
                           ▼
                    urgency / mate tier
                           │
                           ▼
                        COMMIT
```

This is meaningfully different from:

```text
all legal candidates
↓
PatternAffinity
↓
highest scalar wins
```

The latter produces exactly the long, sterile behavior currently observed.

The former preserves what the project was built for:

> **Tal remains the attacking chess intelligence; Pattern Layer bends Tal toward interesting mating structures without destroying Tal's own combinations.**


# 47. Final assessment

Current master is a major improvement over the previous iteration.

The high-level architecture no longer needs another rewrite.

The engine responsibilities now largely match the intended design.

The remaining blocker is:

> **The project has the right attractor abstraction, but the current calibration implementation does not yet justify cross-family semantic comparison.**

Fix the calibration pipeline rather than changing the surrounding engines.

The next correct move is:

```text
stable attacker identity
+
real family calibration
+
separate presence/basin semantics
+
correct assignment objective
+
remote forced-mate proof
+
mate-aware target outcomes
```

After those corrections, I would be comfortable saying:

> **Yes — this is now genuinely Tal + Patricia + Maia + mating attractors, with independent forced-mate truth.**
