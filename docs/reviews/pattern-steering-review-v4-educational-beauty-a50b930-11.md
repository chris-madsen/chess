# Pattern Steering Review v4
## Educational beauty ranking, causal combination analysis, and short Tal alternatives

Repository: `chris-madsen/chess`  
Reviewed HEAD: `a50b9301957c5931abfe0aaf637b104a7cbb2292`  
Date: 2026-09-20

This review updates the previous Pattern Steering reviews with a more accurate product objective:

> The goal is **not** merely to reach a named mating geometry.
>
> The goal is to produce **short, Tal-like, human-plausible attacking continuations that are useful to learn from**, where a mating pattern is one important signal but not the sole definition of beauty.

The user supplies `game.txt` with roughly the first 15–20 moves already played.

Therefore:

> **Opening/debut quality is out of scope for this layer.**
>
> Treat the final position in `game.txt` as the analysis root.
> Do not score or optimize the user's opening/preparation.
> All beauty, combination, length and educational metrics in this review apply to the generated continuation after the input position.

The history before the root should still be preserved for legal repetition/history-sensitive Maia behavior and for rendering the complete PGN, but it should not be part of the Beauty score.

---

# 1. Revised product objective

The intended stack is:

```text
game.txt final position
        ↓
Tal Anchor Set
    ABSURD + EXTREME
        +
Patricia exploration
        ↓
Tal admission for external moves
        ↓
Maia human-response model
        ↓
Pattern Attractors
        ↓
multiple complete candidate continuations
        ↓
Combination / Beauty Analyzer
        ↓
Educational Lesson Ranker
        ↓
best unique lesson line
+ shorter Tal alternative when meaningfully shorter
```

The most important architectural change in this review is:

> **Pattern Steering may help GENERATE interesting lines.**
>
> **Beauty / educational value should primarily RANK completed lines, not micromanage every individual move.**

This avoids the previous failure mode where a local scalar Pattern score caused wandering and pattern-preserving shuffles instead of completing a coherent combination.

---

# 2. What current master already fixed

Current `a50b930` has correctly implemented several previous review items.

Keep these changes.

- ABSURD and EXTREME are peer trusted Tal anchors.
- Patricia-only moves require Tal admission.
- Trusted Tal root candidates can now retain `engineScore`, `enginePv`, `engineRank`.
- Mate-class detection can use trusted Tal engine metadata without self-veto.
- Candidate-level repetition avoidance exists.
- Fixed target-family steering can escape to another family on a significant calibrated advantage.
- Dataset rows now carry `attackerSide` / `trajectoryStartPly`.
- Exact duplicate target lines can be merged and shown with `alsoMatches[]`.

Do not undo these.

---

# 3. Current mate-class ordering is too rigid for a trainer

The latest selector prefers shorter positive `mateDistance` before Pattern quality.

For a general engine this is reasonable.

For this trainer it is too rigid.

Example:

```text
ABSURD:
mate in 10

EXTREME / Pattern-guided:
mate in 16
clean queen sacrifice
high forcingness
strong instructional pattern
```

The trainer should be allowed to prefer the second line.

The product objective is not:

```text
always minimize mate distance
```

It is:

```text
find the best educational attacking combination
within a reasonable length budget
```

---

# 4. Educational mate budget

Introduce an explicit concept:

```ts
EducationalMateBudget
```

Recommended initial semantics for `BEAUTIFUL_MIDDLEGAME`:

```text
final game move <= 30:
    preferred short lesson range

31–35:
    acceptable medium range

36–40:
    long; require exceptional combination value

>40:
    normally suppress unless exceptionally instructive

technical low-material continuation:
    additional strong penalty
```

Because `game.txt` already contains the fixed user prefix, also store:

```text
inputFinalMoveNumber
generatedContinuationPlies
generatedContinuationFullMoves
finalMateMoveNumber
```

The opening prefix itself is not scored.

---

# 5. The 7-move alternative rule

The explicit product preference:

> If the short Tal line is more than **7 full moves shorter** than the selected educational line, show both.

Let:

```text
lessonLine
shortTalLine
```

be distinct unique complete lines.

Define:

```text
lengthGapFullMoves =
lessonLine.generatedContinuationFullMoves
-
shortTalLine.generatedContinuationFullMoves
```

Policy:

```text
if same chess line:
    show once

else if lessonLine is within educational budget
and lengthGapFullMoves <= 7:
    lessonLine may be primary
    shorter Tal line does not need a separate prominent slot

else if lengthGapFullMoves > 7:
    show BOTH
```

Suggested rendering:

```text
Recommended lesson
Queen sacrifice → Smothered Mate
Mate on move 27

Shorter Tal alternative
Mate on move 19
8 moves shorter
```

Use full moves, not plies.

---

# 6. Do not hard-rank mate families by beauty

Do not create:

```text
SMOTHERED = beautiful
BALESTRA = boring
DOVETAIL = beautiful
```

A Balestra ending may be trivial, or it may be the endpoint of an excellent sacrifice.

A Smothered Mate may be beautiful, or it may arise from a dull technical sequence.

Therefore:

```text
MateFamily
```

describes the endpoint.

It is not the Beauty score.

---

# 7. Separate three concepts

## PatternClarity

How clearly the final/near-final geometry expresses a recognizable mating motif.

## CombinationBeauty

How coherent, forcing, sacrificial and tactically connected the generated continuation is.

## LessonUtility

The final product-ranking quantity combining:

```text
CombinationBeauty
PatternClarity
length
mate certainty
middlegame relevance
uniqueness
technical-grind penalties
```

The line shown first should maximize `LessonUtility`, not raw PatternAffinity.

---

# 8. Scope boundary: game.txt is the root

Do not score the user's first 15–20 moves.

For raw-file mode:

```text
analysisRootPly = existing PGN ply count
```

Every beauty feature is computed only on:

```text
generated continuation
```

The complete PGN can still be displayed.

---

# 9. Optional combination onset inside the generated continuation

The generated continuation may include a few preparatory moves before the tactical break.

It can be useful for explanation to detect:

```text
CombinationOnset
```

Example:

```text
Qe2
Bd2
Rxf6!
...
Qh6#
```

The entire generated continuation is still evaluated.

For explanation the analyzer may say:

```text
Tactical break: Rxf6!
```

Do not use this to analyze the opening before `game.txt`.

---

# 10. How to distinguish “they just stood there” from a real plan

Do **not** claim to read intention.

The engine cannot know whether a human intended a future mate.

Instead measure:

```text
causal contribution of each generated move to the eventual attack
```

The computational question is:

> Did this move functionally create or enable something that the later combination actually used?

This is testable.

---

# 11. CausalMoveContribution

For every attacker move in the generated continuation compute a feature record.

Suggested type:

```ts
type CausalMoveContribution = {
  move: UciMove;

  createsThreat: boolean;
  givesCheck: boolean;
  captures: boolean;

  opensLineToKing: boolean;
  closesDefenderLine: boolean;

  removesDefender: boolean;
  deflectsDefender: boolean;
  overloadsDefender: boolean;
  pinsDefender: boolean;

  activatesPatternRole: boolean;
  patternRoleUsedLater: boolean;

  restrictsKingMobilityDelta: number;
  defenderReplyEntropyDelta: number;

  mateDistanceDelta?: number;
  attractorDelta: number;

  laterDependencyCount: number;
  counterfactualImportance?: number;
};
```

MVP does not need every field.

Start with robust, cheap features.

---

# 12. Temporal dependency is the strongest evidence of functional preparation

A preparatory move is meaningful when later moves depend on it.

Examples:

```text
rook moves to f-file
→ later sacrifices on f6/f8

bishop moves to diagonal
→ later covers mating square

queen transfers to h-file
→ later delivers Qh6#/Qh7#

pawn push opens file
→ later rook/queen uses that file
```

Build lightweight dependency links.

If a later combination actually uses:

```text
that piece
that square
that line
or the control created by that move
```

then the move receives a real preparation bonus.

---

# 13. Pattern-role activation

The Pattern Layer already knows structural roles such as:

```text
heavy corridor
bishop support
knight net
escape coverage
blocker geometry
```

Use these retrospectively.

If a move places a piece into a role that later remains part of the successful terminal pattern:

```text
activatesPatternRole = true
patternRoleUsedLater = true
```

That is strong evidence of functional preparation.

But do not reward geometry alone.

---

# 14. Threat / forcing contribution

A coherent combination tends to reduce defender freedom.

Useful features:

```text
gives check
creates direct mate threat
reduces king escape squares
forces capture
forces recapture
forces king movement
reduces plausible Maia replies
improves positive mate-class status
```

MVP can use checks/captures/legal replies.

Later use Maia top-k entropy.

---

# 15. Reply entropy

All legal replies are not equally relevant.

Eventually compute:

```text
DefenderReplyEntropy
```

from Maia top-k probabilities.

Example:

```text
before:
5 plausible replies

after sacrifice:
one reply = 86%
```

That move is strongly forcing for the modeled human.

---

# 16. Counterfactual importance

For important moves ask:

> What happens if this move is not played?

Do not literally remove the move.

From the position before it, compare:

```text
chosen move
vs
other Tal-safe anchor candidates
```

Then compare:

```text
mate class
mate distance
king restriction
forcingness
future Pattern/Beauty continuation
```

Use this expensive analysis selectively for:

```text
sacrifices
large geometry jumps
line-opening moves
quiet moves immediately before a forcing sequence
```

---

# 17. Do not reward passive geometry

A sequence should not receive major CombinationBeauty merely because pieces ended on aesthetically matching squares.

Require at least one of:

```text
later tactical dependency
forcing improvement
king mobility restriction
line opening
defender removal
mate-distance improvement
persistent pattern role used by the terminal mate
```

Otherwise classify it as:

```text
PASSIVE_GEOMETRY
```

not meaningful preparation.

---

# 18. Suggested move-role labels

Useful descriptive labels:

```text
SETUP
IMPROVEMENT
BREAKTHROUGH
SACRIFICE
DEFLECTION
REMOVAL_OF_DEFENDER
LINE_OPENING
FORCING_CHECK
MATE_CONVERSION
TECHNICAL
NEUTRAL_MANEUVER
```

These describe function, not psychological intent.

---

# 19. Sacrifice quality

Sacrifice should be important, but not boolean.

Suggested model:

```ts
type SacrificeProfile = {
  type:
    | "QUEEN"
    | "ROOK"
    | "EXCHANGE"
    | "MINOR"
    | "PAWN";

  causal: boolean;
  soundOrForced: boolean;
  mateDistanceAfterSacrifice?: number;

  motif:
    | "DEFLECTION"
    | "DECOY"
    | "LINE_OPENING"
    | "REMOVAL_OF_DEFENDER"
    | "BLOCKING"
    | "KING_EXPOSURE"
    | "OTHER";
};
```

A queen sacrifice followed by a forced Smothered Mate should score extremely high.

A pseudo-sacrifice with no causal relation to mate should score much less.

---

# 20. Causal sacrifice > piece value alone

Example:

```text
Qc8+!
Rxc8
Nd7#
```

The queen sacrifice directly creates the final geometry.

That is a top-tier instructional motif.

Use:

```text
causality
forcingness
proximity to mate
material value
```

rather than piece value alone.

---

# 21. Forcingness

Define a line-level `ForcingnessScore`.

Suggested inputs:

```text
attackerCheckRatio
forcedReplyCount
captureWithTempoRatio
mateClassFraction
averagePlausibleDefenderReplies
```

The six-move queen-sac Smothered example should be a golden positive fixture.

---

# 22. Pattern clarity

`PatternClarity` should answer:

```text
Can a student recognize and understand the mating motif?
```

Useful inputs:

```text
terminal calibrated family score
family separation from confusable families
critical role completeness
escape coverage
persistence over final N plies
```

Keep it independent from CombinationBeauty.

---

# 23. Ordinary final geometry may still be excellent

A final queen+bishop mate may look ordinary.

But if the continuation contains:

```text
Rxf6!
line opening
king exposure
removal/deflection
queen transfer
Qh6#
```

then LessonUtility can be very high.

Therefore in `BEAUTIFUL_MIDDLEGAME`:

```text
CombinationBeauty > family-name prestige
```

---

# 24. Middlegame vs technical grind

Only inspect the generated continuation.

Useful metrics:

```text
materialPhaseAtRoot
materialPhaseAtTacticalBreak
materialPhaseDuringLastThird
```

A sacrifice may reduce material dramatically before mate; that alone is not a boring endgame.

---

# 25. TechnicalEndgamePenalty

Apply a strong penalty when the continuation becomes:

```text
few pieces remain
kings walk for many moves
passed pawn pushed repeatedly
promotion
long cleanup
mate much later
```

Signals:

```text
low material phase
+
many non-check/non-capture attacker moves
+
no mate-class
+
long continuation
```

This fits the recent undesirable 40–50 move outputs.

---

# 26. Promotion is not automatically bad

Distinguish:

```text
TACTICAL_PROMOTION
```

from:

```text
TECHNICAL_PROMOTION_GRIND
```

A tactical underpromotion can be beautiful.

A ten-move passed-pawn march after the attack died should be penalized in this mode.

---

# 27. Repetition/stall penalty

Keep candidate-level repetition protection.

Also record line-level:

```text
repeatedPositionCount
nonProgressAttackerMoves
stallFallbackCount
```

These strongly reduce LessonUtility.

---

# 28. Length metrics

Store:

```text
finalMateMoveNumber
generatedContinuationFullMoves
generatedPlies
```

For branch comparison use generated continuation length.

For display use final move number.

---

# 29. Current target ranking still needs full-length correction

Current `rankPatternTargets()` still sorts by:

```ts
target.line?.plies.length
```

which measures only the tail after the target trigger.

The model already stores:

```text
fullRootToTerminalPlies
```

Use it.

Otherwise a late trigger with a six-ply tail can incorrectly outrank a genuinely shorter root-to-mate line.

---

# 30. Target dedupe is now correct in spirit

Keep exact full-line dedupe and:

```text
alsoMatches[]
```

If one line matches several families, show one line with several tags.

Do not force fake diversity.

---

# 31. Top-3 means top-3 unique lessons

Correct pipeline:

```text
all completed branches
↓
full-line exact dedupe
↓
Beauty analysis
↓
Lesson ranking
↓
up to 3 unique lines
```

If only one good line exists, show one.

---

# 32. Current target-basin calibration is still not actually distance-grounded

Current calibration has `positiveNear`, but it still pushes the **maximum score of the whole case** into `positiveNear` when the case contains a near-terminal state.

That does not collect near-terminal scores.

It collects case maxima.

This needs correction.

---

# 33. Correct positiveNear

Collect state-level scores:

```ts
type DistanceScore = {
  raw: number;
  distanceToTerminal: number;
};
```

Then:

```text
positiveNear += scores where distanceToTerminal <= N
```

Do not use the case-wide maximum.

---

# 34. Basin trigger semantics

Target-basin calibration should mean:

```text
high likelihood of being within N plies of terminal mating geometry
+
low hard-negative trigger rate
```

Report:

```text
firstTriggerDistance
triggerPersistence
falseTriggerRate
```

This remains necessary for trustworthy target labels.

---

# 35. Beauty should rank complete lines

Do not build a giant `BeautyScore(move)` and let it dominate every move.

Use:

```text
generate several coherent lines
↓
analyze complete lines
↓
rank lessons
```

Pattern remains generation guidance.

Beauty is primarily post-generation selection.

---

# 36. Candidate line sources

Retain/generate at minimum:

```text
A. plain ABSURD + Maia
B. plain EXTREME + Maia
C. Pattern-guided Tal-anchor line
D. Pattern target branches
E. Patricia-discovered Tal-approved distinct alternatives
```

Then deduplicate.

This gives the LessonRanker real alternatives.

---

# 37. LessonProfile

Suggested line-level model:

```ts
type LessonProfile = {
  lineId: string;

  generatedPlies: number;
  generatedFullMoves: number;
  finalMateMoveNumber?: number;

  humanPathMate: boolean;
  forcedMateStatus: "VERIFIED" | "NOT_VERIFIED" | "UNAVAILABLE";

  mateFamilies: readonly PatternFamilyId[];
  primaryMateFamily?: PatternFamilyId;
  patternClarity: number;

  sacrifices: readonly SacrificeProfile[];

  forcingness: number;
  causalPreparation: number;
  pieceCoordination: number;

  repetitionCount: number;
  nonProgressMoveCount: number;

  technicalEndgamePenalty: number;
  promotionGrindPenalty: number;

  combinationBeauty: number;
  lessonUtility: number;

  motifs: readonly TacticalMotif[];
};
```

MVP can start smaller.

---

# 38. Avoid one giant arbitrary linear formula

Do not begin with:

```text
+17 queen sacrifice
-9 endgame
+6 Smothered
```

Use:

```text
hard eligibility gates
→ tiered / lexicographic ranking
→ small weighted tie-break
```

This is much easier to reason about and test.

---

# 39. Eligibility gates

For `BEAUTIFUL_MIDDLEGAME`, reject or strongly demote lines that:

```text
do not mate
contain unresolved repetition/stall
are extreme technical grinds
are excessively long without exceptional tactical value
duplicate a stronger existing line
```

Forced-mate verification is confidence metadata, not necessarily a hard gate.

---

# 40. Educational quality tiers

## Tier A — short tactical combination

```text
short continuation
high forcingness
causal sacrifice OR strong tactical transformation
clean mate
no technical grind
```

## Tier B — short pattern lesson

```text
short continuation
high PatternClarity
coherent preparation/coordination
```

## Tier C — medium tactical combination

```text
31–35 final move range
high CombinationBeauty
```

## Tier D — medium pattern lesson

```text
31–35
good PatternClarity
moderate forcingness
```

## Tier E — long exceptional line

```text
>35
only if unusually strong educational/tactical value
```

## Suppressed

```text
long low-material technical conversion
promotion grind
repetition-heavy line
pattern label with little tactical story
```

---

# 41. Sacrifice raises a line within its quality class

Within otherwise comparable lines:

```text
causal queen sacrifice
>
causal rook/exchange sacrifice
>
causal minor sacrifice
>
no sacrifice
```

But do not make this absolute.

A brilliant forcing non-sacrificial line can still outrank a bad sacrifice.

---

# 42. PatternClarity vs CombinationBeauty

Example A:

```text
clean Smothered pattern
no sacrifice
short forced sequence
```

High PatternClarity.

Example B:

```text
ordinary queen+bishop mate
Rxf6!
deflection / line opening
forced queen transfer
mate in 5–6 generated moves
```

Very high CombinationBeauty.

In `BEAUTIFUL_MIDDLEGAME`, B may rank above A.

That is intended.

---

# 43. Golden fixture A — queen-sacrifice Smothered Mate

FEN:

```text
r1k4r/ppp1bq1p/2n1N3/6B1/3p2Q1/8/PPP2PPP/R5K1 w - - 0 1
```

Line:

```text
1. Nc5+ Qe6
2. Qxe6+ Kb8
3. Nd7+ Kc8
4. Nb6+ Kb8
5. Qc8+! Rxc8
6. Nd7#
```

Expected:

```text
very short continuation
queen sacrifice causal
very high forcingness
very high PatternClarity
no technical endgame
top-tier LessonUtility
```

---

# 44. Golden fixture B — Rxf6 → Qh6#

Use the supplied game continuation.

Expected:

```text
ordinary-looking final geometry is not penalized heavily
Rxf6 receives high tactical/causal importance
short conversion
high forcingness
high CombinationBeauty
high LessonUtility
```

This proves:

```text
beauty != exotic MateFamily
```

---

# 45. Golden fixture C — second Rxf6 game

Use the second supplied game as another positive.

Expected:

```text
same broad attack mechanism
different concrete tactics
high CombinationBeauty
```

This prevents overfitting to one line.

---

# 46. Golden fixture D — English setup / Qf8#

Use the supplied continuation from the user-provided root/history.

Expected:

```text
short tactical conversion
strong piece coordination
high LessonUtility
```

Again, terminal geometry need not be exotic.

---

# 47. Negative fixtures

Use recent 43–52 move Pattern outputs.

Expected:

```text
PatternClarity may be high

BUT:
long continuation
stall/repetition
technical simplification
promotion grind / low-material conversion
low forcingness for long stretches

→ low LessonUtility
```

These are valuable negatives.

---

# 48. Pairwise beauty preferences

Start storing:

```text
A > B
```

Examples:

```text
queen-sac Smothered
>
43-move Dovetail grind

Rxf6 Qh6#
>
52-move technical Pattern line
```

Suggested type:

```ts
type BeautyPreference = {
  preferredLineId: string;
  rejectedLineId: string;
  reasonTags?: readonly string[];
};
```

After enough examples, fit an interpretable pairwise ranker.

---

# 49. Do not start with a black-box model

Future ranker options:

```text
logistic pairwise ranking
small gradient-boosted ranker
isotonic preference model
```

Keep features explicit and explanations available.

---

# 50. Tactical motif analyzer

Add trajectory motifs independent of MateFamily:

```text
QUEEN_SACRIFICE
ROOK_SACRIFICE
EXCHANGE_SACRIFICE
DEFLECTION
DECOY
REMOVAL_OF_DEFENDER
LINE_OPENING
DISCOVERED_ATTACK
PIN
OVERLOAD
CLEARANCE
KING_HUNT
MATING_NET
FORCED_RECAPTURE
```

These are often more educational than the final mate-family name.

---

# 51. Attack archetypes without opening analysis

The user does not need opening analysis.

But from the generated continuation the system can still label:

```text
F_FILE_BREAK
H_FILE_ATTACK
KING_HUNT
QUEEN_TRANSFER
EXCHANGE_SACRIFICE_ON_KING_FILE
```

This begins at the `game.txt` root.

It does not judge moves 1–15/20.

---

# 52. Lesson output example

```text
Recommended lesson
------------------
Attack: exchange sacrifice on f-file
Motifs: removal of defender, line opening, queen transfer
Mate: Queen + Bishop
Generated continuation: 6 moves
Mate on move 21
Forced mate: VERIFIED

Why selected:
+ short attack
+ causal rook sacrifice
+ high forcingness
+ clear mating finish
+ no repetition
```

If appropriate:

```text
Shorter Tal alternative
-----------------------
Generated continuation: 4 moves
Mate on move 19
8 moves shorter
```

---

# 53. Exact 7-full-move policy

Add:

```ts
const SHORT_ALTERNATIVE_GAP_FULL_MOVES = 7;
```

If the distinct Tal line is more than 7 full moves shorter:

```text
include it in output
```

Use explicit full-move metrics to avoid ply ambiguity.

---

# 54. If both lines are under 30

If both are within the preferred short range:

```text
Pattern/educational line may rank primary
```

even when Tal is somewhat shorter.

If gap >7:

```text
show both
```

---

# 55. Pattern line 31–35

Allow it to remain primary only if CombinationBeauty is clearly strong.

If a Tal line is >7 moves shorter:

```text
show both
```

---

# 56. Pattern line >35

Require exceptional instructional quality.

If it is:

```text
technical
low material
low forcingness
promotion grind
```

demote it below the much shorter Tal line.

A >40 move technical continuation should normally disappear in `BEAUTIFUL_MIDDLEGAME`.

---

# 57. Future trainer modes

Later separate:

```text
BEAUTIFUL_MIDDLEGAME
PATTERN_DRILL
ENDGAME_MATES
SHORTEST_TACTICAL_MATE
```

Current work should optimize `BEAUTIFUL_MIDDLEGAME`.

---

# 58. Move-level selector change

Current mate-class sorting makes shorter mate distance absolute.

Relax that.

Suggested move-level policy:

```text
immediate mate
→ always first

mate-class candidates
→ keep multiple reasonable short mate candidates viable

large mate-distance gap
→ urgency increasingly matters

small/medium gap within educational budget
→ Pattern/Tal steering may choose
```

Final educational decision belongs to whole-line ranking.

---

# 59. Prefer branching to premature collapse

When ABSURD and EXTREME both see attractive mate-class continuations, keep both as candidate lesson lines when computationally affordable.

Then compare complete lines.

This is better than guessing full-line beauty from one root move.

---

# 60. Always generate plain Tal baselines for raw-file mode

Run/cache:

```text
ABSURD + Maia
EXTREME + Maia
```

alongside Pattern steering.

Needed for:

```text
shorter Tal alternative
mate-length inflation
quality comparison
regression detection
```

The user should not need a second CLI command.

---

# 61. Store baseline comparison

Example artifact:

```json
{
  "baseline": {
    "absurd": { "humanPathMate": true, "generatedFullMoves": 7 },
    "extreme": { "humanPathMate": true, "generatedFullMoves": 10 }
  },
  "lesson": {
    "generatedFullMoves": 13,
    "beautyTier": "A"
  },
  "shortAlternative": {
    "source": "ABSURD",
    "gapFullMoves": 6,
    "shown": false
  }
}
```

---

# 62. Full-line Beauty pipeline

```text
ScenarioLine
   ↓
replay generated continuation
   ↓
LineFeatureExtractor
   ├─ length
   ├─ material phase
   ├─ checks/captures
   ├─ king mobility
   ├─ repetition
   ├─ sacrifices
   ├─ tactical motifs
   ├─ Pattern assessments
   ├─ Tal mate metadata
   └─ causal dependencies
   ↓
LessonProfile
   ↓
LessonEligibility
   ↓
LessonRanker
```

Keep this separate from `mate-geometry.ts`.

---

# 63. Suggested module boundaries

```text
src/domain/lessons/lesson-profile.ts
src/domain/lessons/tactical-motifs.ts
src/application/use-cases/analyze-combination.ts
src/application/use-cases/rank-lesson-lines.ts
src/application/use-cases/select-lesson-output.ts
```

Do not mix beauty logic into MateGeometry.

---

# 64. Unit test: causal preparation

Synthetic test:

```text
move opens rook file
later rook uses that file for mate
```

Expected:

```text
opensLineToKing=true
laterDependencyCount>0
```

Control:

same rook move, but later mate uses another wing.

Expected:

```text
low causal contribution
```

---

# 65. Unit test: sacrifice causality

Golden queen-sac line:

Expected:

```text
QUEEN sacrifice
causal=true
mateDistanceAfterSacrifice small
high forcingness
```

Control line where queen is lost and attack fails:

```text
no meaningful sacrifice beauty bonus
```

---

# 66. Unit test: ordinary mate can rank high

Rxf6 → Qh6# fixture:

Expected:

```text
mate family can be ordinary
CombinationBeauty high
LessonUtility high
```

This prevents named-family prestige from dominating.

---

# 67. Unit test: exotic pattern can rank low

Long technical Dovetail/Corner/etc line:

Expected:

```text
PatternClarity high is allowed

BUT:
technical penalty high
forcingness low
continuation long

→ LessonUtility low
```

---

# 68. Test the 7-move rule

Case:

```text
lesson = 12 generated full moves
shortTal = 8
gap=4
```

Expected:

```text
lesson may be primary
no mandatory extra short-line slot
```

Case:

```text
lesson = 16
shortTal = 8
gap=8
```

Expected:

```text
both returned
```

---

# 69. Test under-30 preference

```text
Pattern lesson:
mate move 27
high CombinationBeauty

Tal:
mate move 21
ordinary but sound
```

Expected:

```text
Pattern lesson may be primary
```

because both are short enough and gap <=7.

---

# 70. Test long technical Pattern loss

```text
Pattern:
mate move 45
technical grind

Tal:
mate move 25
clean tactical line
```

Expected:

```text
Tal primary
Pattern suppressed or secondary only if exceptional
```

---

# 71. Test full root-to-terminal ranking

```text
A:
trigger prefix 40 plies
target tail 6
full 46

B:
trigger prefix 10
target tail 20
full 30
```

Expected:

```text
B ranks shorter
```

Use `fullRootToTerminalPlies`.

---

# 72. Test unique-line output

Three family labels produce the exact same UCI line.

Expected:

```text
one lesson line
primary family
alsoMatches = other two
```

Then backfill another unique line if available.

---

# 73. Baseline quality regression

For every curated raw game:

```text
ABSURD
EXTREME
Pattern
```

Report:

```text
bestTalGeneratedMoves
lessonGeneratedMoves
gap
stallCount
technicalPenalty
beautyTier
```

Flag:

```text
LONG_CONVERSION_REGRESSION
```

when Pattern is much longer without compensating lesson value.

---

# 74. Explanation is part of the product

Every selected lesson should expose reasons.

Example:

```text
Selected because:
+ causal exchange sacrifice
+ forcing attack
+ 5-move conversion
+ clear queen+bishop finish
+ no repetition

Rejected Dovetail line:
- 19-move technical conversion
- low-material phase
- no causal sacrifice
- repeated non-progress manoeuvres
```

Useful for both debugging and teaching.

---

# 75. Never call this “intent detection”

Use:

```text
causal preparation
functional contribution
tactical dependency
combination role
```

We measure what the move did, not what a player thought.

---

# 76. Optional later: user-trained BeautyRanker

Once enough pairwise preferences exist, train an interpretable ranker on:

```text
length
forcingness
sacrifice profile
pattern clarity
technicality
causal preparation
mate confidence
motif density
```

This can learn the user's real aesthetic preferences.

---

# 77. Beauty never overrides tactical authority

Even a learned BeautyRanker only ranks already-admissible completed lines.

It must never resurrect a Patricia move Tal rejected.

Keep:

```text
Tal = chess authority
Beauty = lesson ranking
```

---

# 78. Current calibration item still open

Although attacker-side metadata is now fixed, `positiveNear` is still not true state-level distance-to-terminal calibration.

Fix it before trusting basin labels.

---

# 79. Revised priority list

## P0 — correctness

```text
[ ] Fix positiveNear to use actual near-terminal state scores.

[ ] Rebuild calibration and validate basin first-crossing distance.

[ ] Rank targets by fullRootToTerminalPlies.
```

## P1 — educational generation

```text
[ ] Stop "shorter mate always wins" inside educational budget.

[ ] Preserve multiple ABSURD/EXTREME mate-class lesson branches.

[ ] Generate plain ABSURD + Maia and EXTREME + Maia baselines automatically.

[ ] Implement the >7-full-move short-alternative rule.
```

## P1 — Beauty / combination layer

```text
[ ] Add LessonProfile.

[ ] Add continuation-length metrics.

[ ] Add ForcingnessScore.

[ ] Add sacrifice detection and causal sacrifice.

[ ] Add tactical motif detection.

[ ] Add causal move contribution / temporal dependencies.

[ ] Add technical-endgame and promotion-grind penalties.

[ ] Add PatternClarity separate from CombinationBeauty.

[ ] Add tiered LessonUtility ranking.
```

## P1 — regression suite

```text
[ ] Queen-sac Smothered golden fixture.

[ ] Rxf6 → Qh6# positive fixtures.

[ ] English/Qf8# positive fixture.

[ ] Recent 43–52 move outputs as low-priority negatives.

[ ] 7-move policy tests.

[ ] Under-30 educational preference test.

[ ] Full-length target ranking tests.

[ ] Unique-line dedupe tests.
```

---

# 80. Definition of Done

This educational layer is correct when:

```text
1. The first 15–20 moves in game.txt are fixed user input and not Beauty-scored.

2. Only generated continuations are ranked for combination quality.

3. MateFamily is not a synonym for beauty.

4. An ordinary queen+bishop mate can rank highly if the preceding combination
   is short, forcing and causally coherent.

5. An exotic named pattern can rank low if reached by a long technical grind.

6. Sacrifices are classified by type, causality and relation to mate.

7. Quiet preparatory moves get credit only when later tactics actually depend on them.

8. The system never claims psychological intent.

9. Pattern lesson lines inside the educational budget may outrank somewhat
   shorter Tal mates.

10. If Tal is more than 7 full moves shorter, both lines are shown.

11. ABSURD and EXTREME both remain valid sources of the short alternative.

12. Target lines are ranked by full root-to-terminal length.

13. Duplicate chess lines appear once with multiple family labels.

14. 40–50 move low-material technical grinds are strongly demoted.

15. The queen-sac Smothered example ranks as a top-tier lesson.

16. The Rxf6 attacking examples rank as strong lessons despite ordinary
    final mate geometry.
```

---

# 81. Final architecture

```text
                game.txt
          user-supplied position
                  │
                  ▼
        ┌──────────────────┐
        │ Tal Anchor Set   │
        │ ABSURD + EXTREME │
        └──────────────────┘
                  │
          Patricia exploration
                  │
             Tal admission
                  │
                  ▼
                Maia
                  │
                  ▼
         Pattern Attractors
       (generation guidance)
                  │
                  ▼
       multiple complete lines
                  │
          exact deduplication
                  │
                  ▼
     Combination / Beauty Analyzer
       ├─ forcingness
       ├─ causal sacrifice
       ├─ tactical motifs
       ├─ causal preparation
       ├─ PatternClarity
       ├─ continuation length
       └─ technicality penalties
                  │
                  ▼
        Educational Lesson Ranker
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
Recommended lesson    Shorter Tal alternative
                      if >7 moves shorter
```

Governing principle:

> **Tal creates the chess.**
>
> **Pattern creates direction and variety.**
>
> **Beauty is judged from the completed generated combination.**
>
> **The trainer prefers the most instructive short attack, not merely the
> shortest mate and not merely the most exotic final diagram.**
