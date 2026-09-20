# Delta Review — Educational Beauty Layer

Repository: `chris-madsen/chess`  
Previous reviewed HEAD: `a50b9301957c5931abfe0aaf637b104a7cbb2292`  
Current reviewed HEAD: `2ad739fc2e700ec3bf56a75a77c1223b6f1f9681`  
Main implementation commit: `2ad739f — Add educational beauty ranking for pattern lines`  
Date: 2026-09-20

This is a **delta review only**. It covers what remains after the v4 review.

## Executive verdict

The new commit is a real architectural improvement:

```text
✓ LessonProfile exists
✓ continuation-only scoring starts at game.txt final position
✓ PatternFamily is no longer the only beauty concept
✓ ABSURD / EXTREME baselines are generated automatically
✓ 7-full-move shorter-Tal-alternative rule exists
✓ sacrifice / forcing / technicality feature framework exists
✓ exact target-line dedupe remains
✓ target ranking can use educational profiles
✓ queen-sacrifice Smothered fixture exists
```

But several low-level features do **not yet measure what their names claim**.

Main open issues:

```text
P0  production calibration artifact is stale
P0  PatternClarity uses raw cross-family affinity
P0  targetFamily artificially injects PatternClarity >= .97
P0  future-dependency / causal-preparation analysis is broken by one-pass replay
P1  sacrifice detection confuses exchanges with sacrifices
P1  EXCHANGE sacrifice is declared but effectively unreachable
P1  several tactical motifs are guessed from weak heuristics
P1  king-mobility metric measures all legal moves, not king mobility
P1  target prefix plies and target decision traces are misaligned
P1  promotion-grind penalty becomes zero if the line eventually mates
P1  short Tal alternative picks shortest baseline before filtering usable mates
P1  Pattern discovery is excluded from final lesson ranking
P1  plain ABSURD/EXTREME cannot currently win Recommended Lesson directly
P1  move-level selector still hard-prefers shorter mate-class before whole-line Beauty can compare alternatives
P1  real Rxf6/Qh6#, Qf8# and long bad lines are not yet regression fixtures
```

Do **not** redesign the architecture again. Repair feature semantics.

---

# 1. Correctly implemented: continuation-only scoring

`analyzeLessonLine()` starts from `ScenarioLine.start` and scores only generated plies.

That matches the product requirement:

```text
game.txt contains the user's first ~15–20 moves
Beauty judges only the generated continuation
```

Keep this invariant.

---

# 2. Correctly implemented: separate Beauty domain

These modules are the right direction:

```text
src/domain/lessons/lesson-profile.ts
src/domain/lessons/tactical-motifs.ts
src/application/use-cases/analyze-combination.ts
src/application/use-cases/rank-lesson-lines.ts
```

Beauty logic should remain outside `mate-geometry.ts`.

---

# 3. Correctly implemented: automatic Tal baselines

Raw-file mode now obtains plain:

```text
ABSURD + Maia
EXTREME + Maia
```

in both local and remote paths.

This is required for:

```text
shorter Tal alternative
mate-length comparison
quality regression
```

Good.

---

# 4. Correctly implemented: 7-full-move rule exists

`chooseShortTalAlternative()` computes the generated full-move gap and uses:

```text
gap > 7
```

This matches the requested product rule.

A selection bug remains in section 18.

---

# 5. P0 — calibrator changed but production calibration artifact was not regenerated

`pattern-calibrate.ts` changed in `2ad739f`.

But the commit delta does **not** update:

```text
src/domain/patterns/pattern-calibration.json
src/domain/patterns/pattern-calibration.generated.ts
```

Therefore runtime still consumes the previous generated calibration.

Required:

```bash
npm run pattern:calibrate
```

Commit both generated files.

Also add:

```text
pattern:calibrate:check
```

that regenerates to temporary files and fails if checked-in artifacts differ.

---

# 6. P1 — positiveNear is better but still collapses each case to one maximum

Current code now finds actual states where:

```text
distanceToTerminal <= 4
```

which is an improvement.

But then it stores only:

```ts
Math.max(...nearScores)
```

for that whole case.

This loses the actual basin distribution.

Prefer storing state-level pairs:

```ts
{
  score,
  distanceToTerminal,
  caseId
}
```

Then measure:

```text
first trigger crossing
distance at first crossing
trigger persistence
false-trigger rate
```

The basin question is not "what maximum score did the puzzle ever reach?"

---

# 7. P0 — PatternClarity reintroduces raw cross-family comparison

`analyze-combination.ts` reads:

```ts
selected.afterMaiaAffinity
```

for family scores.

That is raw family-local affinity.

Cross-family Lesson ranking must use:

```text
selected.calibratedAfterMaia
```

because raw affinity scales are not interchangeable.

This is the same semantic bug we previously removed from steering, now reintroduced inside Beauty.

---

# 8. P0 — targetFamily injects a fake .97 clarity score

Current code effectively does:

```ts
if (line.targetFamily !== undefined)
  familyScore = max(existing, .97)
```

This means any target branch is automatically treated as having at least 97% PatternClarity even if it later drifts away from the pattern.

That contaminates:

```text
patternClarity
combinationBeauty
lessonUtility
qualityTier
```

Remove this entirely.

`targetFamily` means:

```text
why this branch was launched
```

not:

```text
how clear the final lesson actually is
```

---

# 9. Correct PatternClarity

Compute it from actual completed-line evidence:

```text
calibrated terminal family score
+
calibrated near-terminal persistence
+
separation from competing families
```

Example:

```text
HOOK at trigger: .86
later: .48, .31, .18

→ final HOOK clarity should be low
```

The branch label must not override measured evidence.

---

# 10. P0 — future dependency analysis is broken by one-pass replay

The analyzer tries to inspect future moves while replaying the line forward.

It uses future `moves.slice(...)`, but the `positions` array contains only positions already replayed.

Therefore:

```text
laterDependencyCount
causalPreparation
opensLineToKing
patternRoleUsedLater
sacrifice.causal
```

can be wrong.

This is a structural bug.

---

# 11. Required fix: two-pass analysis

Pass 1:

```text
replay the complete line

store for every ply:
positionBefore
positionAfter
factsBefore
factsAfter
move
side
```

Pass 2:

```text
analyze each attacker move retrospectively
using the complete future trajectory
```

Only then can later dependency be evaluated correctly.

---

# 12. Do not infer Tal's intent

Important clarification:

From a completed Tal+Maia line we cannot know:

```text
"Tal planned this exact combination six moves earlier"
```

The Beauty layer should measure only:

```text
retrospective functional contribution
trajectory dependency
```

Optional future feature:

```text
PlanContinuityEvidence
```

may use stored Tal PVs if a future motif already appeared consistently in earlier PVs.

Even that is evidence of search continuity, not psychological intent.

Do not expose fields such as:

```text
planned=true
intent=true
```

---

# 13. Rename weak “causal” claims unless counterfactual evidence exists

Current heuristics often label a move/sacrifice `causal`.

That word is stronger than the implementation supports.

Prefer:

```text
functionalContribution
retrospectiveDependency
tacticalSupport
```

Reserve strong `causal` status for cases with counterfactual evidence:

```text
chosen move
vs other Tal-safe alternatives
```

showing that the attack materially depends on it.

---

# 14. P1 — sacrifice detection is too permissive

Current logic can treat an immediately recaptured piece as a sacrifice.

This can misclassify a normal exchange such as:

```text
QxQ
KxQ
```

as a queen sacrifice.

A sacrifice detector must distinguish:

```text
ordinary trade
temporary sacrifice
true material investment
exchange sacrifice
forced tactical liquidation
```

Do not award a large Beauty bonus merely because a moved piece is captured on the next ply.

---

# 15. P1 — EXCHANGE sacrifice is declared but cannot really be produced

`SacrificeType` includes:

```text
EXCHANGE
```

but the current mapping says a rook move is:

```text
ROOK
```

There is no material/context rule producing real exchange-sac semantics.

Implement:

```text
rook deliberately given for bishop/knight or lower material
with tactical/positional compensation
```

and test it.

---

# 16. P1 — soundOrForced is not soundness or forcedness

Current logic approximately equates:

```text
check / weak causal heuristic
```

with:

```text
soundOrForced
```

A checking sacrifice can be unsound.

Use actual evidence:

```text
Tal engine score
mate-class
forced-mate proof
score within Tal-safe bounds
```

Until then rename the field to something weaker such as:

```text
tacticallySupported
```

---

# 17. P1 — tactical motif detection currently overclaims

Examples of current heuristic problems:

```text
move to f/g/h file → DEFLECTION
capture + check → REMOVAL_OF_DEFENDER
long-range piece reused later → LINE_OPENING
```

These do not prove the named motif.

A tactical label should only be emitted when its geometry is verified.

For instance `REMOVAL_OF_DEFENDER` requires showing that the captured piece actually defended:

```text
a mating square
an escape square
an attack ray
a key defender
```

The motif enum is good; the detectors are only partially implemented.

---

# 18. P1 — king restriction metric is not king restriction

Current:

```text
current.legalMoves.length
-
next.legalMoves.length
```

counts all legal moves for different sides to move.

That is not:

```text
defending king mobility
```

Use:

```text
legal king moves / escape squares of the defending king
```

before and after.

Pattern geometry already has useful king-zone information.

---

# 19. P1 — target full-line traces are misaligned

For lesson analysis the target line is rebuilt as:

```text
discovery prefix plies
+
target continuation plies
```

but `decisionTraces` remain the target continuation traces only.

Then `analyzeLessonLine()` indexes traces as if they start at the root.

This can corrupt:

```text
mateClassCount
attractorDelta
Pattern evidence
```

for the prefix.

Required:

```text
fullDecisionTraces =
discovery traces up to trigger
+
target continuation traces
```

The full plies and full decision traces must share the same root timeline.

---

# 20. P1 — promotion-grind penalty is disabled exactly when a lesson eventually mates

Current logic includes:

```text
promotion exists
AND
!humanPathMate
```

So a line that:

```text
pushes a pawn forever
promotes
wanders
eventually mates
```

gets zero promotion-grind penalty.

That is the opposite of the intended use.

Measure instead:

```text
length of pawn march
plies from promotion to mate
forcingness around promotion
material phase
```

A tactical promotion immediately leading to mate gets little/no penalty.

A long technical promotion conversion gets a strong penalty even if it eventually mates.

---

# 21. P1 — shorter Tal alternative chooses the baseline in the wrong order

Current flow:

```text
take shortest baseline
then ask if it is eligible
```

Bug case:

```text
ABSURD: 6 moves, no mate / suppressed
EXTREME: 8 moves, clean mate
Lesson: 16 moves
```

The code chooses ABSURD first, then rejects it, and never considers EXTREME.

Correct:

```text
filter baselines:
humanPathMate
eligible
not duplicate of lesson

then select shortest
```

---

# 22. P1 — Pattern discovery is not a final lesson candidate

The final educational comparison currently chooses a target branch.

But the discovery line itself may be:

```text
shorter
more forcing
more coherent
```

than every target.

Analyze it too.

---

# 23. P1 — plain Tal baselines should be allowed to win Recommended Lesson

The candidate pool for final Lesson ranking should be:

```text
Pattern discovery
unique Pattern target branches
plain ABSURD + Maia
plain EXTREME + Maia
future distinct Tal-admitted branches
```

Then rank all completed unique lines.

If plain EXTREME produces the most instructive beautiful combination, it should simply become:

```text
Recommended lesson
```

Pattern is a generation mechanism, not a requirement that the winner carry a target label.

---

# 24. P1 — move-level mate selector still collapses educational alternatives too early

`pattern-steering.ts` was not changed in this commit.

It still orders mate-class candidates by:

```text
shorter mateDistance first
```

before whole-line Beauty ranking.

This means a slightly longer but much better lesson may never be generated.

The post-hoc LessonRanker cannot recover a branch that was killed at move 1.

---

# 25. Required mate-class generation policy

Keep:

```text
immediate mate → always first
```

But when ABSURD and EXTREME both have reasonable positive mate-class lines:

```text
preserve both continuations when computationally affordable
```

especially inside the educational budget.

A large mate-distance gap can favor urgency.

A modest gap should not destroy the alternative before full-line ranking.

---

# 26. P1 — Beauty weights are still heuristic

The implementation uses tiering, which is good.

But it also hardcodes formulas such as:

```text
.32 forcingness
.25 causalPreparation
.15 coordination
.18 patternClarity
...
```

and another weighted `lessonUtility`.

This is acceptable as an MVP scaffold.

Do **not** tune these weights yet.

First fix the features above.

Then calibrate preferences against curated comparisons.

---

# 27. Tests: queen-sac fixture is useful but insufficient

The new Smothered fixture correctly checks:

```text
queen sacrifice detected
QUEEN_SACRIFICE motif
short line
Tier A
```

Strengthen it to also verify:

```text
functional contribution is high
forcingness is high
Smothered family is correctly recognized
ordinary trade control does not get same sacrifice bonus
```

---

# 28. Missing real Rxf6/Qh6# fixtures

The user supplied several central positive examples:

```text
Rxf6 → Qh6#
second Rxf6 attack → Qh6#
English setup → Qf8#
```

These are essential because they demonstrate:

```text
ordinary final mate geometry
can still be a beautiful combination
```

They are not currently in `lesson-ranking.contract.test.js`.

Add them as actual replay/analyze regressions.

---

# 29. Missing real bad-line fixtures

The current test for technical grind constructs a profile manually with:

```text
technicalEndgamePenalty = .9
```

That only tests the ranker.

It does not prove `analyzeLessonLine()` recognizes the real bad 43–52 move outputs as technical.

Add the actual recent Pattern lines as negative fixtures.

Expected:

```text
low tier / suppressed
technical penalty high
stall/repetition recognized
promotion grind recognized if applicable
```

---

# 30. Missing promotion-grind mating fixture

Add:

```text
long pawn march
promotion
technical queen maneuvering
eventual mate
```

Expected:

```text
humanPathMate = true
promotionGrindPenalty > 0
```

Also add tactical promotion → immediate mate as a low-penalty control.

---

# 31. Missing functional-contribution controls

Add pair:

```text
A:
bishop moves to diagonal
later bishop actually controls mating square

B:
same-looking bishop move
later attack occurs elsewhere
```

Expected:

```text
A contribution > B contribution
```

Do not test or expose "intent".

---

# 32. General lesson candidates should be deduplicated too

`rankLessonLines()` itself does not dedupe.

Target branches are deduped before ranking.

Once the final candidate set includes:

```text
discovery
targets
ABSURD
EXTREME
```

dedupe by:

```text
fullLineSignature
```

before ranking.

Otherwise the same line can occupy multiple lesson slots under different sources.

---

# 33. Recommended implementation order

## Correctness first

```text
1. Regenerate + commit calibration artifacts.
2. Use calibrated PatternClarity.
3. Remove fake targetFamily .97 clarity floor.
4. Rewrite combination analyzer as two-pass.
5. Merge prefix + target decision traces.
6. Fix promotion-grind-on-mating-lines.
7. Fix usable-baseline filtering for short alternative.
```

## Feature semantics

```text
8. Real king-mobility delta.
9. Real line-opening geometry.
10. Real removal-of-defender geometry.
11. Repair sacrifice classification.
12. Implement EXCHANGE sacrifice.
13. Rename weak causal claims.
```

## Product completeness

```text
14. Analyze discovery as lesson candidate.
15. Rank discovery + targets + ABSURD + EXTREME together.
16. Preserve multiple reasonable mate-class Tal branches.
17. Dedupe complete lesson candidate set.
```

## Regression quality

```text
18. Add Rxf6/Qh6# fixtures.
19. Add Qf8# fixture.
20. Add actual 43–52 move negatives.
21. Add promotion-grind mate fixture.
22. Add functional-contribution controls.
```

---

# 34. Required acceptance tests

### Calibration freshness

```text
run calibrator
→ generated artifacts unchanged
```

### Target-label honesty

Branch launched as HOOK but final HOOK evidence collapses.

Expected:

```text
PatternClarity low
```

not `.97`.

### Calibrated family comparison

```text
raw A > raw B
calibrated A < calibrated B
```

Expected primary family:

```text
B
```

### Future dependency

Move creates a line later used for mate.

Expected:

```text
functional dependency detected
```

Unrelated control:

```text
not detected
```

### Ordinary queen trade

```text
QxQ KxQ
```

Expected:

```text
not automatically a causal queen sacrifice
```

### Exchange sacrifice

Expected:

```text
SacrificeType = EXCHANGE
```

for genuine rook-for-minor mating investment.

### Promotion grind that still mates

Expected:

```text
promotionGrindPenalty > 0
```

### Baseline fallback

```text
ABSURD 6 moves but suppressed
EXTREME 8 moves clean mate
Lesson 16
```

Expected:

```text
EXTREME shown as 8-move-shorter alternative
```

### Discovery can win

Discovery Tier A, targets Tier C/D.

Expected:

```text
discovery = Recommended lesson
```

### Plain Tal can win

EXTREME is best lesson.

Expected:

```text
EXTREME = Recommended lesson
```

---

# 35. Definition of Done

This delta is closed when:

```text
1. Checked-in calibration matches current calibrator.
2. PatternClarity uses calibrated actual evidence.
3. Target labels inject no fake clarity.
4. Combination analysis is two-pass.
5. Future dependencies use real future positions.
6. Intent is never inferred.
7. Weak causal claims are renamed or counterfactually supported.
8. Trades are not automatically sacrifices.
9. EXCHANGE sacrifice is actually detectable.
10. Tactical motifs are geometrically verified before being emitted.
11. King mobility measures king moves/escape squares.
12. Full target plies and decision traces are aligned.
13. Promotion grind is penalized even when mate eventually occurs.
14. Short Tal alternative filters usable mating baselines first.
15. Discovery participates in lesson ranking.
16. ABSURD/EXTREME may themselves win Recommended Lesson.
17. Multiple reasonable mate-class Tal branches survive for whole-line ranking.
18. General lesson candidates are deduped by full line.
19. Real Rxf6/Qh6# and Qf8# examples are golden positives.
20. Real 43–52 move technical lines are golden negatives.
```

## Final assessment

`2ad739f` is a substantial step forward.

The architecture is now close to what the trainer needs:

```text
Tal creates chess
Pattern creates direction/variety
Beauty judges completed continuations
LessonRanker chooses what is worth teaching
```

But the Beauty Layer currently optimizes several noisy or mislabeled measurements.

The next step is **not new architecture**.

It is to make the measurements honest and then validate them against the user's real examples.
