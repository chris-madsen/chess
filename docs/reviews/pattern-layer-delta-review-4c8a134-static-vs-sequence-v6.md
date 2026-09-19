# Pattern Layer — Delta Review (current master)

Repository: `chris-madsen/chess`  
Reviewed HEAD: `4c8a134685d8c891469a8cb713a081b0c2c35e64`  
Previous reviewed HEAD: `99afc09febe1b27841c60d00f5b033be6b2ff324`  
Date: 2026-09-19

Recent semantic commits:

```text
5723857 enforce top three pattern lines
296bdcf fix pattern target scheduling and geometry scoring
4c8a134 replace generic scorers with all-family mate geometry
```

---

# 1. Executive summary

The code has moved forward substantially since the previous review.

The following previous issues are now fixed or materially improved:

```text
✓ PostMoveTalGate instead of unsupported CSTal searchmoves
✓ Tal fallback only considers exact scores
✓ Incomplete discovery is not silently reported as a complete case
✓ all unique threshold-hit families can be queued
✓ at most 3 target branches run concurrently
✓ final result is limited to 3 shortest completed terminal target lines
✓ generic corePolicies were removed
✓ MateGeometryDescriptor now exists
✓ all 34 catalog families now have geometry descriptors
✓ retrievalHint replaced the dangerous semantic prefilter terminology
```

The main new semantic question is now deeper:

> Is every one of the 34 named items actually a static mating geometry?

Current implementation assumes the answer is yes.

That assumption is safe for genuinely positional mate patterns such as Back Rank, Arabian, Smothered, Epaulette, Balestra, etc.

It is much less obviously safe for labels whose identity may depend on a characteristic sequence, sacrifice, deflection, line opening, or historical combination.

The current Pattern Layer cannot recognize such a sequence as a sequence. It only recognizes board snapshots.

This needs an explicit taxonomy audit before all 34 families should be trusted as equivalent steering attractors.

---

# 2. Current target scheduling — previous complaint is obsolete

Current `generatePatternTargetSession()` no longer permanently stops after the first three threshold hits.

It now:

```text
discovery line
↓
record every unique family that crosses threshold
↓
queue target branch
↓
run at most 3 target branches concurrently
↓
continue pumping queued branches
↓
rank completed target results
↓
return max 3
```

This matches the intended bounded scheduler much better.

`MAX_PATTERN_TARGETS = 3` now controls concurrency/final result count, rather than incorrectly making candidate family discovery stop after the first three.

The OpenSpec has also been updated from the stale “five / maximum affinity” wording to:

```text
discover all unique threshold-hit families
evaluate at most 3 target branches concurrently
return the three shortest completed terminal lines
```

So the previous review point about “first three threshold hits only” is resolved.

---

# 3. Tal fallback fail-open — fixed

The PostMoveTalGate now constructs:

```ts
const exact =
  relative.filter(result => result.talScore?.bound === "exact");
```

and fallback is selected only from `exact`.

Therefore:

```text
TAL_SCORE_UNAVAILABLE
lowerbound
upperbound
```

can no longer become accepted merely because every candidate failed.

This closes the previous P0 fail-open issue.

---

# 4. Incomplete discovery incorrectly reported complete — fixed

The Windows server now checks:

```text
session.value.discovery.status === "Incomplete"
```

as well as incomplete target lines before marking a case successful.

This closes the previous remote batch correctness problem.

---

# 5. Generic named-pattern scorer architecture — largely fixed structurally

The old architecture:

```text
corePolicies
has rook?
has knight?
some ATTACKS?
N escape squares?
```

has been removed from production matcher dispatch.

Current code has:

```text
MateGeometryDescriptor
MateGeometryVariant
MateRole
relative target squares
king region
required coverage
preferred blockers
forbidden geometry
```

and all families route through:

```ts
scoreMateGeometry(context, descriptor)
```

This is the correct architectural direction.

The model version is now:

```text
mate-geometry-v1-postmove-attractor
```

So the old review statement:

> “introduce MateGeometryDescriptor”

is no longer a TODO.

It is implemented.

---

# 6. All 34 families now have MateGeometry descriptors

At HEAD `4c8a134`:

```text
MATE_GEOMETRY_DESCRIPTORS
+
EXTENDED_MATE_GEOMETRY_DESCRIPTORS
=
ALL_MATE_GEOMETRY_DESCRIPTORS
```

and:

```ts
mateGeometryDescriptorFor(family)
```

is expected to resolve every catalog family.

This is broader than the production steering set.

The taxonomy still contains:

```text
19 MVP_NAMED_CORE
15 MVP_EXTENDED
34 total
```

Production retrieval still filters through:

```ts
STEERABLE_PATTERN_FAMILY_IDS
```

so the 15 extended descriptors exist but are not yet normal production steering attractors.

That staged rollout is sensible.

---

# 7. IMPORTANT NEW FINDING — a "pattern" is currently a STATIC POSITION

The current pattern scorer does not receive a move sequence.

It receives:

```ts
PatternPositionContext
```

built from exactly one board position.

The descriptor evaluates:

```text
defending king region
relative attacker piece locations
escape-square control
preferred blockers
forbidden geometry
```

and outputs:

```text
PatternAffinity(position, family)
```

Therefore the semantic object currently recognized by the Pattern Layer is:

> a static king-centric board geometry.

There is no trajectory or multi-move sequence inside `MateGeometryDescriptor`.

---

# 8. The system is multi-move, but the PATTERN itself is not

This distinction is important.

The overall steering loop is dynamic:

```text
S0
↓
Affinity(S0, Balestra)

Tal candidate
↓
S1
↓
Affinity(S1, Balestra)

Maia reply
↓
S2
↓
Affinity(S2, Balestra)

next Tal candidate
↓
...
```

So the system can gradually steer toward a mating geometry across many moves.

But the family definition itself contains no rule like:

```text
first sacrifice on h7
then king capture
then line opens
then queen enters
then mate
```

It only says, in effect:

```text
"How much does THIS CURRENT POSITION resemble the target geometry?"
```

That is a valid attractor model for positional mate geometries.

It is not a trajectory-pattern recognizer.

---

# 9. Balestra is a good example of why "simple" does not mean useless

A Balestra-type mate is structurally simple:

```text
queen delivers mate
bishop protects/supports the queen geometry
```

That simplicity is not itself a defect.

For this project, a pattern is useful if it is:

```text
frequent enough
geometrically distinguishable
continuously approachable
practically reachable against a human reply model
```

It does not need to be an elaborate historical combination.

A common simple geometry can be more useful as an attractor than a beautiful but extremely rare named construction.

So Balestra being “just queen + bishop mating geometry” is not a reason to remove it.

---

# 10. The catalog may mix TWO different semantic species

The current catalog calls all 34 entries `PatternFamily`.

But there may actually be at least two types.

## A. Static mating geometries

Identity is primarily determined by the final/near-final board configuration.

Examples likely include families such as:

```text
BACK_RANK
ARABIAN
SMOTHERED
EPAULETTE
DOVETAIL
BALESTRA
```

For these:

```text
MateGeometryDescriptor
```

is conceptually appropriate.

## B. Mating combinations / trajectory patterns

Identity may depend partly on HOW the position was reached:

```text
sacrifice
forced capture
deflection
line opening
piece displacement
discovered attack
specific move-order relation
```

For these, two identical/similar final geometries may not be enough to determine that the historical named combination occurred.

Current code cannot represent this distinction.

---

# 11. Some current extended descriptors are warning signs

The repo itself now contains descriptors such as:

```text
LEGAL
label: "knight fork and discovered battery"

ANDERSSEN
label: "queen diagonal and bishop corridor"

MAX_LANGE
label: "queen and bishop long diagonal"
```

The important point is not whether each particular label is ultimately classified as trajectory-based.

The important point is:

> The current descriptor system forces every named family into the same static positional schema.

That should be treated as an assumption requiring verification, not as established ground truth.

Especially for historically named constructions, a static piece arrangement may collapse away the actual defining tactical sequence.

---

# 12. Extended 15 are not grounded by the same repo fixtures as the core 19

This is an important evidence gap.

`mate-pattern-catalog.ts` currently contains concrete Lichess reference seeds for the 19 core families:

```text
FEN
solutionMoves
rating
gameUrl
sourceReference
```

The 15 extended families are catalogued as:

```text
EXTENDED_REFERENCE
```

but the current `referenceSeeds` list contains the core reference cases, not an equivalent verified reference fixture for every extended family.

Yet `4c8a134` already assigns a `MateGeometryDescriptor` to all 15 extended families.

Therefore the extended descriptors should currently be treated as:

> implementation hypotheses / provisional geometry definitions,

not as validated semantic definitions.

Before enabling those 15 for production steering, each one needs source-grounded fixtures.

---

# 13. Recommended taxonomy: Geometry vs Sequence vs Hybrid

Do not force all named patterns into one representation.

Introduce an explicit semantic kind.

For example:

```ts
type PatternKind =
  | "MATE_GEOMETRY"
  | "MATING_SEQUENCE"
  | "HYBRID";
```

Then catalog entries can declare their representation.

Example concept:

```ts
type PatternFamilyDefinition = Readonly<{
  id: PatternFamilyId;
  ...
  kind: PatternKind;
}>;
```

This makes the distinction architectural instead of implicit.

---

# 14. `MATE_GEOMETRY` representation

Keep the current framework for truly positional families:

```ts
MateGeometryDescriptor {
  kingRegion
  roles
  requiredCoverage
  preferredBlockers
  forbiddenGeometry
}
```

Affinity remains:

```text
A_geometry(S, family) ∈ [0,1]
```

This is appropriate for steering.

---

# 15. `MATING_SEQUENCE` representation

A sequence pattern needs a different descriptor.

Possible shape:

```ts
type PatternTrajectoryDescriptor = Readonly<{
  family: PatternFamilyId;
  stages: readonly PatternTrajectoryStage[];
}>;

type PatternTrajectoryStage = Readonly<{
  geometry?: MateGeometryDescriptor;
  event?: TacticalTransitionDescriptor;
}>;
```

A transition should describe only pattern identity, not generic chess quality.

Examples of allowed transition semantics:

```text
attacking piece sacrificed on/near king zone
defender forced to capture
critical blocker displaced
file/diagonal becomes open
king forced from region A to B
supporting piece changes role
```

Tal still determines whether the move is sound.

Pattern Layer only determines whether the observed trajectory resembles the named combination.

---

# 16. `HYBRID` representation

Some patterns may be best represented as:

```text
characteristic sequence
+
characteristic terminal geometry
```

Then:

```text
Affinity =
w1 * trajectorySimilarity
+
w2 * terminalGeometrySimilarity
```

or a gated continuous composition.

For example:

```text
trajectory establishes identity
terminal geometry confirms destination
```

This avoids throwing away either half.

---

# 17. Keep attractor semantics continuous for sequence patterns too

Do NOT make sequence recognition binary.

Wrong:

```text
exact historical combo occurred → 1
otherwise → 0
```

Correct:

```text
stage 0 resemblance
↓
stage 1 progress
↓
stage 2 progress
↓
terminal geometry
```

A sequence affinity can be something like:

```text
TrajectoryAffinity(history, family) ∈ [0,1]
```

and can rise as the characteristic transformation unfolds.

The steering objective remains continuous.

---

# 18. Current `PatternAssessment.progress` is NOT trajectory recognition

Current code stores:

```ts
progress = similarity - previousSimilarity
```

This is useful.

But it does not mean the pattern recognizer understands a sequence.

It only means:

```text
static similarity now
minus
static similarity previously
```

These are different concepts.

A real sequence recognizer would inspect:

```text
positions
moves
role transitions
events
```

over a bounded history window.

Do not confuse `Δ affinity` with trajectory identity.

---

# 19. Proposed bounded history representation

There is no need to make Pattern Layer consume an entire game.

A short bounded window is enough:

```text
S[t-3]
move[t-2]
S[t-2]
move[t-1]
S[t-1]
move[t]
S[t]
```

or even family-specific relevant transitions only.

This keeps evaluation cheap and deterministic.

Possible object:

```ts
type PatternTrajectoryContext = Readonly<{
  attackerSide: Side;
  positions: readonly PositionSnapshot[];
  moves: readonly LegalMove[];
  geometryContexts: readonly PatternPositionContext[];
}>;
```

---

# 20. Pattern Layer still must NOT become a chess evaluator

Even for trajectory patterns, keep the central invariant:

> Pattern Layer MUST NOT reimplement Tal.

Pattern Layer may say:

```text
"this move sequence increasingly resembles Legal-family geometry/transition"
```

It must NOT independently say:

```text
"the sacrifice is sound"
"the king cannot escape tactically"
"this continuation wins"
```

Those remain:

```text
Tal gate
forced-mate verifier
```

responsibilities.

---

# 21. How to audit all 34 families

Before deciding which representation each family needs, create a semantic audit table.

For every family record:

```text
family
source definition
verified examples
is final geometry sufficient to identify it?
does move order matter?
does a characteristic sacrifice/capture matter?
can identical terminal geometry arise without the named pattern?
recommended kind
```

Suggested output:

```text
BACK_RANK     MATE_GEOMETRY
BALESTRA      MATE_GEOMETRY
...
LEGAL         verify: GEOMETRY / SEQUENCE / HYBRID
...
```

Do not classify the ambiguous families from the name alone.

Use actual source examples.

---

# 22. Source-ground every extended family before steering

For the 15 extended families, add at minimum:

```text
3-10 canonical positive references
FEN/start state
solution move sequence
terminal position
source
```

Prefer several variants rather than a single textbook diagram.

Then derive:

```text
geometry descriptor
trajectory descriptor
or hybrid descriptor
```

from those examples.

Do not enable an extended family because a plausible-looking descriptor was easy to write.

---

# 23. Validation should separate geometry recognition from trajectory recognition

## Geometry metrics

```text
terminal top-1/top-k family recognition
hard-negative rejection
pairwise family confusion
mirrored/color-swapped invariance
pre-terminal affinity monotonicity
```

## Sequence metrics

```text
correct family sequence recognition
partial-stage affinity
move-order sensitivity where identity requires it
sequence hard negatives
same-final-position / different-history discrimination
```

That last test is particularly important:

```text
same or similar terminal geometry
different tactical history
```

If the family is truly sequence-defined, the recognizer should distinguish them.

---

# 24. Current static geometry implementation still needs empirical validation

The new architecture is much better than generic `corePolicies`, but its descriptor values are still hand-authored code:

```text
targetRelativeSquares
critical/supporting roles
requiredCoverage
preferredBlockers
```

Architecture correctness does not prove taxonomy correctness.

The next question is no longer:

```text
"do we have family-specific scorers?"
```

We do.

The question is:

```text
"do these descriptors actually describe the named families accurately?"
```

That requires the held-out corpus.

---

# 25. Remaining important runtime issue — real CSTal score perspective

One previous P0 still deserves explicit verification.

The CSTal PostMoveTalGate assumes:

```text
scorePerspective = SIDE_TO_MOVE
```

and normalizes it to attacker perspective.

The adapter logic is correct conditional on that assumption.

But the real CSTal binary should still be smoke-tested on known asymmetric positions for:

```text
cp sign
mate sign
```

This is engine-specific behavior and should be verified empirically.

Until then, the safety sign convention remains an external assumption.

---

# 26. Maia response model is still one-reply steering

Current candidate steering still evaluates one Maia response per candidate.

So the implemented objective is approximately:

```text
Affinity after one Maia response
```

not:

```text
Σ P(reply | position,Elo) * Affinity(after reply)
```

That is a reasonable MVP approximation.

But it should not be described as a calibrated expected probability over human replies.

Future upgrade:

```text
top-k Maia replies + probabilities/weights
```

if the provider exposes them reliably.

---

# 27. Decision traces should eventually include rejected candidates

Current steering trace primarily records evaluated Tal-safe candidates.

For diagnosis and tuning, preserve all generated candidates:

```text
uci
proposedBy
Tal score
Tal accepted
veto reason
Pattern score if evaluated
```

This will make it possible to answer:

```text
"Did Patricia suggest the interesting move?"
"Did Tal reject it?"
"Why?"
```

without reproducing the entire run.

---

# 28. Updated priorities

## P0 / verification

```text
1. Verify CSTal score perspective/sign on the real binary.
2. Run held-out steering after current Windows deployment.
```

## P1 / semantic correctness

```text
3. Audit all 34 families:
   MATE_GEOMETRY vs MATING_SEQUENCE vs HYBRID.

4. Source-ground the 15 extended families with verified examples.

5. Validate the new all-family MateGeometry descriptors
   against positives + hard negatives + confusion pairs.

6. Do not enable extended families for steering
   until their semantic representation is validated.

7. Add PatternTrajectoryDescriptor only for families
   whose identity genuinely depends on move sequence.
```

## P1 / modeling quality

```text
8. Move from one Maia reply toward weighted top-k replies.
9. Preserve rejected Tal candidates in traces.
10. Add multi-source candidate provenance.
```

## P2 / performance

```text
11. engine/gate caches
12. single-flight
13. cooperative cancellation
14. isolated/bounded provider workers if concurrency demands it
```

---

# 29. Bottom line

The latest code solved an important problem:

```text
generic family scorers
→ family-specific MateGeometry descriptors
```

That is a real improvement.

But `4c8a134` also makes a new assumption explicit:

```text
all 34 named mating patterns
=
static king-centric geometries
```

That assumption has not yet been demonstrated.

For true static mate patterns, the current approach is exactly the right kind of representation:

```text
static geometry
+
continuous affinity
+
multi-ply steering toward it
```

For named combinations whose identity depends on a characteristic tactical sequence, the correct representation should instead be:

```text
trajectory / sequence
```

or:

```text
trajectory + terminal geometry
```

The project should therefore distinguish:

```text
PATTERN AS POSITION
```

from:

```text
PATTERN AS TRANSFORMATION
```

before the full 34-family catalog is promoted into production steering.

Balestra illustrates the other side of the same point:

> a pattern does not need to be complicated to be valuable.

If a simple queen+bishop mating geometry is common, distinctive, and steerable, it is a perfectly useful attractor.

The criterion should be practical semantic value, not how elaborate the historical name sounds.
