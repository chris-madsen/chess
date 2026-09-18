# Pattern Layer — подробный Code Review и план полной переделки

Repository: https://github.com/chris-madsen/chess/tree/master  
Дата ревью: 2026-09-18  
Статус документа: рабочее ТЗ на исправление текущей реализации Pattern Layer

---

# 0. Краткий вывод

Текущая реализация содержит полезный каркас, но в её нынешнем виде **не реализует задуманный Pattern-Guided chess**.

Сейчас система в основном делает следующее:

```text
CSTal ABSURD строит готовую линию
CSTal EXTREME строит готовую линию
        ↓
после этого
        ↓
линии оцениваются по заранее указанному паттерну
        ↓
выбирается та, где score выше
```

То есть это:

```text
post-hoc line ranking
```

а не:

```text
pattern-guided move steering
```

Нужная архитектура должна быть другой:

```text
текущая позиция
↓
несколько candidate moves
↓
Pattern Layer определяет:
  - какие паттерны вообще здесь релевантны;
  - к каким паттернам приближает каждый ход;
  - что происходит после вероятного ответа Maia;
↓
candidate reranking
↓
выбирается следующий ход
↓
новая позиция
↓
цикл повторяется
```

Критические проблемы текущего кода:

1. атакующая сторона меняется вместе с `sideToMove`;
2. target family заранее приходит из dataset label;
3. Pattern Layer не управляет ходами, а оценивает уже готовые линии;
4. symbolic scorer слишком грубый;
5. разные матовые семейства почти неразличимы;
6. canonicalization включает все фоновые фигуры;
7. canonicalization фактически не является основой scorer path;
8. cache для Pattern Layer включает историю ходов и ломает reuse транспозиций;
9. Lichess puzzle trajectory используется неправильно;
10. `solutionMoves` сохраняются, но затем выбрасываются;
11. `expected` парсится, но затем фактически теряется;
12. «hard negatives» не являются hard negatives;
13. `hard_negative/control` почти не участвуют в метриках recognizer;
14. calibration и evaluation смешиваются в итоговом отчёте;
15. `scoreFamily()` вычисляет все 34 семейства даже при запросе одного;
16. все 472 дорогих engine experiments прогоняются последовательно;
17. часть runtime identity/caching сделана универсально там, где нужны разные правила для Pattern/Maia/engine/rollout;
18. текущий `PatternState` основан на общих числовых thresholds, а не на структурном состоянии конкретного матового семейства.

---

# 1. Важное уточнение про число 472

В текущем репозитории **нет 472 матовых паттернов**.

Каталог содержит:

```text
19 Lichess core mate families
+
15 extended named mate families
=
34 mate families
```

Файл:

- `src/domain/patterns/pattern.ts`  
  https://github.com/chris-madsen/chess/blob/master/src/domain/patterns/pattern.ts

Число `472` относится к dataset cases.

В `datasets/README.md` сказано, что corpus содержит:

```text
19 families
×
(16 positives + 8 hard negatives)
+
16 controls
=
472 positions
```

Источник:

- https://github.com/chris-madsen/chess/blob/master/datasets/README.md

То есть проблема не в том, что runtime последовательно проверяет 472 named patterns.

Но есть две реальные проблемы:

1. benchmark CLI последовательно прогоняет все 472 cases через дорогие CSTal × Maia rollouts;
2. внутри `scoreFamily()` при запросе одного family создаются scores для всех 34 семейств.

---

# 2. Основные файлы, которые относятся к проблеме

## Pattern domain

- `src/domain/patterns/pattern.ts`  
  https://github.com/chris-madsen/chess/blob/master/src/domain/patterns/pattern.ts

- `src/domain/patterns/canonical.ts`  
  https://github.com/chris-madsen/chess/blob/master/src/domain/patterns/canonical.ts

- `src/domain/patterns/motifs.ts`  
  https://github.com/chris-madsen/chess/blob/master/src/domain/patterns/motifs.ts

- `src/domain/patterns/outcomes.ts`  
  https://github.com/chris-madsen/chess/blob/master/src/domain/patterns/outcomes.ts

## Experiment orchestration

- `src/application/use-cases/pattern-experiment.ts`  
  https://github.com/chris-madsen/chess/blob/master/src/application/use-cases/pattern-experiment.ts

- `src/cli/pattern-experiment.ts`  
  https://github.com/chris-madsen/chess/blob/master/src/cli/pattern-experiment.ts

- `src/application/experiments/pattern-report.ts`  
  https://github.com/chris-madsen/chess/blob/master/src/application/experiments/pattern-report.ts

- `src/application/experiments/pattern-dataset.ts`  
  https://github.com/chris-madsen/chess/blob/master/src/application/experiments/pattern-dataset.ts

## Dataset builder

- `scripts/build-lichess-pattern-dataset.mjs`  
  https://github.com/chris-madsen/chess/blob/master/scripts/build-lichess-pattern-dataset.mjs

## Cache

- `src/domain/cache/state-cache.ts`  
  https://github.com/chris-madsen/chess/blob/master/src/domain/cache/state-cache.ts

- `docs/decisions/ADR-006-pattern-state-cache.md`  
  https://github.com/chris-madsen/chess/blob/master/docs/decisions/ADR-006-pattern-state-cache.md

---

# 3. P0 — атакующая сторона меняется на каждом ply

## Где

В `extractPatternFeatures()`:

```ts
const attackingSide = facts.isCheckmate
  ? opposite(facts.sideToMove)
  : facts.sideToMove;
```

## Почему это критическая ошибка

Если CSTal играет за белых, то именно белые являются атакующей стороной для всего анализа комбинации.

Но текущий код делает так:

```text
Position 0:
White to move
→ attacker = White

White makes a move

Position 1:
Black / Maia to move
→ attacker = Black

Black makes a move

Position 2:
White to move
→ attacker = White
```

То есть `PatternProgress` сравнивает:

```text
геометрию атаки белых
→ геометрию атаки чёрных
→ снова геометрию атаки белых
```

Это математически бессмысленный signal.

## Как исправить

Атакующая сторона должна фиксироваться один раз на уровне анализа:

```ts
type PatternAnalysisContext = Readonly<{
  attackerSide: Side;
  defenderSide: Side;
}>;
```

И дальше каждый вызов Pattern Layer получает explicit context:

```ts
assessPattern(position, facts, family, analysisContext);
```

Никаких попыток вывести attacker из `sideToMove`.

## Правильно

```text
CSTal side = White
↓
attackerSide = White
↓
Maia ходит чёрными
↓
attackerSide всё равно White
↓
CSTal ходит
↓
attackerSide всё равно White
```

## Acceptance criteria

Добавить regression test:

```text
12 plies CSTal ↔ Maia
```

и проверить:

```text
attackerSide одинаков для всех 12 plies
```

---

# 4. P0 — target pattern приходит из dataset и превращает recognizer в oracle-assisted scorer

## Где

`PatternExperimentCase` содержит:

```ts
family: PatternFamilyId;
```

Дальше:

```ts
assessPattern(current, facts.value, family, previousSimilarity);
```

## Что сейчас реально делает система

Не:

```text
"Какой паттерн здесь формируется?"
```

а:

```text
"Мне уже сказали, что это Anastasia.
Теперь посчитаю Anastasia-score."
```

Это допустимо для offline family-specific benchmark.

Но недопустимо как runtime architecture.

## Почему это проблема

В реальной игре никакого:

```text
family = ANASTASIA
```

в input не будет.

Система должна сама определить:

```text
ANASTASIA: 0.72
VUKOVIC:   0.58
ARABIAN:   0.31
BODEN:     0.12
```

и решить, какие target families вообще имеют смысл.

## Как исправить

Нужно разделить API на два режима.

### Offline benchmark

```ts
assessKnownFamily(position, context, family)
```

Используется только там, где ground-truth family уже известен.

### Runtime

```ts
retrieveCandidateFamilies(position, context)
```

например:

```json
[
  {"family":"ANASTASIA","score":0.72},
  {"family":"VUKOVIC","score":0.58},
  {"family":"ARABIAN","score":0.31}
]
```

## Acceptance criteria

Runtime API должен работать:

```text
без supplied family
```

---

# 5. P0 — Pattern Layer работает post-hoc, а не steering

## Где

`pattern-experiment.ts` сначала получает готовые `StylePathLineResult`.

Дальше только после этого выполняется:

```text
tracePatternLine()
selectPatternLine()
```

## Что получается

```text
ABSURD уже сыграл всю линию
EXTREME уже сыграл всю линию
↓
потом scorer смотрит обе
↓
выбирает понравившуюся
```

Это не управление поиском.

## Почему это принципиально неправильно

Главная идея проекта:

> Pattern Layer должен влиять на выбор следующего хода, а не оценивать красоту законченной партии.

## Правильный runtime loop

```text
Current position S
↓
Candidate generation
↓
m1 m2 m3 ... mN
↓
для каждого:
    PatternProgress
    TacticalQuality
    Maia response probability
↓
reranking
↓
selected move
↓
Maia reply
↓
new position
↓
repeat
```

## Acceptance criteria

Pattern score должен участвовать:

```text
до фиксации следующего CSTal/player-side move
```

---

# 6. P1 — `scoreFamily()` вычисляет все 34 семейства при запросе одного

## Где

Текущий код строит:

```ts
const scores: Record<PatternFamilyId, ...> = {
  ANASTASIA: {...},
  ARABIAN: {...},
  ...
  DIAGONAL_CORRIDOR: {...}
};

return scores[family];
```

## Что это означает

При:

```ts
scoreFamily("ANASTASIA", features)
```

JS всё равно создаёт:

```text
34 score values
34 evidence arrays
много маленьких объектов
```

и только потом берёт `ANASTASIA`.

## Это не главная производительная проблема

По сравнению с CSTal/Maia это мелочь.

Но форма функции неправильная и плохо масштабируется.

## Как исправить

Вариант 1:

```ts
switch (family) {
  case "ANASTASIA":
    return scoreAnastasia(context);
  ...
}
```

Лучше:

```ts
const MATCHERS: Record<PatternFamilyId, PatternMatcher> = {
  ANASTASIA: anastasiaMatcher,
  ARABIAN: arabianMatcher,
  ...
};
```

И:

```ts
MATCHERS[family].score(context)
```

---

# 7. P1 — текущий symbolic scorer не описывает настоящую геометрию матовых паттернов

## Какие признаки сейчас используются

Примерно:

```text
king on edge
king in corner
adjacent friendly blockers
adjacent empty squares
nearby knight count
nearby rook/queen count
bishop count
legal check count
legal capture count
isCheck
isCheckmate
```

## Почему этого недостаточно

Для Anastasia важно не:

```text
есть конь где-то рядом
```

а:

```text
конь контролирует конкретный escape square
```

Для Boden важно не:

```text
есть два слона
```

а:

```text
два слона образуют конкретную crossing-diagonal geometry вокруг короля
```

Для Arabian важно:

```text
ладья и конь совместно покрывают конкретные клетки возле углового короля
```

Для back rank важно:

```text
король находится на домашней горизонтали и его собственные пешки/фигуры закрывают escape
```

## Что должно быть вместо этого

Нужен relational graph / king-centric context.

```ts
type PatternPositionContext = {
  attackerSide: Side;
  defenderSide: Side;

  king: {
    square: Square;
    onEdge: boolean;
    inCorner: boolean;
    onHomeRank: boolean;
  };

  escapeSquares: readonly EscapeSquare[];

  attackers: readonly RelevantPiece[];
  defenders: readonly RelevantPiece[];

  relations: {
    attacks: readonly AttackRelation[];
    defends: readonly DefenseRelation[];
    blocks: readonly BlockRelation[];
    pins: readonly PinRelation[];
    xrays: readonly XRayRelation[];
    checkingLines: readonly RayRelation[];
    interpositions: readonly InterpositionRelation[];
  };
};
```

## Ключевые relations

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

---

# 8. P1 — разные матовые семейства сейчас математически почти одинаковы

## Проблема

Многие families используют почти одни и те же aggregated variables.

Например:

```text
edge
rooks
bishops
checks
blockers
```

с немного разными весами.

Из-за этого scorer физически не умеет отличить:

```text
Greco
Opera
Morphy
Max Lange
Mayet
```

если у них похожие counts.

## Как исправить

У каждого pattern family должен быть собственный structural matcher.

Пример:

```ts
interface PatternMatcher {
  family: PatternFamilyId;

  prefilter(context: PatternPositionContext): boolean;

  score(context: PatternPositionContext): {
    similarity: number;
    evidence: readonly PatternEvidence[];
    missingConditions: readonly MissingCondition[];
    contradictions: readonly PatternContradiction[];
  };
}
```

## Почему нужны `missingConditions`

Потому что для steering недостаточно знать:

```text
score = 0.68
```

Нужно знать:

```text
до Anastasia не хватает:
- knight control на h7;
- открыть rook file;
- убрать defender с g8.
```

Это превращает recognizer в planner signal.

---

# 9. P1 — BACK_RANK реализован через generic `kingOnEdge`

## Почему это ошибка

Клетки:

```text
a4
h5
```

являются edge squares.

Но back-rank mate к ним отношения не имеет.

## Как правильно

Нужно вычислять:

```text
king_on_home_rank
```

Для белого короля:

```text
rank 1
```

Для чёрного:

```text
rank 8
```

После canonicalization:

```text
defender_back_rank
```

должен быть семантическим relation, а не generic board edge.

---

# 10. P1 — canonicalization включает все фигуры, включая нерелевантный фон

## Где

`canonical.ts` кодирует каждую фигуру относительно target king.

## Почему это ломает основной принцип проекта

Две позиции:

```text
A
```

и:

```text
A + бесполезная пешка a3
```

должны считаться одним и тем же pattern geometry.

Но canonical key будет разным.

## Как исправить

Перед canonicalization нужен relevance filter.

Pipeline:

```text
Full board
↓
relevance extraction
↓
king-centric subgraph
↓
symmetry normalization
↓
canonical pattern representation
```

## Какие фигуры считать relevant

Те, которые:

```text
атакуют king zone;
атакуют escape square;
защищают mating piece;
занимают escape square;
могут забрать mating piece;
могут interpose;
создают pin/xray;
могут попасть на critical square за 1–2 moves.
```

Остальные не должны попадать в canonical pattern key.

---

# 11. P1 — canonicalization существует отдельно, но scorer почти не использует её

## Проблема

Есть:

```text
canonical.ts
```

Но `assessPattern()` снова отдельно парсит FEN и строит свои coarse features.

То есть проект содержит две параллельные модели позиции:

```text
canonical representation
```

и:

```text
pattern features
```

которые не являются одним source of truth.

## Как правильно

Должен быть один pipeline:

```text
PositionSnapshot
↓
PatternPositionContext
↓
CanonicalPatternContext
↓
retrieval + matcher + embeddings + cache
```

---

# 12. P1 — Pattern cache включает historySignature и ломает транспозиции

## Где

`positionStateKey()` добавляет:

```text
historySignature
```

на основе списка ходов.

`PATTERN_ASSESSMENT` использует этот key.

## Что ломается

Разные move orders:

```text
Nf3 Nc6 Bc4 Nf6
```

и:

```text
Bc4 Nf6 Nf3 Nc6
```

могут привести к одной позиции.

Для Pattern Layer это должен быть cache hit.

Но full history делает key разным.

## Правильная cache semantics

### PatternContext cache

```text
zobrist position
+ attackerSide
+ extractorVersion
```

### PatternAssessment cache

```text
canonical pattern context
+ family
+ matcher/model version
```

### Maia cache

History включать только если конкретный Maia runtime реально использует history:

```text
zobrist
+ Elo
+ Maia version
+ optional history signature
```

### Engine cache

```text
zobrist
+ engine version
+ depth/nodes/time
+ options
```

### Rollout suffix cache

```text
zobrist
+ attackerSide
+ CSTal config
+ Maia config
+ Elo
+ steering policy version
```

## Главное правило

Не должно быть одного универсального максимального cache key для всех namespaces.

---

# 13. P1 — Lichess puzzle FEN/trajectory используется неправильно

## Где

Builder сохраняет:

```text
FEN
Moves
Themes
```

Но runtime dataset parser оставляет только позицию и family.

## Важное про Lichess puzzle format

У Lichess puzzle solution содержит sequence moves.

Для полноценного анализа нужен не только исходный FEN, а все состояния вдоль решения.

## Правильное использование

```text
source FEN
↓
apply first move according to Lichess puzzle semantics
↓
actual puzzle start
↓
solution move
↓
state 1
↓
reply
↓
state 2
...
↓
mate / terminal tactical state
```

## Почему это важно

Это готовый proximity dataset:

```text
far
forming
near
mate basin
mate
```

---

# 14. P1 — `solutionMoves` сохраняются builder'ом, но затем выбрасываются

## Где

`scripts/build-lichess-pattern-dataset.mjs` пишет:

```text
solutionMoves
```

Но `PatternDatasetEntry` в parser не сохраняет это поле.

## Итог

Самая полезная часть Lichess puzzle data просто теряется.

## Как исправить

Добавить:

```ts
solutionMoves: readonly UciMove[];
```

и строить trajectory:

```ts
trajectory: readonly PositionSnapshot[];
```

или хранить их в dataset record.

---

# 15. P1 — `expected` парсится, но затем практически теряется

## Сейчас

Parser умеет прочитать:

```json
"expected": {
  "terminalMate": true,
  "mateLength": 5
}
```

Но дальше experiment case это не несёт как полноценный ground truth.

## Почему плохо

Benchmark должен проверять:

```text
expected mate
expected family
expected terminal geometry
distance-to-terminal
```

а не только красиво ли сыграли engine lines.

## Как исправить

Разделить:

```text
recognizer ground truth
trajectory ground truth
engine outcome
```

---

# 16. P1 — текущие hard negatives не являются hard negatives

## Как сейчас

Для family X берётся puzzle другой mate theme.

Например:

```text
Boden puzzle
```

становится:

```text
hard negative for Anastasia
```

## Почему это просто negative, а не hard negative

Он может вообще никак не быть похож на Anastasia.

Настоящий hard negative должен выглядеть очень похоже, но не работать.

## Как правильно

Создавать их controlled perturbation:

```text
verified positive
↓
сломать одну критическую relation
↓
сохранить остальную геометрию
↓
verify that mate motif no longer works
```

Примеры:

```text
knight moved one square;
rook file blocked;
king gets one escape square;
mating piece becomes capturable;
critical defender no longer pinned;
blocking pawn removed.
```

---

# 17. P1 — `hard_negative` и `control` почти не используются в recognizer metrics

## Сейчас

Основной итоговый metric:

```text
beautifulForcedCombination
```

Это смесь:

```text
pattern match
terminal mate
forced mate verifier
```

## Почему это не меряет качество recognizer

Нужно отдельно понимать:

```text
умеет ли система узнавать Anastasia;
отличает ли похожие, но неверные позиции;
путает ли Boden и Double Bishop;
растёт ли score к мату.
```

## Нужные metrics

### Recognition

```text
precision
recall
F1
false positive rate
top-1 accuracy
top-k recall
confusion matrix
hard-negative rejection rate
```

### Proximity

```text
mean score by ply distance
median score by ply distance
Spearman correlation(score, closeness)
monotonicity rate
```

### Steering

Отдельно:

```text
forced-mate rate
named-pattern mate rate
beautiful combination rate
average compute cost
time-to-mate
```

---

# 18. P1 — calibration и evaluation смешиваются в final report

## Сейчас

Dataset содержит:

```text
split: calibration
split: evaluation
```

Но `summarizePatternExperiment()` агрегирует все results вместе.

## Почему это неправильно

Calibration split нужен для:

```text
thresholds
weights
rule tuning
```

Evaluation split нужен для:

```text
final unbiased metrics
```

## Как исправить

Строго:

```text
calibration:
  tune only

evaluation:
  report only
```

---

# 19. P2 — все 472 expensive cases идут последовательно

## Где

В CLI:

```ts
for (const experimentCase of dataset.value) {
  await ...
}
```

## Почему это дорого

Для одного case вызываются:

```text
CSTal ABSURD + Maia
CSTal EXTREME + Maia
optional forced mate verifier
```

472 раза подряд.

## Правильное разделение

### Tier A — recognizer benchmark

На всех 472+ cases:

```text
NO CSTal
NO Maia
NO forced-mate proof
```

Только:

```text
PatternContext
family matching
proximity
classification
```

### Tier B — steering benchmark

На меньшем representative subset:

```text
50–150 positions
```

и только там:

```text
candidate pool
Pattern reranking
Maia
CSTal rollout
forced mate verifier
```

## Параллелизация

Использовать bounded worker pool:

```text
N workers
```

по benchmark'у CPU/GPU нагрузки.

---

# 20. P1 — universal PatternState thresholds слишком грубые

## Сейчас

```text
0.25 promising
0.45 forming
0.65 near
0.80 mate_basin
```

одинаково для всех patterns.

## Почему плохо

У каждого матового семейства своя структура.

Например:

```text
ANASTASIA near
```

может означать:

```text
knight controls escape;
rook line почти открыта;
king уже confined.
```

А:

```text
BODEN near
```

имеет совсем другую геометрию.

## Как исправить

В MVP можно временно оставить generic score.

Но состояние должно постепенно стать family-aware:

```ts
matcher.classifyState(context)
```

---

# 21. Что из текущей реализации стоит сохранить

Не всё плохо.

Оставить:

1. `PatternFamilyId`;
2. разделение mate families и tactical motifs;
3. отдельный `PatternAssessment`;
4. forced-mate verifier отдельно от similarity;
5. cache namespaces;
6. provenance;
7. Lichess source metadata;
8. immutable/data-oriented TypeScript style;
9. отдельный experiment harness;
10. distinction:
   ```text
   pattern similarity != forced mate
   ```

Основная переделка нужна в:

```text
pattern semantics
runtime control flow
dataset semantics
cache identity
benchmark design
```

---

# 22. Правильная целевая архитектура

```text
Current Position
      ↓
PatternPositionContext
computed once
      ↓
cheap structural prefilter
      ↓
top plausible families
      ↓
precise relational family matchers
      ↓
PatternState
      ↓
Candidate generation
Patricia MultiPV + CSTal + optional Seer/Jakal
      ↓
candidate moves
      ↓
for each move:
    apply move
    compute PatternProgress
    query Maia likely reply
    compute expected post-reply progress
      ↓
rerank
      ↓
select move
      ↓
new position
      ↓
repeat
      ↓
when attack becomes forcing:
forced-mate verifier
```

---

# 23. Structural prefilter

Для 34 families можно проверять все 34.

Это не дорого.

Но правильная architecture должна позволять scaling.

Сначала cheap signature:

```text
HAS_KNIGHT
HAS_ROOK
HAS_QUEEN
TWO_BISHOPS
KING_EDGE
KING_CORNER
KING_HOME_RANK
BLOCKED_ESCAPES
OPEN_FILE_TO_KING
OPEN_DIAGONAL_TO_KING
```

Пример:

```text
ANASTASIA requires:
KNIGHT
+
ROOK_OR_QUEEN
+
KING_EDGE
```

Если нет knight:

```text
не нужно запускать точный Anastasia matcher
```

---

# 24. Для тысяч future clusters — ANN retrieval

Когда появятся:

```text
34 named patterns
+
opening-specific patterns
+
hundreds/thousands deadly clusters
```

тогда:

```text
PatternPositionContext
↓
embedding
↓
ANN search
↓
top 10–30 pattern prototypes
↓
relational verification
```

Backend:

```text
FAISS
HNSW
pgvector
```

Для текущих 34 families это пока не обязательно.

---

# 25. Новый API Pattern Layer

## Extraction

```ts
extractPatternContext(
  position,
  attackerSide
): PatternPositionContext
```

## Retrieval

```ts
retrievePatternFamilies(
  context,
  limit = 8
): readonly PatternCandidate[]
```

## Precise scoring

```ts
assessPatternFamily(
  context,
  family
): PatternAssessment
```

## Full position assessment

```ts
assessPatterns(
  context,
  limit = 8
): readonly PatternAssessment[]
```

## Move progress

```ts
assessMoveProgress(
  beforeContext,
  afterContext,
  candidateFamilies
): PatternMoveAssessment
```

---

# 26. Новый формат matcher

```ts
interface PatternMatcher {
  family: PatternFamilyId;

  prefilter(
    context: PatternPositionContext
  ): boolean;

  score(
    context: PatternPositionContext
  ): {
    similarity: number;
    evidence: readonly PatternEvidence[];
    missingConditions: readonly string[];
    contradictions: readonly string[];
  };
}
```

---

# 27. Начинать не со всех 34, а с 5 хорошо формализуемых patterns

Первая волна:

```text
ANASTASIA
ARABIAN
BACK_RANK
BODEN
SMOTHERED
```

Почему:

- геометрия хорошо известна;
- встречаются в Lichess;
- различаются структурно;
- удобно создавать hard negatives.

После того как они хорошо работают:

```text
остальные 14 Lichess core
```

и только затем:

```text
15 extended
```

---

# 28. Правильный Lichess dataset pipeline

Для каждой puzzle:

```text
raw Lichess FEN
↓
apply first move according to puzzle format
↓
actual puzzle state
↓
apply remaining solution moves
↓
collect:
s0
s1
s2
...
sN
```

Для каждого state:

```json
{
  "family":"ANASTASIA",
  "distanceToTerminal":4,
  "fen":"..."
}
```

Это станет:

```text
recognition dataset
+
proximity dataset
```

---

# 29. Настоящие hard negatives

Для каждого positive:

```text
positive
↓
single controlled perturbation
↓
family broken
↓
geometry mostly preserved
↓
hard negative
```

Пример Anastasia:

```text
positive:
knight controls escape
rook file open

negative:
knight shifted one square

result:
looks similar
but escape exists
```

---

# 30. Candidate generation в MVP

Использовать:

```text
Patricia MultiPV: 8–12
+
CSTal own bestmove: 1
+
optional Seer/Jakal: 1–2
```

После dedup:

```text
~8–15 unique moves
```

---

# 31. Move scoring

Conceptually:

```text
Score(move) =
    TacticalQuality
  + α * PatternProgress
  + β * HumanResponseProbability
  + γ * ForcedMatePotential
  + δ * Beauty
```

До forced mate:

```text
PatternProgress
Human probability
Beauty
```

имеют значение.

После proven forced mate:

```text
ForcedMatePotential dominates
```

и aesthetic preference не должна отвергать более надёжный forced mate.

---

# 32. Две фазы поиска

## Steering phase

```text
нет доказанного мата
↓
ищем ход, который улучшает:
pattern geometry
human practicality
attack quality
```

## Mate basin phase

```text
атака стала forcing
↓
pattern bonus перестаёт доминировать
↓
проверяем все legal defenses
↓
forced mate proof
```

---

# 33. Memoization / transpositions

Нужно сделать отдельные caches.

## PatternContext cache

```text
key:
zobrist
attackerSide
extractorVersion
```

## PatternAssessment cache

```text
key:
canonical local graph
family
matcherVersion
```

## Maia cache

```text
key:
zobrist
Elo
modelVersion
optional history
```

## Engine cache

```text
key:
zobrist
engine version
depth/nodes/time
options
```

## Rollout suffix cache

```text
key:
zobrist
attackerSide
CSTal config
Maia config
Elo
policyVersion
```

---

# 34. Parallelism

## Candidate parallelism

```text
move1 → worker1
move2 → worker2
move3 → worker3
...
```

## Dataset benchmark

Также bounded worker pool.

Но concurrency определить benchmark'ом:

```text
1
2
3
4
5
...
```

и измерять:

```text
wall-clock
CPU
RAM
GPU
VRAM
latency
```

---

# 35. Maia batching

Если несколько rollout workers одновременно ждут Maia:

```text
positions = [
  pos1,
  pos2,
  pos3,
  pos4
]
```

отправлять batch inference вместо отдельных sequential calls.

Это может сильно повысить GPU utilization.

---

# 36. Переработанный план по фазам

## Phase 0 — заморозить текущий scorer

Не расширять:

```text
symbolic-v3-named-catalog
```

новыми формулами.

Сохранить только как historical baseline.

Новая версия:

```text
symbolic-v4-relational
```

---

## Phase 1 — исправить P0

### 1.1 Fixed attacker side

Ввести:

```ts
PatternAnalysisContext
```

### 1.2 Separate offline/runtime API

```text
offline:
assessKnownFamily

runtime:
retrieveCandidateFamilies
```

### 1.3 Stop post-hoc selection

Pattern score должен применяться до выбора следующего move.

### 1.4 Fix Lichess trajectory ingestion

Сохранять и использовать:

```text
solutionMoves
trajectory
distanceToTerminal
```

---

## Phase 2 — relational position context

### 2.1 Parse board once

Один board representation на position.

### 2.2 Build attack maps

```text
attacks
defends
```

### 2.3 King zone

```text
escape squares
blocked escapes
attacked escapes
```

### 2.4 Tactical relations

```text
pins
x-rays
interpositions
checking lines
capture availability
```

### 2.5 Relevance filtering

Удалять фоновые фигуры.

---

## Phase 3 — первые 5 правильных matchers

Реализовать:

```text
ANASTASIA
ARABIAN
BACK_RANK
BODEN
SMOTHERED
```

Каждый должен иметь:

```text
required conditions
supportive conditions
contradictions
missing conditions
score
```

---

## Phase 4 — правильный benchmark recognizer

Без движков.

На всех dataset states:

```text
Pattern Layer only
```

Метрики:

```text
precision
recall
F1
top-k
confusion
hard negative rejection
proximity trend
latency
cache hit rate
```

---

## Phase 5 — real hard negatives

Минимум для первых 5 patterns:

```text
100+ positives per family
50+ hard negatives per family
```

---

## Phase 6 — structural retrieval

Добавить cheap prefilter:

```text
34
↓
3–8 plausible families
```

---

## Phase 7 — move-level PatternProgress

```text
S
↓ move
S'
```

считать:

```text
ΔPattern
```

---

## Phase 8 — Patricia MultiPV integration

Candidate pool:

```text
Patricia 8–12
+
CSTal 1
+
optional Seer/Jakal
```

---

## Phase 9 — Maia one-step lookahead

Для shortlisted move:

```text
move
↓
Maia reply
↓
PatternScore
```

И использовать:

```text
expected human-conditioned progress
```

---

## Phase 10 — full rollout только top-k

Полный:

```text
CSTal ↔ Maia
```

делать не для всех candidates.

Только:

```text
top 2–4
```

---

## Phase 11 — forced mate verification

Если:

```text
attack is forcing
```

включать:

```text
Stockfish / dedicated mate verifier
```

---

## Phase 12 — namespace-specific caching

Исправить:

```text
pattern
maia
engine
rollout suffix
```

каждый своим key policy.

---

## Phase 13 — parallel execution

Параллелить:

```text
candidate rollouts
steering benchmark
```

bounded concurrency.

---

## Phase 14 — ChessLM

После успешного symbolic baseline:

```text
SymbolicScore
+
ChessLM similarity
```

---

## Phase 15 — Pattern Head только если реально нужен

Не train foundation model.

Использовать:

```text
frozen backbone
+
small projection/head
```

---

# 37. Optional Pattern Head — dataset/time/cost

Это не обязательно для MVP-A.

Первый эксперимент:

```text
100k–300k labelled/augmented states
```

Frozen backbone.

Оценка:

```text
~0.5–2 GPU hours
```

Для ~1M states:

```text
~1–4 GPU hours
```

Ориентир AWS SageMaker A10G-class:

```text
small run:
примерно $1–5

feature extraction + несколько runs:
примерно $10–50
```

Это предварительный engineering budget.

Перед реальным запуском стоимость instance нужно проверить по текущему AWS region/pricing.

---

# 38. Acceptance criteria нового MVP

## Correctness

- attacker side фиксирован;
- runtime работает без supplied family;
- irrelevant remote pieces почти не влияют;
- mirror/color symmetries объединяются;
- hard negatives получают ниже score;
- pattern similarity отделена от forced mate.

## Data

- Lichess trajectory восстановлена;
- `solutionMoves` не теряются;
- calibration/evaluation разделены;
- hard negatives реально hard;
- provenance сохранён.

## Runtime

- Patricia MultiPV работает как root proposer;
- Pattern Layer влияет на выбор следующего хода;
- Maia участвует до full rollout;
- full rollout запускается только на shortlisted candidates;
- transpositions дают cache hit.

## Performance

- pure pattern recognition — millisecond-scale;
- recognition не требует CSTal;
- engine branches параллелятся;
- cache metrics измеряются.

---

# 39. Definition of Done по первому релизу relational Pattern Layer

Считать rewrite готовым, когда выполняется всё:

```text
1. Есть fixed attacker context.
2. Есть PatternPositionContext.
3. Есть relevance filtering.
4. Есть real relation graph.
5. Есть минимум 5 точных family matchers.
6. Runtime сам retrieval'ит target families.
7. Lichess trajectories используются.
8. Есть real hard negatives.
9. Pattern benchmark работает отдельно от engines.
10. Move-level PatternProgress работает.
11. Patricia MultiPV подключена к candidate pool.
12. Maia one-step reply учитывается.
13. CSTal rollout идёт только для shortlisted candidates.
14. Forced mate отдельно подтверждается.
15. Pattern cache поддерживает transpositions.
16. Benchmark parallelism bounded.
```

---

# 40. Короткое ТЗ для coding agent

Не продолжать расширять текущий scorer новыми hardcoded weighted formulas.

Не добавлять новые families в `symbolic-v3`.

Сделать новый pipeline:

```text
fixed attacker side
↓
king-centric relational context
↓
relevance filtering
↓
structural candidate retrieval
↓
precise family matchers
↓
PatternProgress per candidate move
↓
Maia-conditioned reply evaluation
↓
candidate reranking
↓
CSTal continuation
↓
forced mate verification
↓
transposition-aware cache
```

472-case corpus использовать прежде всего для:

```text
offline recognizer/proximity benchmark
```

а не как:

```text
472 последовательных полных CSTal × Maia rollouts
```

---

# 41. Главный продуктовый критерий

Система должна отвечать не:

```text
"Какая из уже сыгранных линий больше похожа на Anastasia?"
```

а:

```text
"Какие матовые структуры доступны из этой позиции,
какой следующий ход реально приближает к ним,
какой ответ вероятен у человека заданного Elo,
и с какого момента комбинация превращается в объективно форсированный мат?"
```

Именно это должно стать смыслом Pattern Layer.
