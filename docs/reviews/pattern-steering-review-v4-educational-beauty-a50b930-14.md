# Pattern Steering / Tal / Maia / Beauty — Deep Review and Repair Plan

Repository: `chris-madsen/chess`  
Reviewed HEAD: `80ebf3251715b1d09b324f2d90738e44dbd53555`  
Commit: `Align pattern search with StylePath and enforce target threshold`  
Date: 2026-09-20

This review consolidates the latest investigation and replaces the conflicting parts of earlier reviews.

The most important clarification:

> **The Windows API is not a workaround and must not be removed.**
>
> CSTal runs on Windows. The normal architecture is:
>
> ```text
> Linux CLI
>     ↓
> Windows style-server/API
>     ↓
> CSTal ABSURD / EXTREME + Maia
> ```
>
> Both `pattern:experiment --provider remote` and the Tal baselines must use that canonical Windows execution path.

The current problem is not “remote vs local”.

The current problem is that several contracts inside the Windows/API/Pattern pipeline are inconsistent, and the result is that the Pattern experiment is not faithfully preserving the tactical information produced by Tal.

---

# 1. Observed contradiction

For the same `game.txt`, same requested Maia3 Elo 2000, and CSTal depth 14, the system currently produces radically different “Tal” continuations.

Plain Tal command:

```bash
npm run style:lines:cstal -- \
  --maia3-elo 2000 \
  --raw-file game.txt \
  --watch \
  --refresh-ms 2000
```

ABSURD finds:

```text
15...cxd5
16.exd5! Bxf5
17.gxf5 Ne5
...
32.Qxd8#
```

Pattern experiment:

```bash
npm run pattern:experiment -- \
  --raw-file game.txt \
  --provider remote \
  --maia3-elo 2000
```

Pattern discovery instead goes:

```text
15...cxd5
16.fxe6
...
42.Qc8#
```

and after the target phase fails it may present another “CSTal ABSURD vs Maia” fallback ending around move 49.

That is the first major red flag:

> **A baseline called “CSTal ABSURD vs Maia” inside the Pattern command must be behaviorally equivalent to the normal CSTal ABSURD vs Maia pipeline.**

Until that parity is established, comparisons such as:

```text
Pattern vs Tal
Pattern length inflation
shorter Tal alternative
educational preference
```

are not trustworthy.

---

# 2. Current architecture — what should remain

Do not redesign these roles again.

```text
CSTal ABSURD
CSTal EXTREME
        │
        └── trusted Tal anchor set

Patricia
        │
        └── exploration / candidate widening

Tal tactical gate
        │
        └── admission for Patricia-only moves

Maia
        │
        └── human-response model

Pattern Layer
        │
        └── mating-attractor direction / pattern opportunities

Beauty / Lesson Layer
        │
        └── ranks complete generated continuations

Forced-mate verifier
        │
        └── independent objective proof
```

Key invariant:

> **Tal is chess authority. Pattern guides. Beauty ranks lessons.**
>
> Pattern must not silently destroy tactical information from Tal.

---

# 3. P0 — trusted Tal `engineScore` / `enginePv` are still discarded in production wiring

This is currently the most important production bug.

The UCI move provider correctly returns:

```ts
{
  move,
  engineScore,
  enginePv,
  provenance
}
```

The code path in `src/adapters/uci/uci-engine-adapter.ts` preserves:

```text
best move
UCI score
PV
```

But trusted ABSURD / EXTREME enter Pattern candidate generation through:

```ts
candidateGeneratorFromMoveProvider()
```

in:

```text
src/application/use-cases/candidate-pool.ts
```

Current implementation effectively does:

```ts
return [{
  tag: "CandidateSeed",
  move: result.value.move,
  provenance: result.value.provenance
}];
```

It drops:

```text
result.value.engineScore
result.value.enginePv
```

Therefore a CSTal move can say:

```text
bestmove = exd5
score = mate +8
PV = ...
```

at the UCI provider boundary, but after the adapter Pattern sees only:

```text
move = exd5
trusted Tal provenance
```

and loses the fact that Tal sees a forced mate.

---

# 4. Why this bug is catastrophic

The selector now contains mate-class logic.

Conceptually:

```text
if any candidate is MATE_CLASS:
    restrict selection to MATE_CLASS candidates
```

But the trusted Tal seed needs:

```text
seed.engineScore
```

to become `MATE_CLASS` without going through TalGate.

Because the adapter discards that metadata, the real production behavior can become:

```text
ABSURD:
  move = exd5
  actual Tal score = mate 8
  metadata lost
  → mateClass = false

EXTREME:
  actual Tal score = mate 6
  metadata lost
  → mateClass = false

Patricia:
  candidate X
  TalGate evaluates candidate X
  score = mate 15
  → mateClass = true
```

Then:

```text
mateClass pool = [Patricia X]
```

and both of Tal's own mating moves disappear from the selectable pool.

That is a fundamental inversion of the desired architecture.

---

# 5. Required fix for Tal metadata propagation

Change:

```ts
candidateGeneratorFromMoveProvider()
```

to preserve all available trusted root metadata.

Recommended:

```ts
export const candidateGeneratorFromMoveProvider =
  (provider: MoveProvider): CandidateGenerator =>
    Object.assign(async request => {
      const result = await provider({
        position: request.position,
        lineId: request.lineId,
        ply: 1
      });

      if (isErr(result)) return err(result.error);

      return ok([{
        tag: "CandidateSeed",
        move: result.value.move,
        provenance: result.value.provenance,
        proposedBy: [result.value.provenance],

        ...(result.value.engineScore === undefined
          ? {}
          : { engineScore: result.value.engineScore }),

        ...(result.value.enginePv === undefined
          ? {}
          : { enginePv: result.value.enginePv }),

        engineRank: 1
      }]);
    }, {
      dispose: () => provider.dispose?.()
    });
```

Do not route trusted Tal through self-veto merely to recover metadata.

The metadata is advisory/search evidence, not an admission gate.

---

# 6. Required integration tests for metadata propagation

Do not rely only on synthetic selector tests that manually construct:

```ts
{ engineScore: { kind: "mate", value: 5 } }
```

Those tests can pass while production wiring is broken.

Add adapter-level test:

```text
fake MoveProvider returns:
    move = e2e4
    engineScore = mate 5
    enginePv = [e2e4, ...]

candidateGeneratorFromMoveProvider(...)
```

Expected:

```text
CandidateSeed.engineScore = mate 5
CandidateSeed.enginePv preserved
engineRank = 1
```

Then add wiring integration test through:

```text
createWindowsCstalPatternCandidateGenerator
```

Expected:

```text
ABSURD trusted root with mate score
→ candidate.mateClass = true

EXTREME trusted root with mate score
→ candidate.mateClass = true
```

This must test the actual production path, not only the selector in isolation.

---

# 7. P0 — family-specific calibrated target triggers are overridden by a global raw `.97`

The current code has two target gates.

First, Pattern discovery uses family-specific calibration:

```text
patternTargetTriggerFor(family)
```

Current calibrated examples include approximately:

```text
PILLSBURY      0.161
DOUBLE_BISHOP  0.1763
DOVETAIL       0.2567
HOOK           0.325
BACK_RANK      0.3422
CORNER         0.390
TRIANGLE       0.405
MORPHYS        0.411
BALESTRA       0.465
EPAULETTE      0.495
KILL_BOX       0.5378
OPERA          0.8067
BODEN          0.810
ANASTASIA      0.900
```

That is exactly why calibration exists.

But when discovery emits a target event, `generatePatternTargetSession()` calls:

```ts
registerPatternTarget(
  targets,
  event,
  threshold ?? 0.97,
  ...
)
```

So the effective condition becomes approximately:

```text
family trigger passed
AND
raw affinity >= 0.97
```

In practice:

```text
effective threshold = max(family calibrated trigger, .97)
```

which means `.97` for almost everything.

---

# 8. This directly explains `No target reached 97%`

The CLI output:

```text
Pattern references for raw-game

No target reached 97%.
```

does **not** mean:

```text
no mating attractor was found
```

It means:

```text
the family-specific trigger may have fired,
but a second legacy global gate rejected it.
```

That is a semantic contradiction.

The entire family calibration becomes irrelevant at target registration time.

---

# 9. Required fix: one source of truth for target registration

Preferred design:

```text
Pattern discovery owns the family trigger decision.
```

If discovery emits:

```ts
onTargetAffinity({
  targetFamily,
  affinity,
  ...
})
```

that event should already mean:

```text
this family passed its calibrated target/basin condition
```

Then session registration should only enforce:

```text
not duplicate
capacity available
valid family
```

not another numerical threshold.

Example:

```ts
const registerPatternTarget = (
  targets,
  event,
  maxTargets
) => {
  if (
    targets.some(target => target.targetFamily === event.targetFamily)
    || targets.length >= maxTargets
  ) {
    return { accepted: false, targets };
  }

  return {
    accepted: true,
    targets: [...targets, /* target */]
  };
};
```

Alternative if validation must remain in registration:

```ts
event.affinity >= patternTargetTriggerFor(event.targetFamily)
```

But never:

```text
global raw .97
```

---

# 10. Remove `.97` from user-facing semantics

Do not print:

```text
No target reached 97%.
```

because different families have different calibrated scales.

Better:

```text
No calibrated mating-pattern target was reached.
```

Debug output can say:

```text
CORNER:
  observed max evidence ...
  trigger ...
```

But the product should not expose a meaningless universal 97%.

---

# 11. Tests required for target trigger correctness

Example:

```text
CORNER target trigger = .39
event affinity = .40
```

Expected:

```text
target registered
```

Test:

```text
CORNER .38
```

Expected:

```text
not emitted by discovery
```

Do not write tests that encode:

```text
.969 reject
.970 accept
```

for every family.

That test currently validates the wrong architecture.

---

# 12. P0 — baseline parity must become a hard invariant

The plain Tal baseline used by `pattern:experiment` must use the same canonical Windows CSTal+Maia path as:

```bash
style:lines:cstal
```

This does **not** mean removing remote execution.

It means:

> **There should be exactly one canonical implementation of “plain CSTal ABSURD/EXTREME vs Maia”.**

Both CLIs should call the same server endpoint / same server-side use case / same provider configuration.

---

# 13. The current discrepancy is too large to ignore

Observed:

```text
plain style:lines:cstal ABSURD:
16.exd5
...
32.Qxd8#
```

Pattern command baseline labeled ABSURD:

```text
16.fxe6
...
49.d8=Q#
```

This is not a small stylistic drift.

The first critical attacker move differs.

Therefore the Pattern command's baseline cannot currently be trusted as the reference for:

```text
shorter Tal alternative
lesson gap
Pattern inflation
Beauty comparison
```

---

# 14. Required parity test

Create an integration test / diagnostic command that sends the same:

```text
rawGame
CSTal engine
Maia model
Maia Elo
style depth
engine options
```

through both code paths.

Example:

```text
A = /v1/style-lines/jobs plain ABSURD
B = baseline requested by pattern:experiment
```

Expected under deterministic mode:

```text
same UCI continuation
```

At minimum:

```text
same first Tal bestmove
same root score class
same root PV prefix
```

if full-line exact equality cannot be guaranteed due engine SMP behavior.

But ideally establish a deterministic trainer configuration and require exact equality.

---

# 15. Add a dedicated parity diagnostic CLI

Recommended:

```bash
npm run pattern:baseline-parity -- \
  --raw-file game.txt \
  --maia3-elo 2000 \
  --runs 10
```

Output:

```text
Windows backend SHA: ...
CSTal ABSURD
depth 14
threads 1/2
Maia3 Elo 2000

Run 1:
plain root = exd5
pattern-baseline root = exd5
MATCH

...

exact line match: 10/10
root move match: 10/10
```

Run it for both:

```text
ABSURD
EXTREME
```

---

# 16. P0/P1 — test CSTal determinism explicitly

CSTal is currently configured with multiple threads in places.

Parallel search can be nondeterministic depending on engine implementation and transposition-table scheduling.

Do not assume it is deterministic.

Measure it.

Test:

```text
same rawGame
same engine binary
same options
same depth 14
fresh process
10 runs
```

Collect:

```text
root bestmove
score
PV
```

First with current:

```text
Threads = 2
```

Then:

```text
Threads = 1
```

If Threads=2 produces:

```text
exd5
fxe6
exd5
...
```

but Threads=1 is stable:

```text
exd5 × 10
```

then trainer/regression mode should use:

```text
Threads = 1
```

or expose:

```text
deterministicTrainerMode
```

Do not guess; benchmark.

---

# 17. Determinism and product mode can be separate

It is acceptable to have:

```text
production-fast mode:
Threads = 2

regression / benchmark / trainer-repro mode:
Threads = 1
```

if needed.

But all A/B comparisons between Pattern and Tal must use the same engine determinism mode.

---

# 18. P1 — add Windows backend build fingerprint

Because CSTal must run remotely from Linux, observability of the Windows server is essential.

Current remote health/build information is insufficient to prove which checkout is executing Pattern.

Add to `/health` and every major response:

```json
{
  "server": {
    "gitSha": "80ebf325...",
    "buildTime": "...",
    "startedAt": "...",
    "patternCalibrationVersion": "...",
    "engineSuiteVersion": "...",
    "cstalAbsurdBinary": "...",
    "cstalExtremeBinary": "...",
    "cstalThreads": 2,
    "styleDepth": 14
  }
}
```

Do not expose sensitive filesystem paths publicly if inappropriate; binary version/hash is enough.

---

# 19. CLI must print backend fingerprint in debug/artifact

For `pattern:experiment --provider remote` store:

```text
remoteBackend.gitSha
calibrationVersion
CSTal config
Maia model/version
Maia Elo
```

inside the `.jsonl` artifact.

Debug display:

```text
Windows backend: git 80ebf325
CSTal depth 14, threads 2
Maia3 79M Elo 2000
Pattern calibration: ...
```

This is not to replace remote execution.

It is to make the mandatory remote execution reproducible.

---

# 20. P0/P1 — Pattern steering currently pays the cost even when no target is found

Current failure mode:

```text
Pattern steers every attacker ply
↓
changes Tal continuation
↓
no registered target because .97 fails
↓
"no target"
↓
fall back to Tal
```

This is bad product economics.

If Pattern cannot produce a valid lesson target, it should not be allowed to ruin the baseline during a long discovery run.

---

# 21. Preferred design: Pattern as branch generator, not the only main line

Keep:

```text
plain ABSURD baseline
plain EXTREME baseline
```

always alive.

Pattern discovery creates additional branches.

Then final line candidates are:

```text
ABSURD baseline
EXTREME baseline
Pattern discovery
Pattern target 1
Pattern target 2
Pattern target 3
```

Whole-line LessonRanker chooses from them.

This means Pattern can fail harmlessly:

```text
no educational target
→ plain Tal lesson still available
```

without requiring a second unrelated rerun.

---

# 22. Do not call a bad fallback “Recommended lesson”

Current output can say:

```text
Recommended lesson: CSTal ABSURD vs Maia3
Tier E
utility 0.0%
technical endgame conversion
```

That is contradictory.

Introduce a recommendation quality floor.

Suggested semantics:

```text
Tier A/B/C:
Recommended lesson

Tier D:
Fallback / secondary lesson

Tier E or SUPPRESSED:
Not a recommended lesson
```

If no good lesson exists:

```text
No educational Pattern lesson found.

Best available Tal continuation:
...
```

Do not label utility 0% as recommended.

---

# 23. The fallback must be the canonical baseline, not a fresh unrelated Tal rerun

If Pattern fails and the system needs a Tal continuation:

```text
use the already generated canonical ABSURD/EXTREME baseline
```

Do not independently rerun Tal later unless explicitly requested.

Benefits:

```text
same reference throughout experiment
deterministic comparison
no "baseline changed after thinking longer"
clean lesson gap calculation
```

---

# 24. Generate baselines at experiment start

Recommended orchestration:

```text
start experiment
│
├─ launch ABSURD+Maia baseline
├─ launch EXTREME+Maia baseline
└─ launch Pattern discovery
      └─ launch target branches as triggers occur
```

At completion:

```text
dedupe full lines
analyze LessonProfile
rank complete candidates
```

This is much cleaner than:

```text
run Pattern
then if no lesson, run Tal again
```

---

# 25. P1 — local mate-class educational compromise should not accumulate indefinitely

Current logic allows a somewhat longer mate-class move when the mate-distance difference is small.

This is reasonable locally but dangerous globally.

Example:

```text
position 1:
mate 5 vs mate 7
choose prettier mate 7

position 2:
mate 5 vs mate 7
choose prettier mate 7

position 3:
mate 5 vs mate 8
...
```

Each individual decision is acceptable.

But the complete continuation can inflate by 15–25 moves.

This is classic local-optimization drift.

---

# 26. Educational preference belongs mainly at whole-line level

Keep immediate move-level safety/urgency:

```text
mate now → mate now
```

But for:

```text
short mate vs slightly longer educational mate
```

prefer generating both coherent continuations and comparing whole lines.

The user's product rule is whole-line:

```text
if both are reasonably short,
Pattern lesson may win

if shorter Tal is >7 full moves shorter,
show both
```

That cannot be implemented robustly as repeated local `mateDistance <= 4` decisions.

---

# 27. Preserve multiple reasonable Tal mate branches

When both trusted anchors report:

```text
positive mate-class
```

and both are within a reasonable educational distance:

```text
retain ABSURD branch
retain EXTREME branch
```

Do not collapse immediately to one merely because:

```text
mate 5 < mate 7
```

The whole-line LessonRanker can later decide:

```text
shorter
vs
more instructive
```

---

# 28. Stall/repetition policy inside mate-class

Keep this invariant explicit:

```text
if immediate mate:
    mate now

if repeated/stalled AND mate-class exists:
    prefer a trusted non-repeating Tal mate conversion

if no stall:
    several reasonable mate branches may remain educational candidates
```

Do not allow:

```text
"mate exists"
```

to become an excuse for endless Pattern-preserving maneuvers.

---

# 29. Repetition key fix should remain

The recent change introducing a repetition key that ignores FEN move counters is correct.

For repetition/oscillation logic use:

```text
board
side to move
castling rights
en-passant state
```

not:

```text
halfmove clock
fullmove number
```

Keep full FEN hash for cache/provenance if desired.

Use repetition key for:

```text
positionVisits
recent positions
oscillation suppression
line repetition count
```

---

# 30. Preferred target family, not absolute prison

Recent code partially restored escape behavior.

Keep that.

A target branch should have:

```text
preferredTargetFamily
```

not an absolute rule that no other family can ever win.

Allow escape for:

```text
immediate mate
trusted stronger mate-class
stall/repetition
materially stronger calibrated family
much shorter educational conversion
```

Do not return to:

```text
fixed family can never change
```

as a contract.

---

# 31. P1 — family trigger and family steering must use calibrated semantics consistently

Do not mix:

```text
raw affinity
calibrated affinity
global raw threshold
```

in different layers.

Recommended rule:

```text
raw family score
↓
family-specific calibration
↓
common calibrated evidence
↓
presence / target / cross-family comparison
```

If raw thresholds remain family-specific for implementation reasons, never compare raw scores across families.

---

# 32. P1 — PatternClarity must remain calibrated and measured, not inferred from branch label

Do not do:

```text
targetFamily exists
→ PatternClarity >= .97
```

`targetFamily` means:

```text
this branch was launched for that family
```

not:

```text
the completed line still clearly demonstrates it
```

Use actual terminal/near-terminal calibrated evidence.

---

# 33. Beauty Layer should not be used to hide broken generation

Beauty is post-generation ranking.

It cannot repair a line that Pattern already turned into:

```text
42-move / 55-move technical grind
```

The correct order is:

```text
fix Tal metadata propagation
fix target registration
fix baseline parity
fix generation branching
then evaluate Beauty
```

Do not tune Beauty weights before that.

---

# 34. Current Beauty architecture is still useful

Keep:

```text
LessonProfile
CombinationBeauty
PatternClarity
LessonUtility
7-move alternative
technical penalties
sacrifice / forcing features
```

But these are secondary until the generated candidate set is trustworthy.

---

# 35. P1 — canonical experiment candidate set

At the end of a raw-game experiment, rank:

```text
1. ABSURD + Maia baseline
2. EXTREME + Maia baseline
3. Pattern discovery
4. unique Pattern target branches
5. future distinct Patricia/Tal-admitted branches
```

Dedupe by full UCI line signature.

Then analyze all with:

```text
LessonProfile
```

Then choose:

```text
Recommended Lesson
```

The winner does not need to be a Pattern target.

---

# 36. Plain Tal is allowed to be the best lesson

If EXTREME produces:

```text
short
forcing
sacrificial
clean mate
```

while all Pattern targets are worse, then:

```text
Recommended Lesson = EXTREME
```

That is not failure.

Pattern is there to discover additional instructive lines, not to force itself into the result.

---

# 37. User's 7-full-move rule

Keep:

```text
SHORT_ALTERNATIVE_GAP_FULL_MOVES = 7
```

Policy:

```text
if recommended educational line
is <=7 full moves longer than short trusted Tal line:
    Pattern lesson may be primary

if short Tal is >7 full moves shorter:
    show both
```

Example:

```text
Recommended Pattern lesson:
mate move 26

ABSURD:
mate move 18

gap 8
→ show both
```

---

# 38. Educational budget

For current `BEAUTIFUL_MIDDLEGAME` mode:

```text
<=30 final move:
preferred

31–35:
acceptable if combination quality is strong

36–40:
only if exceptional

>40:
normally suppress if technical / low-forcing
```

Because the user supplies the opening in `game.txt`, ranking should focus primarily on:

```text
generated continuation length
```

while final move number remains useful display metadata.

---

# 39. Do not make named mate family equal beauty

Keep the lesson-model distinction:

```text
PatternClarity
CombinationBeauty
LessonUtility
```

A normal queen+bishop mate can be an excellent lesson if preceded by:

```text
Rxf6!
line opening
defender removal
forced queen transfer
Qh6#
```

A named Dovetail can be a terrible lesson if reached through 25 moves of technical cleanup.

---

# 40. Do not infer Tal's psychological intent

Do not claim:

```text
Tal planned this six moves earlier
```

from a completed line.

Allowed metrics:

```text
retrospective functional contribution
trajectory dependency
```

Optional later metric:

```text
PV continuity evidence
```

if the future motif already appears in Tal's earlier PVs.

Even that is search continuity, not psychological intent.

---

# 41. Important remote/API invariant

Because the Windows API is mandatory, the architecture should explicitly say:

```text
Linux never reimplements CSTal decisions.

Linux orchestrates, renders and analyzes.

Windows API is canonical for CSTal execution.
```

If Pattern logic itself also executes on Windows in remote mode, then its build SHA and configuration must be observable.

---

# 42. Recommended server endpoint structure

A clean long-term API might expose:

```text
POST /v1/style-lines/jobs
    canonical plain Tal+Maia

POST /v1/pattern-experiments/batches
    Pattern steering / targets

GET /health
    service health

GET /version
    build SHA + model/calibration/engine config
```

Both plain baseline and Pattern experiment should internally reuse the same Tal provider factory/configuration.

---

# 43. One canonical Tal provider configuration

Centralize:

```text
ABSURD binary
EXTREME binary
Threads
Hash
depth
UCI options
Maia model
Maia Elo
```

Do not duplicate configuration across:

```text
style server plain job
pattern provider factory
baseline generation
```

Create one config object/factory and inject it everywhere.

This prevents silent drift.

---

# 44. Baseline provenance must be stored

For every baseline line save:

```json
{
  "source": "CSTal ABSURD",
  "backendGitSha": "...",
  "engineVersion": "...",
  "depth": 14,
  "threads": 1,
  "maiaModel": "Maia3 79M",
  "maiaElo": 2000,
  "rawGameHash": "...",
  "startFen": "...",
  "generatedAt": "..."
}
```

Then a Pattern experiment can prove:

```text
this is the same canonical baseline configuration
```

---

# 45. Cache baseline lines within the experiment

Once generated, use the same baseline objects for:

```text
short alternative
length comparison
Lesson ranking
final display
artifact
```

Do not regenerate them later in the same experiment.

---

# 46. P0/P1 — target trigger diagnostics

For every family during discovery record:

```text
max raw score
max calibrated score
configured target trigger
first trigger ply
whether registered
reason not registered
```

Then the system can explain:

```text
CORNER crossed trigger .39 at ply 12
registered

HOOK peaked below threshold
not registered
```

This would have made the `.97` bug obvious immediately.

---

# 47. Decision trace diagnostics for Tal metadata

For every candidate log:

```text
uci
origin
trustedTalOrigin
engineScore
enginePvPrefix
mateClass
mateDistance
talGateScore if external
selectedReason
```

A trusted ABSURD candidate with:

```text
engineScore missing
```

should be visible immediately.

Consider a debug assertion:

```text
trusted CSTal provider expected to return engineScore
but metadata missing
```

at least in experiment mode.

---

# 48. Add a production invariant for trusted root metadata

If CSTal UCI emitted a score, the candidate seed must preserve it.

Test boundary-by-boundary:

```text
UCI MoveProvider
↓
CandidateGenerator adapter
↓
composed candidate pool
↓
Pattern candidate assessment
↓
selection trace
```

At every stage assert:

```text
score/PV survives
```

This prevents silent metadata loss in future refactors.

---

# 49. P1 — duplicate Tal proposals should preserve evidence from both personalities

If ABSURD and EXTREME propose the same UCI move:

```text
proposedBy = [ABSURD, EXTREME]
```

Do not silently overwrite all metadata from one with the other.

Long-term preferred structure:

```ts
engineEvidence: [
  { provider: "ABSURD", score, pv },
  { provider: "EXTREME", score, pv }
]
```

MVP can retain one canonical score while preserving both provenances, but the rule must be deterministic and documented.

---

# 50. If ABSURD and EXTREME disagree on mate distance

Do not permanently privilege one personality.

Both are trusted.

Example:

```text
ABSURD:
mate 8

EXTREME:
mate 5
```

For pure urgency, EXTREME may be preferable.

For educational mode, both can be retained if within budget.

The final LessonRanker decides whole-line value.

---

# 51. Patricia must never gain an accidental metadata advantage over trusted Tal

After fixing trusted metadata, verify this invariant:

```text
Patricia-only:
gets TalGate score because it needs admission

Trusted ABSURD/EXTREME:
retain their own root UCI score/PV
```

No source should become mate-class merely because it passes through a richer adapter while another loses metadata.

---

# 52. P1 — honest failure semantics for no Pattern lesson

Desired output:

```text
No calibrated Pattern lesson met the educational quality floor.

Best Tal continuation:
CSTal ABSURD ...
```

Not:

```text
No target reached 97%.
Recommended lesson:
Tier E, utility 0%.
```

Suggested states:

```text
FOUND_PATTERN_LESSON
FOUND_TAL_LESSON_ONLY
NO_GOOD_LESSON
```

---

# 53. Quality floor

Initial recommendation:

```text
Tier A-C:
eligible recommended lesson

Tier D:
secondary / fallback

Tier E or SUPPRESSED:
not recommended
```

Exact tier boundaries can change later.

The important invariant:

```text
utility 0% cannot be called Recommended lesson.
```

---

# 54. Debug/raw output should be separate from user output

Normal output:

```text
Recommended Lesson
Shorter Tal Alternative (if >7 moves shorter)
Other Good Unique Lessons
```

Debug mode:

```text
Pattern discovery raw line
all target branches
all thresholds
all decision traces
suppressed candidates
```

This prevents bad exploratory lines from appearing as product recommendations.

---

# 55. P1 — calibration artifact freshness

Keep a CI check:

```bash
npm run pattern:calibrate:check
```

It should fail when:

```text
current source calibrator
+
current dataset
```

would generate a different checked-in artifact.

This is orthogonal to the `.97` bug, but still important.

---

# 56. P1 — positiveNear / basin calibration

Continue the previous correction:

Do not reduce near-terminal basin data to a single case maximum if possible.

Store:

```text
score
distanceToTerminal
caseId
```

and evaluate:

```text
first crossing distance
trigger persistence
false-positive rate
```

But fix the P0 wiring bugs first before spending time tuning these distributions.

---

# 57. P1 — Beauty feature correctness remains secondary but still required

After generation contracts are repaired, continue fixing:

```text
two-pass trajectory analysis
real king mobility
real line opening
real defender removal
sacrifice vs trade distinction
promotion-grind-on-mating-lines
```

Do not tune Beauty coefficients until these features mean what their names say.

---

# 58. Regression corpus — positive examples

## A. Queen-sacrifice Smothered Mate

```text
FEN:
r1k4r/ppp1bq1p/2n1N3/6B1/3p2Q1/8/PPP2PPP/R5K1 w - - 0 1

1.Nc5+ Qe6
2.Qxe6+ Kb8
3.Nd7+ Kc8
4.Nb6+ Kb8
5.Qc8+! Rxc8
6.Nd7#
```

Expected:

```text
top-tier lesson
short
forcing
causal queen sacrifice
clear Smothered pattern
```

---

# 59. Regression corpus — ordinary final geometry but beautiful attack

Add the supplied:

```text
Rxf6 ... Qh6#
```

games.

Expected:

```text
high CombinationBeauty
ordinary queen+bishop final mate is not penalized
short tactical conversion
```

Also add the supplied:

```text
Rxf8 / Qf8#
```

style line.

These prove:

```text
beauty != exotic terminal pattern name
```

---

# 60. Regression corpus — negative examples

Store the recent bad Pattern outputs:

```text
42-move
43-move
52-move
55-move
```

technical continuations.

Expected in `BEAUTIFUL_MIDDLEGAME`:

```text
not recommended
technical penalty high
low forcingness
long conversion
repetition/stall penalties when applicable
```

---

# 61. Add this exact game as a system integration fixture

The current `game.txt` position is extremely valuable because it exposes multiple architecture bugs.

Test from:

```text
1.c4 ... 15...cxd5
```

Assertions after fixes:

```text
plain ABSURD canonical baseline root move is reproducible

Pattern experiment baseline root move matches canonical ABSURD baseline

trusted ABSURD engineScore/PV survive into Pattern candidate trace

family trigger is not blocked by global .97

Pattern cannot call Tier E utility 0 a Recommended Lesson

if Pattern produces no better lesson,
canonical Tal baseline is returned
```

This should become a permanent end-to-end regression.

---

# 62. Required debugging artifact fields

`.local/pattern-steering-*.jsonl` should include:

```json
{
  "run": {
    "clientGitSha": "...",
    "remoteServerGitSha": "...",
    "calibrationVersion": "...",
    "rawGameHash": "...",
    "maiaElo": 2000,
    "cstalDepth": 14,
    "cstalThreads": 1
  }
}
```

Per Tal candidate:

```json
{
  "uci": "e5d4",
  "trustedTalOrigin": "ABSURD",
  "engineScore": {
    "kind": "mate",
    "value": 8
  },
  "enginePv": ["..."],
  "mateClass": true
}
```

Per family:

```json
{
  "family": "CORNER",
  "raw": 0.41,
  "calibrated": 0.78,
  "targetTrigger": 0.39,
  "targetEventEmitted": true,
  "targetRegistered": true
}
```

This makes invisible contract failures visible.

---

# 63. Proposed implementation phases

## Phase 1 — repair P0 contracts

```text
[ ] Preserve engineScore / enginePv in candidateGeneratorFromMoveProvider.

[ ] Add actual production wiring integration test.

[ ] Remove global .97 target gate.

[ ] Replace .97 contract tests with family-trigger tests.

[ ] Add canonical baseline parity diagnostic.

[ ] Add remote backend build fingerprint.
```

Do not proceed to Beauty tuning until these are green.

---

# 64. Phase 2 — establish reproducibility

```text
[ ] Run ABSURD root ×10 Threads=2.

[ ] Run ABSURD root ×10 Threads=1.

[ ] Same for EXTREME.

[ ] Decide deterministic trainer/regression engine config.

[ ] Make Pattern baseline and style:lines:cstal use identical config.

[ ] Cache baseline once per experiment.
```

---

# 65. Phase 3 — improve generation policy

```text
[ ] Generate ABSURD and EXTREME baselines from experiment start.

[ ] Keep Pattern as additional branch generator.

[ ] Preserve multiple reasonable Tal mate branches.

[ ] Apply stall/repetition urgency inside mate-class.

[ ] Keep target family preferred, with escape.

[ ] Avoid repeated local educational concessions causing global mate inflation.
```

---

# 66. Phase 4 — finish lesson-selection semantics

```text
[ ] Rank all unique complete lines together.

[ ] Let plain Tal win if it is the best lesson.

[ ] Enforce quality floor.

[ ] Implement honest no-pattern fallback state.

[ ] Keep >7-full-move shorter Tal alternative rule.

[ ] Hide Tier E / SUPPRESSED from normal recommendations.
```

---

# 67. Phase 5 — only then refine Beauty

```text
[ ] Two-pass trajectory analyzer.

[ ] Functional contribution, not intent.

[ ] Sacrifice vs trade.

[ ] EXCHANGE sacrifice.

[ ] Real king mobility.

[ ] Real line-opening geometry.

[ ] Defender-role analysis.

[ ] Promotion grind even if eventual mate.

[ ] Curated pairwise Beauty preferences.
```

---

# 68. Critical tests to add immediately

## Test A — trusted metadata survives adapter

```text
MoveProvider:
mate 5 + PV

→ CandidateSeed:
mate 5 + same PV
```

## Test B — production trusted mate-class

```text
Windows CSTal Pattern generator
→ ABSURD seed
→ engineScore present
→ mateClass true
```

## Test C — calibrated target registration

```text
CORNER trigger .39
event .40
→ registered
```

No `.97`.

## Test D — baseline parity

```text
same Windows backend
same rawGame
same engine config

style baseline ABSURD
==
pattern baseline ABSURD
```

## Test E — server version visible

Pattern artifact records server SHA.

## Test F — no Tier E recommendation

```text
only Tier E candidates
→ no Recommended Lesson
→ Tal fallback or NO_GOOD_LESSON
```

---

# 69. Medium-priority tests

```text
Threads=1 determinism
Threads=2 variability measurement

repetition cycle broken correctly

mate-class stall fallback

target-family escape

full-line dedupe

7-full-move alternative

ordinary beautiful Q+B mating attack

queen-sac Smothered

long technical negative line
```

---

# 70. Definition of Done — core engine/Pattern integration

I would consider the fundamental Pattern integration repaired only when all of these are true:

```text
1. ABSURD and EXTREME root score/PV metadata survive into Pattern.

2. A Tal positive mate remains MATE_CLASS in production wiring.

3. Patricia never gains mate-class advantage merely because Tal metadata was dropped.

4. Target registration uses calibrated family semantics, not global raw .97.

5. "No target" means no calibrated target actually occurred.

6. Pattern baseline uses the same canonical Windows Tal+Maia pipeline as style:lines:cstal.

7. Baseline parity is automatically tested.

8. Remote server build/config fingerprint is visible.

9. Engine determinism characteristics are measured and documented.

10. The same experiment does not regenerate a different Tal fallback later.
```

---

# 71. Definition of Done — educational behavior

```text
1. ABSURD, EXTREME, Pattern discovery and targets are all complete-line candidates.

2. A plain Tal line may win Recommended Lesson.

3. Pattern is rewarded only when it produces a genuinely better lesson.

4. Tier E / utility 0 lines are never called Recommended Lesson.

5. A Pattern line within educational budget may outrank a somewhat shorter Tal line.

6. If Tal is >7 full moves shorter, both are shown.

7. Long low-forcing technical conversions are suppressed in BEAUTIFUL_MIDDLEGAME.

8. Named MateFamily is not synonymous with beauty.

9. Ordinary queen+bishop/rook+queen finishes may rank highly after a beautiful attack.

10. No engine psychological intent is inferred.
```

---

# 72. Expected behavior for the current game after the core fixes

This is not a demand for one exact chess line, but the system should behave qualitatively like this:

```text
Input:
game.txt through 15...cxd5

Canonical baselines:
ABSURD line
EXTREME line

Pattern branches:
generated in parallel / alongside baseline

If ABSURD still finds:
16.exd5 ... mate around 32

and Pattern finds:
16.fxe6 ... mate around 42
with no exceptional educational value

then:
Recommended Lesson = ABSURD

If Pattern finds:
a clean recognizable mating-pattern line around 26–30
with strong tactical/educational value

then:
Recommended Lesson = Pattern

If Pattern lesson = move 29
Tal = move 20
gap >7
then:
show both
```

That is the intended product.

---

# 73. What should NOT happen anymore

The following outputs should be considered regressions:

```text
"No target reached 97%"
```

when family-specific triggers exist.

```text
Recommended lesson:
Tier E
utility 0%
```

```text
Pattern baseline ABSURD:
16.fxe6

plain ABSURD:
16.exd5
```

without a documented deterministic reason.

```text
trusted ABSURD score:
mate 8

Pattern candidate:
mateClass=false
```

```text
Pattern steers for 30 moves,
finds no lesson,
then reruns Tal and obtains a different baseline.
```

All of these should have regression tests.

---

# 74. Final root-cause hierarchy

Based on the current source and observed behavior, prioritize causes as follows.

## P0 — direct contract failures

```text
A. Tal engineScore/PV dropped by candidateGeneratorFromMoveProvider.

B. Family calibrated target event is blocked by second global .97 gate.

C. Pattern baseline is not proven equivalent to canonical style:lines:cstal baseline.
```

These can invalidate the experiment before Beauty is involved.

## P1 — reproducibility / orchestration

```text
D. CSTal multi-thread determinism not measured.

E. Remote Windows server build/version not observable.

F. Baseline is rerun instead of reused.
```

## P1 — generation semantics

```text
G. Local mate-class educational concessions can accumulate into long global lines.

H. Pattern still has too much influence when it cannot produce a valid lesson.
```

## P2 — lesson/Beauty quality

```text
I. Beauty feature semantics still need refinement.

J. More real positive/negative regression fixtures are needed.
```

Do the work in that order.

---

# 75. Final recommendation

Do **not** spend the next iteration adjusting:

```text
Beauty weights
sacrifice bonuses
named mate-family prestige
```

The current experiment is failing earlier than that.

First restore trustworthy contracts:

```text
CSTal score/PV
    survives
        ↓
trusted Tal mate-class works
        ↓
family target trigger works
        ↓
plain Tal baseline is canonical/reproducible
        ↓
Pattern generates alternatives
        ↓
Beauty compares complete trustworthy lines
```

The key principle:

> **Before asking whether Pattern produced a beautiful mate, make sure Pattern is actually receiving the same tactical truth from Tal that plain Tal already has.**

At the moment, that invariant is not guaranteed.

Once it is guaranteed, the educational layer finally has a sound foundation to optimize.
