# Pattern Steering Review v3
## Correct attacker semantics, shorter mate conversion, and unique target lines

Repository: `chris-madsen/chess`  
Reviewed HEAD: `629c01c61b89ad3b77cd0a40751d945605d6c206`  
Date: 2026-09-20

This review supersedes the remaining open items from the previous attractor/calibration reviews.

The high-level architecture is now largely correct:

```text
CSTal ABSURD + CSTal EXTREME
        = trusted Tal anchor set

Patricia
        = exploration only

Tal gate
        = admission for Patricia-only candidates

Maia
        = human defender model

Pattern Layer
        = mating-attractor steering

Independent verifier
        = objective forced-mate truth
```

Do **not** redesign those roles again.

The remaining work is concentrated in four areas:

```text
1. The calibration corpus is still scored from the wrong attacking side.
2. Target/basin calibration is not yet calibrated as "distance to mate".
3. Tal-to-mate urgency is still too weak, so lines remain longer than plain Tal.
4. Target output treats different family labels as different lines even when
   they are literally the same chess trajectory.
```

Observed current behavior improved from ~55–64 moves to ~52 moves, but is still much longer than the plain Tal + Maia baseline (~32 moves), and the reported:

```text
CORNER
KILL_BOX
TRIANGLE
```

targets are literally the same full game.

That is useful evidence. It tells us the engine-role rewrite helped, but the remaining objective/calibration semantics are still not finished.

---

# 1. Current state: what is now correct

The latest master has implemented a large portion of the previous review correctly.

## 1.1 ABSURD and EXTREME are peer trusted Tal anchors

Correct.

Neither is permanently primary.

Both survive without self-veto.

Pattern may choose between them.

This must remain.

---

## 1.2 Patricia is external exploration

Correct.

Patricia-only moves go through external Tal admission.

If Tal rejects all Patricia moves, zero Patricia survivors is allowed.

The old forced fallback is disabled in `EXTERNAL_ADMISSION`.

Keep this.

---

## 1.3 Patricia override now requires a margin

Current selector approximately requires:

```text
external.calibratedAfter
>=
bestTal.calibratedAfter + 0.08
```

and:

```text
external.calibratedProgress > 0.02
```

before Patricia can replace the best trusted Tal anchor.

This is directionally correct.

The exact `.08` / `.02` values may later be calibrated, but the architecture is right.

---

## 1.4 Immediate checkmate has priority

Correct.

Candidate selection now identifies:

```text
immediateMate
```

and restricts the pool to immediate mates when one exists.

This directly fixes the earlier possibility:

```text
mate now loses to prettier PatternAffinity
```

Keep this as a hard invariant.

---

## 1.5 Stall and repetition state now exist

`PatternSteeredTalPath` tracks:

```text
attackerStallCount
positionVisits
previousTargetFamily
```

and two low-progress attacker decisions or a repeated position can force selection back to a Tal anchor.

This is a good first anti-stall mechanism.

It needs one additional candidate-level repetition fix later in this review.

---

## 1.6 Family-switch hysteresis exists

Discovery now resists switching family for tiny differences.

Current margin:

```text
0.05 calibrated score
```

This is directionally correct.

Keep dynamic families; do not hard-lock discovery.

---

## 1.7 Role-assignment critical minimum bug is fixed

The previous erroneous:

```ts
Math.min(...critical, 0)
```

has been corrected to an explicit empty/non-empty calculation.

Good.

---

## 1.8 Exact role-square reachability is fixed

A piece exactly on the desired role square gets maximal reachability.

Good.

---

## 1.9 Remote forced-mate wiring exists

The Windows remote pattern server now constructs a Stockfish proof provider when configured and passes:

```text
verifyForcedMate
```

into `generatePatternTargetSession()`.

Good.

This previous gap is closed.

---

## 1.10 HumanPath checkmate is distinguished from generic Terminal

`PatternTargetBranch` now carries:

```text
humanPathMate
```

and final target ranking prefers HumanPath checkmate over generic terminal results.

Good.

---

# 2. P0 — the current calibration corpus still uses the wrong attacker side

This is now the most important correctness issue.

The previous bug was:

```text
attacker side changed every trajectory ply
```

The new calibrator fixed that mechanically by creating one stable analysis context.

However it derives that stable side from:

```ts
entry.trajectory?.[0]?.fen ?? entry.fen
```

and then:

```ts
makePatternAnalysisContext(start.value.sideToMove)
```

For the current Lichess dataset, that is still wrong.

---

# 3. Lichess puzzle trajectory semantics

The dataset builder stores:

```text
ply 0 = Lichess FEN before the setup/opponent move
ply 1 = actual puzzle start for the solver
ply 2...
...
terminal = mate
```

The repository already acknowledges this elsewhere:

```ts
// Lichess stores the pre-puzzle position; ply 1 is the actual puzzle start.
const actualStartFen =
  entry.value.trajectory?.find(state => state.ply === 1)?.fen;
```

`parsePatternDataset()` correctly uses `ply 1` as `PatternExperimentCase.position`.

But `pattern-calibrate.ts` does not.

This creates inconsistent semantics between:

```text
experiment / recognizer
```

and:

```text
calibration fitting
```

---

# 4. Empirical proof on the current dataset

Across the calibration-positive corpus, `trajectory[0].sideToMove` is the opposite of the player who eventually delivers mate.

That is expected from Lichess puzzle encoding:

```text
ply 0:
opponent/setup move is to be made

ply 1:
solver / attacking side to move

...
terminal:
defender side to move while checkmated
```

Therefore the correct current attacking side for positive Lichess cases is the side to move at:

```text
trajectory ply 1
```

not ply 0.

---

# 5. The mismatch is even worse because hard negatives use ply 1

The dataset builder creates hard negatives from:

```ts
const actualStartFen =
  trajectory.states.find(state => state.ply === 1)?.fen ?? fen;
```

So the present calibration approximately compares:

```text
POSITIVES
    pattern score from pre-puzzle/opponent side

vs

HARD NEGATIVES
    pattern score from actual solver/attacker side
```

This invalidates the statistical comparison.

The generated calibration artifact must therefore be considered stale/invalid until rebuilt.

---

# 6. Correct fix: make attacker identity explicit in the dataset

Do not keep rediscovering attacker side implicitly from arbitrary FENs.

Add explicit dataset metadata:

```ts
type PatternDatasetEntry = {
  ...
  attackerSide: "white" | "black";
  trajectoryStartPly?: number;
}
```

For current Lichess positives:

```text
trajectoryStartPly = 1
attackerSide = sideToMove at trajectory[1]
```

For hard negatives derived from a positive:

```text
inherit attackerSide from source positive
```

For future non-Lichess sources:

```text
set attackerSide explicitly at dataset construction time
```

This removes ambiguity permanently.

---

# 7. Calibration should score the actual attack trajectory, not the pre-puzzle setup

For Lichess positive cases, calibration should normally score:

```text
trajectory states with ply >= 1
```

not include ply 0 in:

```text
max / distribution / basin fitting
```

Ply 0 belongs to the position before the opponent's setup move.

It may be useful for separate "precondition emergence" research, but it should not silently contaminate the main mating-attractor calibration.

Recommended:

```ts
const scoringTrajectory =
  entry.trajectory
    ?.filter(state => state.ply >= (entry.trajectoryStartPly ?? 0));
```

Use one explicit `analysis.attackerSide` for every state.

---

# 8. Required attacker-side regression tests

Add dataset/calibration tests:

```text
GIVEN a Lichess positive with ply 0 and ply 1

THEN:
  attackerSide == sideToMove at ply 1
  attackerSide remains constant across every later trajectory state
```

Also:

```text
hard negative derived from positive
inherits the same attackerSide
```

And:

```text
calibrator and PatternExperimentCase use identical attacker semantics
```

This should be a hard contract.

---

# 9. P0 — current target trigger is still not a "mate basin" trigger

The new `targetFor()` is better than the previous:

```text
maxPositive × .95
```

because hard negatives now participate.

Current logic is roughly:

```text
target =
max(
  positive 75th percentile,
  negative/control 95th percentile + epsilon
)
```

However the positive values fed into this are still:

```ts
caseScore =
max score anywhere across the entire positive trajectory
```

That answers:

> How high did this family score ever get during a successful puzzle?

It does **not** answer:

> At what score are we reliably only a few plies away from completing the mating pattern?

Those are different questions.

---

# 10. Concrete evidence: targetTrigger can be below presenceThreshold

The current generated artifact contains families such as:

```text
BLIND_SWINE:
presenceThreshold = 0.1694
targetTrigger      = 0.108

DOVETAIL:
presenceThreshold > targetTrigger

HOOK:
presenceThreshold > targetTrigger

KILL_BOX:
presenceThreshold > targetTrigger

PILLSBURY:
presenceThreshold > targetTrigger
```

This is semantically backwards.

A target branch means:

```text
we are deep enough in the attractor
to freeze/prefer this family and run a dedicated continuation
```

That state cannot logically require **less evidence** than merely saying:

```text
the pattern is present
```

At minimum enforce:

```text
targetTrigger >= presenceThreshold
```

But the real fix is trajectory-based basin calibration.

---

# 11. PresenceThreshold = 0 is another warning signal

Current generated calibration has several core families with:

```text
presenceThreshold = 0
```

including multiple production families.

That means the current scorer/calibration distribution cannot find a useful positive-vs-negative recognition boundary under the selected policy.

Do not silently interpret `0` as:

```text
this family is always present
```

Instead expose calibration quality.

Example:

```ts
status:
  "CALIBRATED"
  | "WEAK_SEPARATION"
  | "UNAVAILABLE";
```

If precision/recall requirements cannot be met, mark the family accordingly.

Production steering can still use a soft attractor score, but target registration should be conservative.

---

# 12. Correct target-basin fitting must use distance-to-terminal

The dataset already contains exactly the data needed:

```text
distanceToTerminal
```

Use it.

For each family, gather calibrated/raw scores by:

```text
distance 0
distance 1
distance 2
distance 3
distance 4+
hard negatives
controls
```

Then define target basin semantically.

Example policy:

```text
TargetBasin =
score threshold such that:

P(distanceToTerminal <= 4 | score >= threshold)
is high

AND

hard-negative trigger rate is low
```

Or choose a fixed target:

```text
precision >= .95
for states within <= N plies of terminal pattern
```

The exact objective can be tuned.

The crucial point:

> Basin trigger must be fitted from where in the trajectory the score occurs,
> not merely from the maximum score ever observed.

---

# 13. Add first-crossing metrics

For every positive trajectory calculate:

```text
first ply where target trigger is crossed
distanceToTerminal at first crossing
does family remain above presence/basin afterward?
does HumanPath target branch complete?
```

Report per family:

```text
median first-trigger distance
p75 first-trigger distance
false trigger rate
trigger persistence
HumanPath mate rate after trigger
forced mate verification rate
```

This measures whether the trigger is useful for steering.

---

# 14. P0/P1 — current calibrated mapping still ignores negatives in the mapping itself

The new mapping is no longer:

```text
raw / trigger
```

which is good.

But `pointsFor()` currently maps raw score using only:

```text
fraction of positive examples <= raw
```

Hard negatives and controls do not affect the actual raw→calibrated mapping.

They affect threshold selection, but not cross-family `CalibratedAttractorScore`.

So the mapping is approximately:

> percentile inside this family's positive distribution

rather than:

> evidence that this position belongs to this family's mating basin

Those are not equivalent.

---

# 15. Use positive AND negative evidence in the common scale

A better MVP mapping is a monotonic discriminative calibration:

```text
raw score
→ P(positive | raw)
```

or a probability-like score without claiming perfect calibration.

Possible methods:

```text
isotonic regression
empirical binned positive rate
Platt/logistic mapping
monotonic piecewise table
```

For the small current sample size, simple binned/isotonic calibration is sufficient.

The mapping must use:

```text
positives
hard negatives
controls
```

not positives alone.

---

# 16. The mapping must remain ordered above the target trigger

Keep the previous invariant:

```text
raw .45
raw .65
raw .90
```

should normally remain:

```text
calibrated(.45)
<
calibrated(.65)
<
calibrated(.90)
```

Do not collapse all deep states to the same score.

But also ensure that a family with terrible negative separation does not receive artificially high cross-family scores merely because a raw value is high relative to its own positives.

---

# 17. P1 — `MATE_CLASS` is asymmetric against trusted Tal anchors

Current:

```ts
mateClass =
  tacticalAssessment.talScore?.kind === "mate"
  && tacticalAssessment.talScore.value > 0;
```

Patricia-only candidates pass through TalGate and receive:

```text
talScore
```

Trusted ABSURD/EXTREME candidates deliberately bypass the gate and currently receive no equivalent score metadata.

Therefore:

```text
Patricia candidate
Tal says mate +N
→ MATE_CLASS

ABSURD own bestmove
ABSURD itself may be seeing mate +N
→ no talScore
→ not MATE_CLASS
```

That is backwards.

The trusted Tal anchors must not be disadvantaged because they correctly bypass self-veto.

---

# 18. Preserve CSTal root score/PV metadata without self-veto

When ABSURD and EXTREME generate their own candidate, retain engine metadata:

```ts
type CandidateSeed = {
  ...
  engineScore?: EngineScore;
  enginePv?: readonly string[];
  engineRank?: number;
}
```

For CSTal trusted anchors:

```text
engineScore
```

is advisory metadata, not gate output.

Then define:

```text
mateClass
```

from trusted source metadata as well.

Do **not** reintroduce a veto.

---

# 19. Prefer shorter positive mate distance inside mate-class

If both trusted Tal anchors report positive mate:

```text
ABSURD mate 7
EXTREME mate 4
```

the shorter reliable mate should normally win before Pattern aesthetics.

Correct ordering:

```text
immediate checkmate
>
positive mate-class, shorter mate first
>
ordinary trusted Tal anchors
>
external override by strong margin
```

Pattern may tie-break among mate lines of equal/similar forced distance if desired.

This directly helps shorten games without turning Pattern into Stockfish.

---

# 20. Current anti-stall is useful but not candidate-level repetition suppression

Current mechanism:

```text
after repeated position / two low-progress attacker plies
→ select bestTal
```

This stops Patricia from repeatedly steering into a loop.

But it does not guarantee that `bestTal` itself exits the loop.

If the best Pattern-scored Tal anchor produces the same already-visited post-Maia position, the engine may continue cycling.

---

# 21. Add candidate-level repetition penalty/exclusion

During candidate evaluation, candidate objects already know:

```text
postResponsePosition
```

Pass recent position hashes into selection context.

Then:

```text
if candidate.postResponsePosition.hash is recently visited
and another trusted Tal anchor is non-repeating:
    suppress repeating candidate
```

Suggested policy:

```text
non-repeating immediate/mate candidates
>
non-repeating Tal anchors
>
repeating Tal anchor only if no viable escape exists
```

Do not ban legal repetitions universally; some forced mates require repeated checks.

But ordinary non-mating pattern oscillation should not be rewarded.

---

# 22. The current 52-move line still shows the old oscillation symptom

The line contains:

```text
25.Kg1 Qe7
26.Kh1 Qf8
27.Kg1 Qe7
```

This is exactly the type of pattern orbit we wanted to eliminate.

The fact that the line shortened somewhat proves the new anchor/stall logic helps.

The fact that this loop remains proves the anti-stall policy is not yet strong enough.

Use candidate-level resulting-position history, not only a global fallback after the loop has already happened.

---

# 23. P1 — fixed target family is still too hard a constraint

In a target branch:

```text
targetFamily = CORNER
```

causes `familyProgress()` to score only CORNER.

Immediate mate can escape because it is detected before normal ranking.

A candidate with explicit `mateClass` can also escape once trusted mate metadata is fixed.

But a clearly better mating conversion in a different family that is not yet engine-proven mate can still be ignored.

So fixed target semantics are still closer to:

```text
must optimize this family
```

than:

```text
prefer this family unless a materially better mating basin appears
```

---

# 24. Use `preferredTargetFamily`, not absolute `targetFamily`

Recommended semantics:

```text
preferredFamily = CORNER
```

Score:

```text
preferred-family calibrated score
+
small target-family bonus
```

but still evaluate all steerable families.

Allow escape when:

```text
otherFamily.calibratedAfter
>= preferredFamily.calibratedAfter + escapeMargin
```

and preferably one of:

```text
other family has stronger mate-class evidence
other family has much smaller estimated distance-to-mate
preferred family has stalled
```

Record:

```text
originTargetFamily
terminalFamily
escapedToFamily?
```

This is much more honest and useful.

---

# 25. NEW — why CORNER, KILL_BOX and TRIANGLE are printed as the same game

The current target registration deduplicates only by:

```text
targetFamily
```

It does not deduplicate by:

```text
trigger position
continuation
terminal position
full root-to-terminal line
```

Therefore if three families cross their target thresholds near the same state, the scheduler launches three family branches.

If Tal anchor selection dominates all three branches, they can choose exactly the same moves.

The result is:

```text
Target CORNER
same game

Target KILL_BOX
same game

Target TRIANGLE
same game
```

These are not three useful solutions.

They are one chess line with three labels.

---

# 26. Do not force fake diversity

The wrong fix would be:

```text
if two target lines are same,
force the second branch to play a different inferior move
```

Do not do that.

If one strong Tal line genuinely satisfies multiple families, preserve that fact.

Represent it as:

```text
Primary family: CORNER
Also matches: KILL_BOX, TRIANGLE
```

or similar.

The user wants distinct useful mating lines, not artificial divergence.

---

# 27. Add a canonical full-line signature

For every completed target reconstruct the full root-to-terminal trajectory:

```text
fullPlies =
target.prefixPlies
+
target.line.plies
```

Then compute a deterministic signature:

```text
UCI sequence hash
```

or:

```text
startHash + joined UCI moves
```

Example:

```ts
fullLineSignature(target)
```

Targets with the same full line signature are duplicates regardless of target-family label.

---

# 28. Merge duplicate families onto one line

After target execution:

```text
group by fullLineSignature
```

For each group:

```ts
{
  line,
  primaryTargetFamily,
  alsoMatches: [...otherFamilies],
  triggerMetadataByFamily
}
```

Choose primary family using a transparent criterion, for example:

```text
highest calibrated target evidence at trigger
then highest terminal family score
then deterministic family name tie-break
```

Do not print the same game three times.

---

# 29. If the product promises top 3 lines, return top 3 UNIQUE lines

Current final ranking effectively slices the first three target-family branches.

Change semantics to:

```text
rank all completed target branches
↓
deduplicate by full chess line
↓
keep best representative of each unique line
↓
continue/backfill until up to 3 unique lines
```

If only one genuinely distinct line exists:

```text
return one line
```

Do not manufacture three.

---

# 30. P1 — current target ranking uses branch length, not full game length

This directly affects the request for shorter parties.

Current `rankPatternTargets()` uses:

```ts
target.line?.plies.length
```

But `target.line` starts from:

```text
target.position
```

after the discovery prefix.

Different targets may trigger at different plies.

Therefore the correct total length is:

```text
target.prefixPlies.length
+
target.line.plies.length
```

---

# 31. Example of the ranking bug

Target A:

```text
trigger at ply 40
continuation = 6 plies
full line = 46 plies
```

Target B:

```text
trigger at ply 10
continuation = 20 plies
full line = 30 plies
```

Current ranking sees:

```text
6 < 20
→ A wins
```

But the user sees:

```text
46 > 30
→ B is much shorter
```

For the requested output, B should rank ahead.

---

# 32. Correct target ranking

Rank by:

```text
1. HumanPath checkmate
2. forcedMate VERIFIED if desired as confidence tier
3. totalRootToTerminalPlies =
     prefixPlies.length + line.plies.length
4. target-family evidence / aesthetic tie-break
5. deterministic family key
```

Do not rank only by continuation length.

This fix directly improves displayed line quality.

---

# 33. Deduplication should happen before final top-3 slicing

Correct order:

```text
all eligible completed target branches

→ reconstruct full lines

→ group exact duplicate line signatures

→ choose representative per group

→ rank unique groups by full root-to-terminal length

→ return up to 3
```

Otherwise three aliases of one line can consume all three output slots.

That is exactly what the current output demonstrates.

---

# 34. Add near-duplicate detection later, but exact duplicate first

MVP:

```text
exact UCI full-line equality
```

is enough.

Later, optionally detect:

```text
same terminal position
same line except transposition
same final N plies
```

But do not delay the simple exact dedupe.

---

# 35. Simultaneous multi-family triggers should become a co-trigger cluster

When multiple families cross at the same post-Maia state:

```text
CORNER
KILL_BOX
TRIANGLE
```

record:

```ts
TargetTriggerCluster {
  positionHash,
  families: [...]
}
```

This gives valuable diagnostic information:

```text
Are these genuinely overlapping mating geometries?
Or are descriptors/calibration too broad?
```

You may still run more than one family branch if their steering objectives differ.

But treat the event as one trigger cluster, not three unrelated discoveries.

---

# 36. Add a family co-trigger/confusion report

For the calibration/end-to-end corpus report:

```text
P(A triggers | B triggers)
```

especially for families with suspected overlap.

Examples:

```text
CORNER vs KILL_BOX
CORNER vs TRIANGLE
KILL_BOX vs TRIANGLE
HOOK vs VUKOVIC
MORPHYS vs OPERA
BODEN vs DOUBLE_BISHOP
```

If three families almost always trigger together and produce identical continuations, the taxonomy/scorer may not be discriminating them usefully.

This is not necessarily a bug — some patterns genuinely overlap — but the UI/result model must represent overlap rather than pretending they are distinct lines.

---

# 37. Why games are still longer than plain Tal + Maia

The latest changes improved the situation, but the underlying reason remains partially present:

```text
plain Tal:
engine owns its own continuation

Pattern:
engine provides anchors,
Pattern chooses between them using geometry
```

That is acceptable only if Pattern stops taking control once mating conversion becomes concrete.

The current 52-move line still spends many moves converting a large advantage long after the tactical attack has simplified.

The system needs a stronger phase change.

---

# 38. Introduce explicit steering phases

Recommended:

```text
SEARCH
FORMING
BASIN
MATE_CLASS
FINISH
```

## SEARCH

Pattern is weak.

Behavior:

```text
Tal anchor set dominates.
Patricia override requires strong margin.
```

## FORMING

Attractor evidence is meaningful and increasing.

Behavior:

```text
Pattern has more influence between Tal anchors.
```

## BASIN

A target family is strongly established.

Behavior:

```text
prefer forcing Tal conversion;
stop optimizing merely for maintaining visual geometry.
```

## MATE_CLASS

Trusted Tal engine or independent verifier reports positive mate.

Behavior:

```text
shorter positive mate distance dominates.
```

## FINISH

Immediate mate is available.

Behavior:

```text
mate now.
```

---

# 39. Pattern affinity should decrease in authority after basin entry

This is a subtle but important design point.

Before the basin:

```text
Pattern tells Tal where to head.
```

Once inside the basin:

```text
Tal should increasingly decide how to convert.
```

Otherwise Pattern can orbit around a beautiful shape indefinitely.

A simple phase weighting:

```text
SEARCH:
Tal 90 / Pattern 10

FORMING:
Tal 65 / Pattern 35

BASIN:
Tal 80 / Pattern 20

MATE_CLASS:
mate distance / Tal dominates

FINISH:
checkmate dominates
```

Do not literally use these percentages unless useful; the point is the control policy.

Pattern influence should not monotonically increase forever.

---

# 40. Use Tal mate distance as the cleanest short-line signal

The project intentionally trusts ABSURD and EXTREME.

Therefore the most natural urgency signal is their own UCI score.

Capture for both anchors:

```text
cp score
mate score
PV
```

If:

```text
ABSURD = mate 9
EXTREME = mate 5
```

prefer EXTREME unless a special policy says otherwise.

If only one reports mate:

```text
prefer the mate-class Tal anchor
```

This solves many long-line problems without introducing Stockfish as ordinary move authority.

---

# 41. Independent Stockfish verification should prove, not normally play

Keep the architecture:

```text
Tal chooses chess
Stockfish verifies forced mate
```

Do not let Stockfish become the normal attacker.

However once a target position is reached, an asynchronous proof query can be useful for:

```text
forced-mate status
mate-distance upper bound
```

That metadata can shift the selector into `MATE_CLASS`.

Tal can still supply the actual move.

---

# 42. Current forced-mate verification happens too late to shorten the branch

Today verification is performed after `runTarget()` finishes.

That is good for reporting truth.

It does not help the branch finish earlier.

Optional improvement:

```text
at target/basin entry
→ run bounded forced-mate probe
```

If proof says:

```text
mate in N
```

record it as branch urgency metadata.

Do not block every move on a deep verifier call.

Possible strategy:

```text
one proof query at basin entry
then only re-probe if mate distance materially changes/stalls
```

This is optional after trusted Tal mate metadata is added.

---

# 43. Use total mate length as a first-class quality metric

The system currently reports lines but does not enforce:

```text
Pattern should not systematically double Tal's mating length.
```

Add:

```text
rootToMatePlies
```

for every HumanPath mate.

For each raw-game benchmark also compute:

```text
ABSURD baseline plies
EXTREME baseline plies
Pattern discovery plies
best unique target plies
```

Then:

```text
bestTalBaseline =
min(ABSURD, EXTREME)
```

and:

```text
mateLengthInflation =
PatternBest / bestTalBaseline
```

This makes "душная партия" measurable.

---

# 44. Suggested quality guard

Do not hardcode one universal ratio immediately, but report it.

A useful warning:

```text
if Pattern line is > 1.5× best Tal baseline
and no stronger forced-mate / target-quality reason exists:
    flag LONG_CONVERSION_REGRESSION
```

For the observed example:

```text
plain Tal ~32 moves
Pattern ~52 moves
ratio ~1.6×
```

That should be visible as a regression metric.

---

# 45. Add an A/B diagnostic runner

The previous review asked for this and it is still missing.

For the same input run:

```text
A. ABSURD + Maia
B. EXTREME + Maia
C. {ABSURD, EXTREME} anchors + Maia, no Pattern override
D. Tal anchors + Pattern, no Patricia
E. full Tal anchors + Patricia + Pattern
```

Report:

```text
HumanPath mate?
root-to-mate plies
first divergence from A/B
selected source sequence
Pattern override count
Patricia override count
stall fallback count
family switch count
first target trigger ply
target families
unique target lines
duplicate target line count
```

This isolates the source of regressions immediately.

---

# 46. Add exact decision-policy tests

The latest implementation added code for the new selector, but the most important policy cases still need explicit contracts.

Required tests:

```text
ABSURD and EXTREME are both treated as TAL_ANCHOR.

Patricia +0.07 advantage does NOT override if margin is .08.

Patricia +0.09 with progress <= .02 does NOT override.

Patricia +0.09 with progress > .02 DOES override.

Immediate checkmate beats huge attractor score.

Trusted ABSURD mate 5 is MATE_CLASS.

Trusted EXTREME mate 3 beats trusted ABSURD mate 5.

Stall falls back to a non-repeating Tal anchor when available.

Family switch under .05 does not occur.

Family switch above margin does occur.
```

These contracts are more important than generic boundedness tests.

---

# 47. Add target-output tests

Required:

```text
three family labels + identical full UCI line
→ one unique output line
→ alsoMatches has three families
```

And:

```text
four target branches:
two identical
two unique

→ final top-3 contains three unique lines
```

And:

```text
Target A:
prefix 40 + continuation 6 = 46

Target B:
prefix 10 + continuation 20 = 30

→ B ranks before A
```

This directly catches the current duplicate/length issue.

---

# 48. Add target-family escape tests

Example:

```text
preferred target = CORNER

candidate A:
continues CORNER, no mate class, calibrated .82

candidate B:
switches to BACK_RANK, calibrated .95, strong progress
```

Depending configured escape margin:

```text
B may escape
```

Also:

```text
candidate C = immediate mate
→ always escapes
```

And:

```text
candidate D = trusted Tal mate 3
→ mate-class escape
```

---

# 49. Improve trace semantics for short-line debugging

Each selected decision should record:

```text
selectedReason
bestTalUci
bestTalSource
bestTalMateScore?
bestExternalUci?
overrideMargin
stallCount
repetitionPenalty
previousTargetFamily
selectedTargetFamily
familySwitchMargin
phase
estimated/root mate distance if known
```

Target branch metadata:

```text
triggerPly
triggerFamily
triggerScore
fullRootToTerminalPlies
humanPathMate
forcedMate
fullLineSignature
alsoMatches[]
escapedToFamily?
```

Then one artifact is sufficient to explain why a 52-move line happened.

---

# 50. Fix the calibration artifact before interpreting new end-to-end quality

Because current family calibration is built with incorrect attacker-side semantics, do not spend too much time tuning:

```text
.08 Patricia margin
.02 progress
.05 family hysteresis
```

against the current output.

First:

```text
fix dataset attackerSide
rebuild calibration
re-run recognizer/evaluation
```

Then benchmark line quality.

Otherwise policy constants are being tuned against a corrupted score space.

---

# 51. Correct calibration rebuild order

Recommended sequence:

```text
1. Add attackerSide + trajectoryStartPly to dataset schema.

2. Rebuild Lichess dataset.

3. Verify every positive:
   terminal is mate,
   attackerSide is the mating side,
   actual puzzle start == trajectoryStartPly.

4. Build hard negatives inheriting attackerSide.

5. Score only applicable attack trajectory.

6. Fit discriminative raw→calibrated mappings
   with positives + hard negatives + controls.

7. Fit presence thresholds.

8. Fit basin/target triggers from distance-to-terminal
   and false-trigger constraints.

9. Run held-out evaluation.

10. Only then run end-to-end Pattern lines.
```

---

# 52. Production invariant for target trigger

At minimum:

```text
targetTriggerEvidence
>=
presenceEvidence
```

If thresholds are expressed in raw family-local space:

```text
rawTargetTrigger >= rawPresenceThreshold
```

If expressed in common calibrated space:

```text
calibratedTargetTrigger >= calibratedPresenceThreshold
```

A target basin cannot start before family presence.

Add a test across every production family.

---

# 53. Prefer calibrated common-space target triggering eventually

The cleanest eventual semantics:

```text
raw affinity
↓ family calibration
CalibratedAttractorScore
```

Then:

```text
presence threshold on common scale
target basin threshold on common scale
```

Family-specific differences live in the calibration map, not in ad-hoc downstream comparisons.

This makes cross-family reasoning much easier.

---

# 54. Mark weak families instead of forcing fake thresholds

If a family has too little separation on the current corpus:

```text
status = WEAK_SEPARATION
```

Then:

```text
may steer softly
must not launch fixed target branch
```

until improved.

This is safer than:

```text
presenceThreshold = 0
```

which effectively means "always present".

---

# 55. Co-trigger families may represent real overlap

Do not assume CORNER / KILL_BOX / TRIANGLE overlap is necessarily wrong.

Named mate taxonomies are not mutually exclusive.

One terminal mating structure may legitimately satisfy several geometric descriptions.

Therefore the correct product model is:

```text
one line
many family labels
```

not forced one-family exclusivity.

But excessive co-trigger rates should still be audited.

---

# 56. Primary family selection for a multi-label line

For a deduplicated line with:

```text
CORNER
KILL_BOX
TRIANGLE
```

choose `primaryFamily` by a transparent rule.

Recommended:

```text
1. highest calibrated evidence at first trigger
2. if tied, family whose evidence rose most from pre-trigger
3. if tied, strongest terminal calibrated evidence
4. deterministic family ID
```

Store all other valid families under:

```text
alsoMatches
```

This makes output concise without losing information.

---

# 57. Output format suggestion

Instead of:

```text
Target Corner
<same line>

Target Kill Box
<same line>

Target Triangle
<same line>
```

render:

```text
Target Corner Mate
Also matches: Kill Box, Triangle
Length: 74 plies
Trigger: ply 31
Forced mate: VERIFIED / NOT_VERIFIED / UNAVAILABLE

<line>
```

If another genuinely different line exists:

```text
Target 2: Morphy Mate
...
```

This is much more useful.

---

# 58. Short-line selector policy

Recommended final decision hierarchy:

```text
1. Immediate checkmate.

2. Positive trusted Tal mate-class:
   shorter mate distance first.

3. Other positive mate-class candidate admitted by Tal.

4. Trusted Tal anchor set:
   ABSURD + EXTREME,
   using calibrated attractor as steering influence.

5. Patricia-only override:
   only with explicit Tal admission,
   meaningful calibrated margin,
   positive progress,
   no repetition regression.
```

Once basin/target phase is entered:

```text
increase weight on conversion urgency,
decrease weight on preserving pattern resemblance.
```

---

# 59. Why this still preserves the project philosophy

This does NOT turn the project into Stockfish.

Tal still owns attacking chess.

ABSURD and EXTREME remain the two creative trusted ideas.

Pattern still influences which Tal idea is more promising geometrically.

Patricia still finds additional doors.

Maia still models a human.

The change is simply:

> A mating attractor must pull toward mate, not toward endless resemblance.

---

# 60. Updated priorities

## P0 — do before trusting calibration/results

```text
[ ] Add explicit attackerSide to dataset.

[ ] Use Lichess actual puzzle start (ply 1), not pre-puzzle ply 0.

[ ] Rebuild hard negatives with inherited attackerSide.

[ ] Regenerate all calibration artifacts.

[ ] Fit target basin using distanceToTerminal.

[ ] Ensure target trigger is never semantically weaker than presence.

[ ] Stop treating zero presence threshold as normal calibrated success.
```

## P1 — short-line quality

```text
[ ] Preserve root mate score/PV for ABSURD and EXTREME.

[ ] Make trusted Tal anchors eligible for MATE_CLASS.

[ ] Prefer shorter positive mate distance.

[ ] Add candidate-level repetition suppression.

[ ] Make fixed target family preferred rather than absolute.

[ ] Add basin→conversion phase shift.

[ ] Rank target results by full root-to-terminal length.
```

## P1 — output correctness/diversity

```text
[ ] Deduplicate target results by full UCI line signature.

[ ] Merge overlapping families into alsoMatches[].

[ ] Backfill until up to 3 UNIQUE lines are returned.

[ ] Add co-trigger/confusion metrics.
```

## P1 — regression safety

```text
[ ] Add A/B baseline runner.

[ ] Add mateLengthInflation metric.

[ ] Add selector-policy contract tests.

[ ] Add unique-target/dedupe/ranking tests.
```

---

# 61. Definition of Done for this review

I would consider this review satisfied when:

```text
1. Calibration positives and hard negatives use the same explicit attacker side.

2. Lichess pre-puzzle ply 0 is not mistaken for the attacker start.

3. CalibratedAttractorScore uses both positive and negative evidence.

4. Presence and target-basin thresholds have distinct, trajectory-grounded meanings.

5. No production family has target basin logically before pattern presence.

6. Trusted ABSURD/EXTREME mate scores are preserved as metadata without self-veto.

7. Shorter positive Tal mate distance outranks ordinary Pattern resemblance.

8. Repetition suppression acts on candidate resulting positions.

9. Target families are preferences with mate/stronger-basin escape rules.

10. Final target ranking uses full root-to-terminal length.

11. Identical chess lines are returned once, with multiple matching family labels.

12. Top-3 means top-3 unique lines, not top-3 labels.

13. End-to-end benchmark reports line-length inflation against both Tal baselines.

14. The observed Kg1/Kh1-style stalls disappear or become explicit fallback events.

15. The system can still choose either ABSURD or EXTREME depending on which gives
    the better/shorter Tal mating route.
```

At that point the behavior should match the intended philosophy:

```text
Tal plays the attack.

Pattern nudges Tal toward mating structures.

Maia makes the defense human.

Patricia widens the possibilities.

The system recognizes overlapping mate families honestly.

And once the attack becomes concrete, it finishes the mate instead of admiring
the geometry for another twenty moves.
```

---

# 62. Final assessment of the current 52-move run

The new run is an improvement.

That means the recent fixes are having a real effect.

But the remaining symptoms are diagnostic:

```text
52 moves vs ~32 Tal baseline
→ conversion still too slow

Kg1/Kh1/Qe7/Qf8 oscillation
→ candidate-level anti-stall still incomplete

CORNER/KILL_BOX/TRIANGLE identical
→ target results are family-deduped, not line-deduped

multiple simultaneous labels
→ likely overlap amplified by invalid current calibration

same long line under three fixed targets
→ fixed-family layer is not producing distinct useful alternatives
```

So the correct next step is **not another engine-role redesign**.

It is:

```text
fix attacker-side calibration
↓
rebuild common attractor scale
↓
make basin trigger trajectory-aware
↓
add Tal mate urgency
↓
dedupe target lines
↓
rank by full mate length
↓
benchmark against ABSURD and EXTREME baselines
```

That is the shortest path from the current implementation to the intended result:
**short, Tal-like, human-plausible mating lines with Pattern guidance instead of Pattern drag.**
