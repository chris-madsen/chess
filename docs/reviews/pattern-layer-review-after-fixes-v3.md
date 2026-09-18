# Pattern Layer — повторное ревью после исправлений Luna/Codex

**Repository:** https://github.com/chris-madsen/chess/tree/master  
**Reviewed HEAD:** `6920fb6edc3fa1f254f1cf0b1c2e4d977084fa61`  
**Previous review baseline:** `f367c5b313bc41c96eea0c9f34d73a76595a9134`  
**Date:** 2026-09-18

---

# 0. Итог

После прошлого ревью код действительно сильно изменился в правильную сторону.

Между предыдущим состоянием и текущим HEAD появилось 8 коммитов, в том числе:

- `refactor: add contextual pattern recognizer foundation`
- `feat: add recognizer steering and batch benchmark`
- `feat: add pattern steering candidate pool and rollout`
- `fix: use actual puzzle start from trajectory`
- `feat: complete pattern layer rebuild foundations`
- `fix: isolate pattern cache context and compose candidates`
- `docs: separate recognizer and remote steering verification`

Это не косметика. Исправлены несколько реальных P0/P1 из прошлого ревью:

- появился explicit attacker context;
- runtime recognizer больше не требует заранее указанного family;
- Lichess trajectory сохраняется;
- actual puzzle start исправлен;
- recognizer отделён от дорогого engine benchmark;
- calibration/evaluation отчёты разделены;
- Pattern cache научился игнорировать history;
- появился Patricia MultiPV root generator;
- появился pre-commit steering use-case;
- появился bounded remote batch.

Но текущую работу **нельзя считать законченной**.

Самая важная проблема:

> Новый Pattern steering пока НЕ является системой  
> `Patricia breadth -> Tal tactical gate -> Pattern attractor -> Maia -> Tal -> Pattern -> Maia ...`

Сейчас он ближе к:

```text
candidate generators
↓
Pattern similarity
↓
один Maia response
↓
выбрать максимальный Pattern progress
↓
HumanPath
↓
Stockfish продолжает player side
```

Это нарушает главную договорённость проекта:

> **Pattern Layer не должен становиться вторым шахматным движком и не имеет права ухудшать Tal ради красивого рисунка.**

Pattern Layer должен только направлять **уже приемлемые для Tal** варианты к матовым attractors.

---

# 1. Что было исправлено правильно

## 1.1. FIXED — attacker side теперь можно зафиксировать

Файл:

`src/domain/patterns/context.ts`

Появился:

```ts
PatternAnalysisContext {
  attackerSide
  defenderSide
}
```

Новый steering создаёт analysis один раз и использует его для before/after/post-Maia positions.

Это исправляет прошлый критический баг:

```text
White attack
→ Black attack
→ White attack
```

при чередовании `sideToMove`.

**Статус:** исправлено в новом Pattern path.

Но legacy path всё ещё способен вывести attacker из `sideToMove`; это нужно добить отдельно.

---

# 2. FIXED — runtime family discovery больше не требует target family

Файл:

`src/domain/patterns/matchers.ts`

Появилось:

```ts
retrievePatternFamilies(context, limit)
```

Это правильное разделение:

```text
offline benchmark:
known family label

runtime:
family unknown
```

---

# 3. FIXED — recognizer benchmark отделён от engine benchmark

Появился:

`src/cli/pattern-recognizer.ts`

Он запускает Pattern recognition без CSTal, Maia и forced-mate verifier.

472 dataset cases теперь можно использовать как дешёвый recognition/proximity corpus.

---

# 4. FIXED — Lichess trajectory больше не выбрасывается

Файл:

`src/application/experiments/pattern-dataset.ts`

Теперь сохраняются:

```text
solutionMoves
trajectory
expected
sourceCaseId
perturbation
```

Также исправлен actual puzzle start через `trajectory.ply === 1`.

Это реальное улучшение.

---

# 5. FIXED — calibration и evaluation разделены

`pattern-recognizer.ts` теперь выдаёт:

```text
bySplit.calibration
bySplit.evaluation
```

Это правильнее старого общего report.

---

# 6. FIXED — Pattern cache перестал зависеть от full move history

Файл:

`src/domain/cache/state-cache.ts`

Pattern namespaces:

```text
PATTERN_CONTEXT
PATTERN_ASSESSMENT
```

игнорируют move history и halfmove clock.

Это исправляет старый transposition-cache bug.

---

# 7. FIXED — Patricia MultiPV root generator появился

Файл:

`src/adapters/uci/uci-engine-adapter.ts`

Добавлены:

```ts
parseUciMultiPvRootMove()
createUciCandidateGenerator()
```

Это правильная роль Patricia:

```text
Patricia = breadth / root proposal generator
```

---

# 8. FIXED — steering появился ДО полного rollout

`src/application/use-cases/pattern-steering.ts`

Теперь candidate moves оцениваются до выбора branch. Это намного лучше старого post-hoc line ranking.

---

# 9. FIXED — bounded remote batch

`pattern:experiment` получил:

```text
--subset steering-100
--remote-concurrency
```

Это хорошее инфраструктурное исправление.

Но сам benchmark пока тестирует не тот steering algorithm.

---

# 10. P0 — НЕТ TAL TACTICAL VETO

Файл:

`src/application/use-cases/pattern-steering.ts`

Выбор кандидата сейчас идёт по `progress` и post-response Pattern score.

Никакого:

```text
Tal tactical acceptability
Tal score
Tal veto
```

в decision нет.

## Почему это опасно

Это позволяет:

```text
Rxf7
Tal: плохой ход

Pattern:
Anastasia +0.40

selector:
"Красиво, играем."
```

Именно так можно испортить Tal.

## Как должно быть

Строгая граница:

```text
candidate pool
↓
TAL TACTICAL GATE
↓
только tactically acceptable candidates
↓
Pattern Layer
↓
Maia
↓
reranking
```

Pattern Layer не имеет права вернуть ход, который Tal vetoed.

## Что добавить

Новый port:

```ts
type CandidateTacticalGate = (
  position,
  candidates
) => TacticalCandidateAssessment[]
```

Например:

```ts
type TacticalCandidateAssessment = {
  seed: CandidateSeed;
  accepted: boolean;
  talScore?: EngineScore;
  talMate?: number;
  talPv?: readonly LegalMove[];
};
```

### Preferable implementation

Проверить CSTal binary на поддержку:

```text
go searchmoves <move>
```

Если поддерживается:

```text
Patricia proposes Rxf7
↓
CSTal searchmoves Rxf7
↓
Tal оценивает эту дверь сам
```

Если `searchmoves` нет, не писать шахматную оценку внутри Pattern Layer. Нужен documented external safety fallback.

---

# 11. P0 — steered rollout после первого хода перестаёт быть Tal rollout

Файл:

`src/application/use-cases/steered-rollout.ts`

Сейчас он вызывает:

```ts
generateHumanPath(...)
```

А `HumanPath` делает:

```text
ply 2 = Maia
ply 3 = Stockfish
ply 4 = Maia
ply 5 = Stockfish
...
```

Это НЕ наша система.

Нужно:

```text
ply 1 = Tal-guided selected candidate
ply 2 = Maia
ply 3 = Tal candidates -> Pattern -> selection
ply 4 = Maia
ply 5 = Tal candidates -> Pattern -> selection
...
```

## Что сделать

Создать отдельный use-case:

```ts
generatePatternSteeredTalPath()
```

Loop:

```text
if attacker turn:
    generate candidate pool
    Tal tactical gate
    Pattern assessment
    select candidate
    commit

if defender turn:
    Maia response
```

И так до mate/termination/horizon.

---

# 12. P0 — pending "held-out steering report" пока НЕ тестирует новый steering

OpenSpec task:

```text
[ ] Run held-out steering report ...
```

Но `src/cli/pattern-experiment.ts` всё ещё вызывает:

```ts
runPatternSelectionExperimentFromLines(...)
```

Этот old experiment:

1. получает готовые CSTal ABSURD/EXTREME StylePath lines;
2. trace'ит их;
3. выбирает одну post-hoc.

Это legacy post-hoc experiment, а не новый steering.

## Более того

Old experiment использует:

```ts
assessPattern(...)
```

из legacy `pattern.ts`, а не новый relational path.

## Что сделать

Разделить команды:

```text
pattern:legacy-posthoc-experiment
pattern:recognizer
pattern:steering
```

Новый `pattern:steering` должен запускать именно iterative Tal-guided steering.

---

# 13. P0 — legacy scorer всё ещё жив и содержит старые дефекты

`src/domain/patterns/pattern.ts`

Старый `scoreFamily()` всё ещё:

- строит scores для всех 34 families;
- использует generic counts;
- содержит `TACTICAL_SIGNAL`;
- содержит старые weighted formulas.

`assessPattern()` без explicit analysis может снова выводить attacker из `sideToMove`.

## Что сделать

Заморозить old code как legacy baseline или удалить после migration.

Production Pattern path не должен зависеть от:

```text
extractPatternFeatures()
scoreFamily()
assessPattern()
```

---

# 14. P0/P1 — Pattern Layer снова начал превращаться в generic pseudo-engine

`context.ts` объявляет:

```text
ATTACKS
DEFENDS
BLOCKS
PINS
XRAYS
OCCUPIES
CAN_CAPTURE
CAN_INTERPOSE
CAN_REACH_IN_1
CAN_REACH_IN_2
CONTROLS_ESCAPE
```

Но extractor реально создаёт только:

```text
ATTACKS
CONTROLS_ESCAPE
BLOCKS
```

Проблема не только в incomplete enum.

Опаснее, что Pattern Layer начинает строить общий tactical ontology.

Tal уже умеет pins/x-rays/captures/defensive resources лучше hand-written layer.

## Правильная граница

Нужен не generic tactical graph, а:

```text
Mate Geometry Descriptor
```

Например:

```text
target king relative region
required mating-piece role
supporting-piece relative role
required covered squares
required own blockers
mating corridor geometry
allowed substitutions
allowed symmetries
```

Low-level `does_piece_attack_square()` допустим только как **pattern predicate**, а не как chess evaluation bonus.

---

# 15. P1 — первые 5 specialized matchers всё ещё слишком грубые

## ANASTASIA

Сейчас достаточно:

```text
king on edge
any knight controls any escape
any rook/queen attacks king
>=2 blocked escapes
```

Это не уникальная Anastasia geometry.

## ARABIAN

Тоже отсутствует точная knight-rook relative arrangement.

## BODEN

`crossing` сейчас фактически:

```text
два слона на разных file/rank
```

Это НЕ проверка crossing diagonals around king.

Плюс `relationExists("ATTACKS")` может быть true из-за другой фигуры.

## SMOTHERED

Слишком легко получить false positive: generic knight + blocked escapes + defender pieces.

## BACK_RANK

Стало лучше из-за `kingOnHomeRank`, но нужно ещё кодировать характерные blockers/corridor.

---

# 16. P1 — остальные 14 Lichess core matchers ещё грубее

`corePolicies` пока scaffold.

Например `HOOK` и `VUKOVIC` практически одинаковы:

```text
rook
knight
knight controls escape
rook attacks king
```

Так recognizer не сможет надёжно различить эти семьи.

Checkbox "expanded structural matcher dispatch" формально закрыт, но семантически real family-specific geometry ещё не закончена.

---

# 17. P1 — contradictions сейчас заглушка

Generic matcher использует условие вида:

```text
kingInCorner && !kingOnEdge
```

Но corner всегда implies edge.

То есть contradictions практически пусты.

Либо реализовать реальные contradictions, либо временно убрать field.

---

# 18. P1 — PatternProgress математически считает не то

Сейчас:

```text
progress =
max(postResponse scores)
-
max(before scores)
```

Но эти maxima могут относиться к разным families.

Нужно:

```text
for each family p:
    delta[p] = after[p] - before[p]

targetFamily = argmax(delta[p])
```

То есть:

```text
max_p(after[p] - before[p])
```

а не:

```text
max(after) - max(before)
```

Decision должен хранить:

```text
targetFamily
beforeScore
afterCandidateScore
afterMaiaScore
patternDelta
```

---

# 19. P1 — target attractor может дёргаться каждый ply

Pattern должен быть attractor, а не hard lock.

Но без hysteresis возможна осцилляция:

```text
Anastasia
→ Pillsbury
→ Anastasia
→ Hook
```

Нужен soft persistence:

```text
keep current target unless:
alternative significantly better
OR current target collapses
```

Это можно добавить после базового loop.

---

# 20. P1 — candidate pool имеет starvation bug

`composeCandidateGenerators()` возвращает, как только набрал `request.limit`.

Wiring ставит Patricia MultiPV первой.

Если Patricia возвращает 8 moves и limit=8, другие engines вообще не попадут в pool.

Это НЕ union.

## Нужно

Сначала собрать per-source budgets:

```text
Patricia MultiPV: 8
CSTal ABSURD: 1
CSTal EXTREME: 1
Seer: 1
Jakal: 1
```

Потом:

```text
union
dedupe
final cap
```

---

# 21. P0/P1 — CSTal не включён в новый Pattern candidate pool

`createLocalPatternCandidateGenerator()` использует:

```text
Patricia MultiPV
Patricia
Jackal
Seer
```

Windows CSTal wiring существует отдельно.

Нужна настоящая union:

```text
Patricia MultiPV
+
CSTal ABSURD own bestmove
+
CSTal EXTREME own bestmove
+
optional Seer/Jakal
```

После неё — Tal gate.

---

# 22. P1 — Maia вызывается для каждого candidate последовательно

Сейчас:

```text
candidate1 → await Maia
candidate2 → await Maia
...
```

А MoveProvider ещё и сериализует requests через queue.

Это bottleneck.

Правильнее:

```text
candidate pool
↓
Tal gate
↓
cheap Pattern shortlist
↓
top 2–4
↓
Maia
```

Позже — Maia batch inference.

---

# 23. P1 — Maia пока только argmax reply

Для MVP один reply допустим.

Но будущий HumanReachability должен перейти к:

```text
top-k responses
+
weights/probabilities
```

Это не blocker текущего MVP, но нужно оставить в roadmap.


# 24. P1 — canonicalization стала relevance-aware, но всё ещё не описывает всю mate geometry

Это частичное исправление.

Теперь `canonicalizePatternPosition()` использует `context.relevantPieces`, а не все фигуры доски. Это хорошо.

Но canonical key строится только из:

```text
piece role
piece type
relative file/rank
```

Он не кодирует напрямую:

```text
escape occupancy
required covered squares
king confinement mask
mating corridor state
```

## Серьёзный пример

`relevant()` не гарантирует включение defender piece только потому, что она занимает escape square.

Canonical key может поэтому не отражать blocker, который критичен для mating geometry.

## Что сделать

Canonical representation должна кодировать не только pieces.

Например:

```text
MateGeometrySignature:
  king region
  escape occupancy mask
  required coverage mask
  role-piece relative offsets
  mating-line mask
```

---

# 25. P1 — symmetry normalization слишком агрессивна

`canonical.ts` перебирает:

```text
fileSign ±1
rankSign ±1
```

То есть применяется и rank mirror.

Но rank mirror не всегда сохраняет шахматную семантику:

```text
pawn direction
home rank
promotion direction
```

могут поменяться.

## Правильнее

Использовать только transformations, которые сохраняют конкретную mate geometry.

Например:

```text
file mirror
color swap + board rotation
```

Rank mirror — только если pattern descriptor явно допускает его.

---

# 26. P1 — relevance filtering всё ещё слишком heuristic

Сейчас attacker N/B/R/Q попадает в relevantPieces, если находится в Chebyshev distance <= 3 от king.

Это arbitrary cutoff.

Из-за этого:

- потенциально важная дальняя rook/queen может потеряться;
- нерелевантная фигура внутри radius 3 может попасть в canonical state.

Для attractor detection особенно плохо потерять фигуру, которая пока не атакует king zone, но является будущей mating role.

## Что нужно

Не generic radius.

Нужен `MateGeometry` relevance:

```text
piece can occupy one of relevant role slots
piece lies on potential mating corridor
piece controls / can occupy required local square
```

Не превращать это в general chess evaluation.

---

# 27. P1 — context.ts сам переизобретает chess attack rules

В `context.ts` вручную реализованы:

```text
pawn attacks
knight attacks
king attacks
bishop rays
rook rays
queen rays
```

Это допустимо как temporary geometry helper.

Но расширять это до:

```text
pins
x-rays
interpositions
legal tactical evaluation
```

не надо.

Использовать existing chess rules adapter/library для legality/rules, где возможно.

Pattern code должен строить только mate-specific geometry.

---

# 28. P1 — near-O(1) Pattern retrieval ещё НЕ реализован

Мы обсуждали:

```text
L0 cache
L1 MateGeometrySignature / family bitset gate
L2 tiny exact matchers
```

Текущий code всё ещё делает:

```ts
PATTERN_FAMILY_IDS
  .map(family => assessPatternContext(context, family))
  .sort(...)
```

То есть проверяет все 34 families.

Для 34 это нормально по latency, но это не near-O(1) design.

Также `context.ts` использует arrays/find/filter/some/FEN parsing.

## Как делать после semantic correctness

### L0 — cache

```text
(zobrist, attackerSide)
→ cached MateGeometrySignature + scores
```

### L1 — uint64 family bitset

34 families помещаются в 64 bits.

Coarse flags должны быть только geometry:

```text
KING_EDGE
KING_CORNER
KING_HOME_RANK
ROLE_N
ROLE_RQ
ROLE_BB
ESCAPE_OCCUPANCY_CLASS
```

Не tactical evaluation.

### L2

Запускать 2–5 точных family-specific geometry matchers.

---

# 29. P1 — cache semantics исправлены, но новый steering cache почти не использует

`state-cache.ts` теперь гораздо правильнее.

Но:

```text
evaluatePatternSteeringCandidates()
recognizePatternCase()
extractPatternPositionContext()
retrievePatternFamilies()
```

не получают `AnalysisCachePort`.

Значит new path пересчитывает всё заново.

## Что сделать

Wire cache в новый flow:

```text
PatternContext cache
PatternAssessment cache
MaiaResponse cache
EngineCandidate cache
RolloutSuffix cache
```

`ROLLOUT_SUFFIX` должен реально использоваться, а не только быть enum value.

---

# 30. P1 — hard negatives улучшены, но всё ещё слабые

Теперь есть `controlledHardNegative()`.

Это лучше старого unrelated negative.

Но сейчас generator просто удаляет первую найденную фигуру заданного типа:

```text
ANASTASIA → first attacker knight
BODEN     → first attacker bishop
BACK_RANK → first defender pawn
```

Не доказано, что удалена именно critical role.

## Что нужно

1. Recognize verified positive.
2. Определить конкретную required role.
3. Mutate именно её.
4. Re-run matcher.
5. Require:

```text
before score high
after score significantly lower
overall geometry still close
```

6. Сохранить:

```text
brokenCondition
sourceRole
beforeScore
afterScore
```

Тогда это будет real hard negative.

---

# 31. P1 — recognizer metrics имеют ошибки

## 31.1 Controls считаются hard negatives

Сейчас:

```ts
const negatives =
  results.filter(result => result.exampleKind !== "positive")
```

То есть:

```text
hard_negative + control
```

смешаны.

Но report называет metric:

```text
hardNegativeRejectionRate
```

Это неверно.

### Нужно

Отдельно:

```text
hardNegativeRejectionRate
controlFalsePositiveRate
```

---

## 31.2 Monotonicity считается между разными puzzles

Trajectories flatten'ятся, global-sort'ятся, а затем сравниваются соседние points.

Это сравнивает unrelated puzzle A и puzzle B.

### Нужно

Для каждой trajectory отдельно:

```text
s0 → s1 → s2 → ...
```

посчитать долю non-decreasing transitions.

Потом агрегировать.

---

## 31.3 Spearman с ties считается неточно

Distance-to-terminal содержит много одинаковых значений.

Current rank assignment даёт им разные ordinal ranks.

Нужны average ranks for ties.

---

## 31.4 Threshold 0.65 не calibrate'ится

Split существует, но threshold hardcoded.

Правильно:

```text
calibration
→ choose threshold / per-family threshold
→ freeze
→ evaluation
```

---

# 32. P1 — нет подтверждения CI на текущем HEAD

Для HEAD через GitHub connector не найдено:

```text
combined status checks
workflow runs
```

Это не значит, что код не проходит тесты.

Но нельзя утверждать:

```text
all tests pass
```

без фактического `npm run gate`.

Перед завершением rewrite нужен подтверждённый gate на актуальном HEAD и target Windows/Linux окружениях.

---

# 33. P1 — naming всё ещё смешивает legacy и current architecture

`pattern:experiment` по названию выглядит как current Pattern experiment.

Но фактически это старый post-hoc experiment.

Рекомендуемые names:

```text
pattern:legacy-posthoc
pattern:recognizer
pattern:steering
```

И типы:

```text
LegacyPostHocPatternExperiment
PatternRecognizerBenchmark
PatternSteeringBenchmark
PatternSteeredTalPath
```

---

# 34. Правильное разделение кирпичей

Целевая система должна держать ответственности жёстко раздельно:

```text
Patricia
= exploration / breadth

CSTal
= tactical creativity
= sacrifices
= move quality
= player-side continuation

Pattern Layer
= mating attractor recognition
= PatternProgress only

Maia(Elo)
= human opponent response model

Forced Mate Verifier
= objective truth

Cache
= avoid repeated work
```

Pattern Layer НЕ отвечает:

```text
"Хороший ли это шахматный ход?"
```

Он отвечает:

```text
"Из уже приемлемых для Tal ходов
какой сильнее приближает нас
к mating attractor?"
```

---

# 35. Целевой runtime loop

```text
POSITION S
    ↓
CANDIDATE GENERATION
    ↓
Patricia MultiPV
+ CSTal own candidates
+ optional Seer/Jakal
    ↓
deduplicated Candidate Pool
    ↓
CSTal TACTICAL GATE
    ↓
acceptable candidates only
    ↓
Mate Pattern Layer
    ↓
for each candidate:
    family-specific geometry delta
    target attractor
    ↓
cheap shortlist
    ↓
Maia(Elo)
    ↓
likely response(s)
    ↓
post-response attractor progress
    ↓
select candidate
    ↓
COMMIT TAL-SIDE MOVE
    ↓
Maia move
    ↓
NEW POSITION
    ↓
repeat
```

Когда attack входит в forcing basin:

```text
independent forced-mate verifier
```

После proven forced mate Pattern preference не должна портить объективное завершение.

---

# 36. Что нужно сделать дальше — P0

## P0.1 — Tal Tactical Gate

Pattern-only selection запрещён.

Acceptance test:

```text
candidate A:
Tal rejected
Pattern +0.8

candidate B:
Tal accepted
Pattern +0.2

selected MUST be B
```

---

## P0.2 — iterative Tal steering

Pattern selection выполняется на каждом attacker ply.

Acceptance:

```text
ply 1 = Tal-guided candidate
ply 2 = Maia
ply 3 = Tal-guided candidate
ply 4 = Maia
...
```

Не Stockfish takeover.

---

## P0.3 — настоящий steering benchmark

Baseline:

```text
normal CSTal × Maia
```

Treatment:

```text
Pattern-steered CSTal × Maia
```

Оба должны использовать одинаковые engine budgets и opponent model.

---

## P0.4 — legacy scorer вывести из production path

`assessPattern()` оставить legacy-only.

---

# 37. Следующая очередь — P1

## P1.1

PatternProgress per-family + `targetFamily`.

## P1.2

Candidate pool union without Patricia starvation.

## P1.3

CSTal ABSURD/EXTREME candidates включить в pool.

## P1.4

Переписать first 5 matchers на real MateGeometry.

## P1.5

После этого переписать остальные 14 Lichess core.

## P1.6

Сузить Pattern representation: MateGeometry, не generic tactical graph.

## P1.7

Canonical signature расширить masks/roles/corridors.

## P1.8

Исправить symmetry policy.

## P1.9

Wire namespace caches в actual steering path.

## P1.10

Strengthen hard negatives.

## P1.11

Fix recognizer metrics and real threshold calibration.

---

# 38. Performance plan после correctness

Не оптимизировать неправильную семантику.

Когда matchers правильные:

```text
L0 — transposition cache
L1 — MateGeometrySignature + uint64 family bitset
L2 — 2–5 exact geometry matchers
```

Это даст практически constant-time recognition для текущих 34 families.

---

# 39. Maia performance

Current bottleneck:

```text
candidate1 → Maia
candidate2 → Maia
candidate3 → Maia
...
```

Правильно:

```text
8–12 candidates
↓
Tal gate
↓
cheap Pattern shortlist
↓
2–4 candidates
↓
Maia
```

Позже:

```text
Maia batch inference
```

Это даст больше выигрыша, чем micro-optimize 34 matchers.

---

# 40. Не делать сейчас

Не надо:

- fine-tune CSTal;
- добавлять Pattern reward в NNUE;
- писать generic evaluation engine;
- добавлять ещё generic tactical relations;
- обучать foundation model;
- тащить тысячи `deadly` clusters;
- считать similarity доказательством mate;
- добавлять ANN/HNSW до появления большого prototype corpus.

**ML training в этом ревью не предлагается.** Сначала закончить правильный symbolic/geometry steering loop.

---

# 41. Новый Definition of Done

Rewrite можно считать законченным только когда:

1. attacker side фиксирован;
2. runtime discovery работает без family label;
3. Lichess trajectories используются;
4. recognizer benchmark отделён от engines;
5. первые 5 MateGeometry matchers реально различимы;
6. hard negatives ломают actual required relation;
7. candidate pool — настоящий union;
8. CSTal candidates входят в pool;
9. CSTal tactical gate существует;
10. Pattern Layer не может override Tal veto;
11. PatternProgress считается per-family;
12. decision хранит `targetFamily`;
13. Maia вызывается после tactical/cheap shortlist;
14. Pattern steering повторяется на каждом attacker ply;
15. player-side continuation остаётся CSTal;
16. forced mate подтверждается отдельно;
17. steering benchmark тестирует новый iterative algorithm;
18. legacy post-hoc experiment явно помечен legacy;
19. Pattern cache реально используется;
20. rollout suffix cache реально используется;
21. recognizer metrics исправлены;
22. calibration реально определяет thresholds;
23. `npm run gate` подтверждён на HEAD;
24. performance baseline измерен;
25. только затем внедрён MateGeometry bitset/cache near-O(1).

---

# 42. Рекомендуемый порядок следующих коммитов

## Commit A

`refactor: separate legacy pattern experiment from production steering`

- rename old experiment;
- isolate legacy scorer.

## Commit B

`feat: add CSTal tactical candidate gate`

- test `searchmoves`;
- parse CSTal score;
- accepted/rejected candidate model.

## Commit C

`fix: compose candidate pool without source starvation`

- per-source budgets;
- union;
- dedupe;
- final cap.

## Commit D

`fix: compute pattern progress per attractor family`

- `targetFamily`;
- same-family before/after/post-Maia scores.

## Commit E

`feat: add iterative Tal-Maia pattern-steered path`

- steering on every attacker ply;
- no Stockfish odd-ply takeover.

## Commit F

`feat: add true steering benchmark`

Compare baseline CSTal×Maia against steered CSTal×Maia.

## Commit G

`refactor: replace generic tactical context with mate geometry descriptors`

Start with five families.

## Commit H

`fix: strengthen hard negatives and recognizer metrics`

## Commit I

`perf: add cached mate geometry signature and family bitset gating`

Только после semantic tests.

---

# 43. Главный продуктовый критерий

Новый код должен отвечать:

> **Какие mating attractors реально открыты из этой позиции, какой из тактически приемлемых для Tal ходов сильнее двигает нас к одному из них, какой человеческий ответ Maia делает этот attractor наиболее вероятным, и с какого момента линия становится objectively forced?**

Он НЕ должен отвечать:

> «Как заставить generic hand-written Pattern evaluator спорить с Tal».

Именно эта граница должна определять дальнейшую архитектуру.
