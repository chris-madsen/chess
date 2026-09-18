# Delta Review: Pattern Layer после коммита `c685eda`

Repository: https://github.com/chris-madsen/chess/tree/master  
Reviewed HEAD: `c685eda0d6f044ab5f589edf47d8288484cb1655`  
Previous reviewed HEAD: `6920fb6edc3fa1f254f1cf0b1c2e4d977084fa61`  
Date: 2026-09-18

---

# 0. Короткий вывод

С прошлого ревью в `master` появился **ровно один новый коммит**:

```text
c685eda feat: implement iterative pattern steering batch
```

Но этот один коммит действительно крупный и закрывает несколько самых важных претензий прошлого ревью.

Теперь в коде появились:

```text
PatternSteeredTalPath
Tal tactical gate
per-family PatternProgress
targetFamily
Patricia + CSTal candidate composition
отдельный production steering CLI
remote steering batch mode
отдельное имя legacy post-hoc experiment
улучшенные recognizer metrics
```

То есть система уже значительно ближе к задуманной архитектуре:

```text
Patricia / CSTal candidates
        ↓
Tal tactical gate
        ↓
Pattern attractor progress
        ↓
Maia response
        ↓
commit
        ↓
repeat
```

Это **реальный прогресс**, а не косметический rename.

Но текущий HEAD всё ещё нельзя считать готовым Pattern MVP.

Главные оставшиеся проблемы:

1. **Production steering всё ещё устроен как hard-gated matcher, а не как continuous attractor field.** `prefilter == false` принудительно даёт pattern score `0`, поэтому система не умеет ценить ход, который только начинает вести к будущему матовому паттерну.
2. Даже после прохождения `prefilter` большинство matchers дают грубый квантизованный score из 4 boolean conditions (`0 / 0.25 / 0.5 / 0.75 / 1.0`), а не плавную оценку близости/потенциала.
3. Selection сейчас первично максимизирует `patternDelta`, а не ожидаемую конечную близость/вероятность attractor. Это может предпочесть `0.05→0.25` позиции `0.70→0.80`, хотя вторая намного ближе к реальному матовому basin.
4. 15 extended families формально присутствуют в taxonomy, но их `fallbackMatcher` всегда возвращает `0`; в production steering это фактически мёртвые attractors.
5. `searchmoves` у CSTal считается работающим по конфигурационному флагу, но код не доказывает, что CSTal действительно форсировал запрошенный candidate move.
6. Tactical gate использует абсолютный threshold `-150 cp`, а не сравнение кандидата с лучшим Tal move; это всё ещё может ухудшать Tal.
7. Candidate-pool starvation фактически остался: Patricia может заполнить весь final limit и вытеснить CSTal candidates.
8. Candidate tactical checks и Maia replies выполняются последовательно и могут сделать каждый attacker ply очень дорогим.
9. Checkmating candidate до Maia reply обрабатывается неправильно.
10. UCI sessions candidate generator / tactical gate в steering batch фактически не закрываются — возможна утечка CSTal процессов на каждом case.
11. Новый production steering пока не использует Pattern/Maia/rollout caches.
12. Матовые matchers всё ещё слишком общие; Pattern Layer местами всё ещё пытается строить generic tactical ontology вместо чистой Mate Geometry.
13. near-O(1) lookup пока не реализован.
14. Приложенный steering artifact вообще не дошёл до Pattern steering: **100/100 cases = `Incomplete`, 100/100 = `PROVIDER_UNAVAILABLE`, 0 plies; 96 падений на `cstal-absurd`, 4 на `cstal-extreme`, во всех случаях причина `UCI engine exited`.** Этот прогон нельзя использовать для оценки качества паттернов.
15. Held-out steering benchmark ещё не запущен успешно, а GitHub CI/status для текущего HEAD не найден.

---

# 1. Что он исправил после прошлого ревью

## FIXED — iterative Tal/Maia steering теперь реально существует

Новый файл:

```text
src/application/use-cases/pattern-steered-tal-path.ts
```

Это главное исправление.

Теперь attacker-side loop повторяется:

```text
attacker turn
↓
evaluatePatternSteeringCandidates()
↓
commit selected Tal-side move
↓
Maia response
↓
new position
↓
attacker turn
↓
снова steering
```

И тест:

```text
PatternSteeredTalPath repeats Tal-gated attacker plies around Maia plies
```

проверяет последовательность:

```text
LOCAL_STYLE_ENGINE
MAIA
LOCAL_STYLE_ENGINE
MAIA
LOCAL_STYLE_ENGINE
```

Это закрывает прошлый P0:

> после первого Pattern-selected move управление не должно переходить Stockfish.

**Статус:** закрыто в новой production path.

Legacy `runSteeredRollout()` через Stockfish всё ещё существует как старый API/benchmark helper, но `pattern:experiment` теперь указывает на новый steering CLI.

---

# 2. FIXED — появился Tal Tactical Gate

Добавлены:

```text
CandidateTacticalGate
TacticalCandidateAssessment
EngineScore
```

и:

```text
createUciTacticalGate()
```

В `evaluatePatternSteeringCandidates()` rejected candidate теперь удаляется **до Pattern ranking**:

```ts
if (!tacticalAssessment.accepted) continue;
```

Это правильная safety boundary:

```text
Tal veto
↓
Pattern Layer не имеет права вернуть rejected move
```

Также в `AGENTS.md` теперь явно записано:

> Pattern steering SHALL NOT override a CSTal/Tal tactical veto.

Это хорошее durable architectural invariant.

**Статус:** концептуально исправлено.

Но реализация gate ещё имеет критические проблемы — см. P0 ниже.

---

# 3. FIXED — PatternProgress теперь считается по одной family

Раньше было ошибочно:

```text
max(after)
-
max(before)
```

где maxima могли относиться к разным patterns.

Теперь появился:

```ts
familyProgress()
```

который для каждой family считает:

```text
beforeScore
afterCandidateScore
afterResponseScore
delta = afterResponseScore - beforeScore
```

и затем выбирает:

```text
targetFamily = argmax(delta)
```

Это соответствует нашей идее:

```text
pattern = attractor
```

**Статус:** исправлено.

---

# 4. FIXED — production steering CLI отделён от legacy post-hoc

`package.json` теперь:

```text
pattern:experiment
→ src/cli/pattern-steering.ts

pattern:legacy-posthoc
→ src/cli/pattern-experiment.ts
```

Это очень важное исправление naming и runtime semantics.

Теперь старый:

```text
ABSURD line
EXTREME line
↓
post-hoc ranking
```

явно отделён от production steering.

**Статус:** исправлено.

---

# 5. FIXED — CSTal candidates добавлены в новый Windows candidate source

Появился:

```ts
createWindowsCstalPatternCandidateGenerator()
```

Он объединяет:

```text
Patricia MultiPV
+
CSTal ABSURD bestmove
+
CSTal EXTREME bestmove
```

Это именно тот набор кирпичей, который мы обсуждали.

### Но

Final candidate composition всё ещё имеет starvation bug.

См. P0/P1 ниже.

---

# 6. FIXED — recognizer metrics заметно улучшены

В `pattern-recognizer.ts` исправлены несколько замечаний прошлого ревью.

Теперь:

```text
hard negatives
```

отделены от:

```text
controls
```

Появились:

```text
hardNegativeRejectionRate
controlFalsePositiveRate
```

Spearman ranks теперь обрабатывают ties через average rank.

Monotonicity теперь считается внутри trajectories, а не между случайными состояниями разных puzzles.

Появился calibration threshold:

```text
calibration split
→ выбрать threshold
→ evaluation split использует frozen threshold
```

**Статус:** большая часть прошлого metric-review закрыта.

---

# 7. PARTIALLY FIXED — canonical geometry стала богаче

В canonical key теперь добавлена:

```text
escape occupancy
attacker control
defender control
```

То есть canonicalization теперь хранит не только relative piece coordinates, но и king-zone geometry.

Это шаг в правильную сторону.

### Но остаётся

```text
rankSign ±1
```

и слишком грубая relevance logic.

См. ниже.

---

# 7A. P0 — production steering должен быть вероятностным/непрерывным attractor search, а не detector'ом готового паттерна

Это теперь **самая важная архитектурная поправка** к текущему Pattern Layer.

Текущий код не является strict exact-match detector в буквальном смысле, но его hard `prefilter` делает production steering слишком похожим именно на такой detector.

В `src/domain/patterns/matchers.ts` сейчас:

```ts
const result = matcher.prefilter(context)
  ? matcher.score(context)
  : {
      similarity: 0,
      evidence: [evidence("family prefilter rejected position", 0)],
      missingConditions: [`${family} structural prefilter is not satisfied`],
      contradictions: []
    };
```

То есть если hard prerequisite ещё не выполнен, family получает **ровно ноль**.

Примеры:

```text
ANASTASIA:
kingOnEdge
AND attacker has knight
AND attacker has rook/queen
```

```text
ARABIAN:
kingInCorner
AND attacker has knight
```

```text
BODEN:
attacker already has at least two relevant bishops
```

Это нормально для грубого **recognizer'а уже сформировавшейся позиции**.

Но это неправильно для **planner/steering**, потому что planner как раз должен уметь увидеть:

```text
сейчас king ещё НЕ on edge
↓
ход Tal вынуждает king двигаться к edge
↓
следующий вероятный ответ Maia делает Anastasia geometry заметно ближе
```

При нынешней семантике до момента `kingOnEdge == true`:

```text
Anastasia = 0
```

и planner слеп к самому процессу формирования паттерна.

## Главное правило

Production steering не должен задавать вопрос:

```text
"Этот pattern уже найден?"
```

Он должен задавать вопрос:

```text
"К какому mating attractor эта позиция ближе всего
и какой Tal-safe move увеличивает эту близость сильнее всего?"
```

---

# 7B. Нужны три разных понятия, а не один `similarity`

Сейчас detection, progress и planning слишком смешаны.

Нужно разделить:

## 1. PatternAffinity(s, p)

Непрерывная оценка:

```text
0.00 ... 1.00
```

насколько текущая **матовая геометрия** похожа/близка к family `p`.

Она должна существовать практически для любой позиции, даже если pattern ещё далеко.

Например:

```text
Anastasia  0.11
Pillsbury  0.18
Arabian    0.06
Boden      0.03
```

Это не утверждение, что мат уже есть.

## 2. PatternProgress(s -> s', p)

```text
Affinity(s', p) - Affinity(s, p)
```

Показывает, приблизил ли ход позицию к конкретному attractor.

## 3. PatternReachability(s, p, Elo)

Это будущая более сильная величина:

```text
насколько реально из позиции s прийти к basin pattern p
против вероятных ответов человека данного Elo
```

Для текущего MVP не нужно притворяться, что heuristic affinity уже является настоящей вероятностью reachability.

До появления калиброванной модели поле лучше называть:

```text
PatternAffinity
```

или:

```text
PatternPotential
```

а не `probability`.

---

# 7C. `prefilter` не должен иметь права обнулять steering score

`prefilter` можно оставить как **performance mechanism**, но не как semantic gate.

Неправильно:

```text
prefilter false
→ affinity = 0
→ family effectively does not exist
```

Правильно:

```text
cheap index / prefilter
→ family currently low-priority
→ scorer всё равно имеет soft estimate
```

или prefilter может означать только:

```text
"не запускай дорогой exact recognizer"
```

но не:

```text
"этот attractor невозможен и его score равен нулю"
```

Hard zero допустим только для действительно доказуемой невозможности в конкретном planning horizon, и это нужно моделировать отдельно. Например, отсутствие нужного материала само по себе ещё не всегда математически доказывает невозможность из-за promotions/transformations, поэтому на MVP безопаснее не использовать hard zero как steering semantics.

---

# 7D. Текущий score даже после prefilter слишком дискретный

Для большинства core matchers:

```ts
similarity = conditions.filter(Boolean).length / conditions.length
```

При четырёх условиях это всего пять значений:

```text
0.00
0.25
0.50
0.75
1.00
```

Это не continuous landscape.

Из-за этого два существенно разных состояния могут иметь одинаковые `0.50`, а небольшой полезный геометрический сдвиг вообще никак не изменит score.

## Что нужно вместо boolean counting

Для каждого family должны быть **soft mate-geometry components**, например для Anastasia:

```text
king-to-required-edge geometry       0..1
knight-role geometry                 0..1
heavy-piece corridor readiness       0..1
king confinement geometry            0..1
required escape coverage             0..1
```

Это не general chess evaluation.

Мы НЕ добавляем:

```text
+0.2 за pin
+0.1 за xray
```

Мы измеряем только **насколько конкретные role slots данного матового семейства сформированы**.

Например king ещё не на edge:

```text
3 клетки от edge → low affinity
2 клетки         → выше
1 клетка         → ещё выше
на edge          → высокий component
```

Точно так же knight не обязан уже стоять в финальном mating slot; можно оценивать относительную геометрическую близость к разрешённым role positions.

---

# 7E. Lichess trajectories должны стать основой soft proximity, а не только recognizer benchmark

У нас уже есть:

```text
s0 → s1 → s2 → ... → mate
```

для Lichess puzzles.

Это не означает, что puzzle solution — единственный путь.

Но это даёт реальные примеры того, как family выглядит:

```text
far
forming
near
mate basin
mate
```

Для каждого family можно строить несколько **trajectory prototypes / geometry prototypes**, а текущую позицию сравнивать не с одним exact terminal diagram, а с множеством стадий этого family.

То есть вместо:

```text
pattern == final arrangement
```

получаем:

```text
pattern family == manifold / basin / family of geometries
```

Это именно то, что нужно steering.

---

# 7F. Selection сейчас тоже оптимизирует не ту величину

Текущий `selectPatternSteeringCandidate()` сортирует прежде всего по:

```text
patternDelta
```

Это лучше старого `max(after)-max(before)`, но всё ещё может дать неверный выбор.

Пример:

```text
Candidate A:
Anastasia 0.70 → 0.80
Delta = +0.10

Candidate B:
Pillsbury 0.05 → 0.25
Delta = +0.20
```

Текущий selector предпочтет B из-за большего delta.

Но A уже находится намного ближе к сформированному mating basin.

## Для MVP правильнее

После Tal tactical gate основной steering signal должен учитывать **expected final affinity**, а progress использовать как дополнительный сигнал.

Например концептуально:

```text
SteeringValue(move, pattern)
=
ExpectedAffinityAfterMaia
+
λ * PatternProgress
```

где `λ` — небольшой параметр, а не попытка спорить с Tal по шахматной оценке.

Или для первого MVP даже проще:

```text
primary   = highest post-Maia affinity
secondary = highest positive delta
```

Главное — не выбирать исключительно по delta.

---

# 7G. Steering никогда не должен завершаться логикой «pattern not found»

После Tal veto у нас есть несколько шахматно приемлемых ходов.

Для каждого должен существовать лучший доступный attractor, даже если scores низкие:

```text
Nf5   → Anastasia 0.18
Rxf7  → Arabian   0.13
Qh5   → Pillsbury 0.21
Rg3   → Anastasia 0.17
```

Система НЕ должна говорить:

```text
none >= 0.65
→ nothing found
→ cannot steer
```

Она должна сказать:

```text
Qh5 has the strongest current mating-attractor potential
```

и продолжить цикл.

Если все moves уменьшают affinity:

```text
Nf5  -0.02
Rxf7 -0.08
Qh5  -0.01
Rg3  -0.04
```

то planner может выбрать:

```text
Qh5
```

как наименьшую потерю pattern potential **среди Tal-safe candidates**, либо fallback к Tal bestmove по safety policy.

Никакого `PROVIDER_UNAVAILABLE` или «паттерн не найден» из-за low Pattern score быть не должно.

---

# 7H. `far / promising / forming / near / mate_basin` — только labels, не control flow

Thresholds:

```text
0.25 promising
0.45 forming
0.65 near
0.82 mate_basin
```

могут быть полезны:

- в отчёте;
- UI;
- recognizer benchmark;
- debugging.

Но production steering не должен принимать решение так:

```text
state == far
→ игнорировать family
```

Позиция:

```text
Affinity = 0.17
state = far
```

и ход:

```text
0.17 → 0.34
```

может быть лучшим steering move во всей позиции.

---

# 7I. 15 extended patterns сейчас фактически не участвуют в attractor field

В `matcherMap` family без first-wave/core policy получает:

```ts
fallbackMatcher(family)
```

который всегда возвращает:

```text
similarity = 0
```

Следовательно extended families вроде:

```text
DAMIANO
GRECO
LOLLI
LEGAL
BLACKBURNE
...
```

формально есть в taxonomy, но для production steering они пока **мёртвые**.

Это нужно честно отражать в status/docs:

```text
34 taxonomy labels
19 active approximate attractors
15 catalog-only / not yet steerable
```

Пока у extended family нет soft affinity model, не надо делать вид, что planner реально работает со всеми 34.

---

# 7J. Maia: сегодня argmax, затем expected affinity

Сейчас Maia даёт один response.

Для MVP допустимо:

```text
move
↓
most likely Maia response
↓
post-response PatternAffinity
```

Но сама архитектура должна уже быть сформулирована как expectation.

Когда будет доступно top-k policy distribution:

```text
ExpectedAffinity(move, p)
=
Σ P_Maia(reply | position, move, Elo)
  * Affinity(position_after_reply, p)
```

Именно это соответствует цели:

> выбирать ход, который с наибольшей вероятностью ведёт человеческого соперника в нужный mating attractor.

В текущем MVP можно оставить один response, но API/терминология не должны закрывать путь к expected value.

---

# 7K. Обновлённая семантика Pattern Layer

Должно быть:

```text
Tal
= какие ходы шахматно приемлемы / атакующе интересны

PatternAffinity
= к каким mating attractors ведёт геометрия

Maia
= что вероятно сыграет человек

Steering
= среди Tal-safe moves выбрать move + attractor
  с максимальным expected mating-pattern potential
```

Pattern Layer по-прежнему НЕ оценивает общую шахматную силу хода.

Он только строит **непрерывное поле матовых attractors** поверх вариантов, которые Tal разрешил рассматривать.

---

# 7L. Новый обязательный acceptance test для steering semantics

Добавить synthetic contract tests.

## Test 1 — family below all display thresholds still steers

```text
before Anastasia = 0.08
candidate A post-Maia = 0.19
candidate B post-Maia = 0.11
```

Expected:

```text
A selected for stronger attractor affinity
```

Несмотря на то, что обе позиции остаются `far`.

## Test 2 — prefilter-like missing condition does not force zero

Король ещё не на edge, но candidate приближает его к edge geometry.

Expected:

```text
Anastasia affinity > 0
and increases after candidate
```

## Test 3 — final affinity outranks raw delta when appropriate

```text
A: 0.70 → 0.80  delta +0.10
B: 0.05 → 0.25  delta +0.20
```

Expected under MVP policy:

```text
A wins unless a configured steering policy explicitly says otherwise
```

## Test 4 — all deltas negative

Planner still returns one Tal-safe candidate; it does not fail with "pattern not found".

## Test 5 — no implemented family has strong score

Fallback:

```text
Tal best / safest accepted move
```

not provider failure.

---

# 8. P0 — `searchmoves` не верифицируется фактически

Это сейчас самый опасный новый баг.

Файл:

```text
src/adapters/uci/uci-engine-adapter.ts
```

Tactical gate отправляет:

```text
go ... searchmoves <candidate>
```

Но `supportsSearchMoves` задаётся так:

```ts
...(key.startsWith("cstal-") ? { supportsSearchMoves: true } : {})
```

То есть:

> CSTal считается поддерживающим `searchmoves` просто потому, что его key начинается с `cstal-`.

Никакого runtime proof нет.

## Почему это критично

Если CSTal:

```text
не поддерживает searchmoves
или
игнорирует его
```

он может посчитать свой обычный bestmove.

Тогда gate получит хороший score и ошибочно скажет:

```text
candidate accepted
```

хотя score относится **не к candidate**.

Это ломает главный invariant:

```text
Tal tactical veto
```

## Что обязательно проверить

После:

```text
go searchmoves Rxf7 ...
```

gate должен требовать:

```text
bestmove == Rxf7
```

И желательно:

```text
PV first move == Rxf7
```

Если нет:

```text
SEARCHMOVES_NOT_HONORED
```

и candidate нельзя считать оценённым.

## Acceptance test

Mock UCI engine:

```text
request:
go searchmoves e2e4 depth 14

engine returns:
bestmove d2d4
```

Expected:

```text
candidate e2e4 NOT assessed
hard error / unsupported searchmoves
```

Не `accepted`.

---

# 9. P0 — CSTal `searchmoves` support нужно реально smoke-test'ить на binary

В прошлых обсуждениях мы специально не утверждали, что CSTal2 binary точно поддерживает `searchmoves`.

Текущий код это просто объявил:

```text
supportsSearchMoves: true
```

Этого недостаточно.

## Нужно

Добавить в:

```text
verify:cstal-windows
```

реальный probe:

```text
position ...
go searchmoves <non-best legal move> depth N
```

и проверить:

```text
bestmove == forced move
PV root == forced move
```

Только после этого capability можно считать подтверждённой.

Лучше capability хранить как verified runtime fact:

```text
SearchMovesCapability = VERIFIED | UNSUPPORTED | UNKNOWN
```

а не boolean в config.

---

# 10. P0 — Tactical Gate всё ещё может ухудшать Tal из-за абсолютного `-150 cp`

Default:

```ts
policy = { minCentipawns: -150 }
```

Это не то же самое, что:

> не ухудшать Tal.

Пример:

```text
Tal best = +4.20
candidate = -1.40
```

Текущий gate:

```text
-140 >= -150
→ accepted
```

Хотя candidate потерял:

```text
5.6 pawns of evaluation
```

относительно собственного лучшего Tal move.

Pattern Layer после этого вполне может выбрать его.

Это противоречит нашей цели.

## Правильная логика

Gate должен сравнивать candidate с Tal baseline.

Например:

```text
Tal best score = Sbest
candidate forced score = Scandidate
loss = Sbest - Scandidate
```

Accept если:

```text
loss <= allowedTalLoss
```

с отдельными правилами для mate scores.

## Лучше использовать safety classes

Например:

```text
FORCED_WIN
CLEARLY_WINNING
SAFE_ATTACK
ROUGHLY_EQUAL
WORSE
LOSING
```

Pattern steering разрешено выбирать только внутри допустимого class.

Особенно:

```text
forced mate for Tal
```

нельзя менять на non-forced line только ради pattern score.

---

# 11. P0 — если позиция уже плохая, gate может отвергнуть вообще всё

При absolute threshold:

```text
minCentipawns = -150
```

позиция может быть объективно:

```text
-3.0
```

и все legal candidates окажутся:

```text
< -150
```

Тогда Pattern steering вернёт:

```text
No legal candidate survived
```

Хотя Tal обязан всё равно выбрать лучший практический шанс.

## Правильный fallback

Всегда должен выжить хотя бы:

```text
Tal own bestmove
```

или best-scoring candidate according to Tal.

Pattern Layer не должен превращать "позиция плохая" в "нет хода".

---

# 12. P0 — candidate pool starvation фактически НЕ исправлен

Это важный момент.

Теперь composer действительно опрашивает все sources:

```ts
for (const source of sources) { ... }
```

Но в конце:

```ts
return ok(candidates.slice(0, request.limit));
```

А Windows wiring передаёт:

```text
Patricia budget = candidateLimit
CSTal ABSURD = 1
CSTal EXTREME = 1
```

При:

```text
candidateLimit = 8
```

Patricia может вернуть 8 уникальных ходов первой.

Тогда итоговый массив:

```text
[Patricia1..Patricia8, TalAbsurd, TalExtreme]
```

после:

```text
slice(0,8)
```

становится:

```text
только Patricia1..Patricia8
```

CSTal candidates снова выброшены.

То есть прошлый starvation bug **сохранился**, только переместился.

## Как исправить

Нужна mandatory source reservation.

Например:

```text
CSTal ABSURD own move  = mandatory 1
CSTal EXTREME own move = mandatory 1
Patricia MultiPV       = fill remaining 6
```

или round-robin merge, но Tal own moves должны быть guaranteed.

Лучше:

```text
mandatoryCandidates
+
explorationCandidates
↓
dedupe
↓
trim exploration only
```

Нельзя делать simple append + global slice.

---

# 13. P0 — checkmating candidate вызывает Maia там, где Maia ходить уже не может

В:

```ts
evaluatePatternSteeringCandidates()
```

после candidate move вычисляется `afterFacts`, но код НЕ проверяет:

```text
afterFacts.isTerminal
```

до вызова Maia.

То есть если Tal candidate:

```text
Qh7#
```

и horizon ещё имеет defender ply, код делает:

```text
Maia(position after Qh7#)
```

На terminal position.

Это может вернуть provider error именно на лучшем possible result.

## Как исправить

После candidate:

```text
if terminal:
    no Maia call
    postResponsePosition = afterPosition
    postResponseFamilies = afterFamilies
    terminalAfterCandidate = true
```

И candidate должен участвовать в selection нормально.

---

# 14. P0 — `PatternSteeredTalPath` неправильно завершает line при отсутствии response

В path:

```ts
if (selected.responseMove === undefined ...) break;
```

После break функция в конце возвращает:

```text
status = Complete
```

Но отсутствие response может означать attacker checkmate.

Нужно после committed attacker move заново проверить facts.

Если terminal — вернуть:

```text
Terminal
```

а не `Complete`.

---

# 15. P0 — steering batch течёт UCI-процессами

Это серьёзный lifecycle bug.

Server `createPatternSteering()` создаёт:

```text
generator
tacticalGate
maia
```

Но dispose делает только:

```text
providers.styleEngines[].provideMove.dispose()
providers.maia.dispose()
```

Причём эти `providers.styleEngines` — из отдельного вызова `createWindowsCstalStylePathProviders()`.

Они НЕ являются UCI sessions, которые реально используются внутри:

```text
createWindowsCstalPatternCandidateGenerator()
createWindowsCstalTacticalGate()
```

## То есть

На каждом steering case могут оставаться живыми:

```text
CSTal ABSURD candidate session
CSTal EXTREME candidate session
CSTal tactical-gate session
Patricia session, если используется
```

Remote batch на 100 cases может постепенно накопить огромное количество процессов.

## Почему тесты этого не ловят

Tests подставляют fake:

```text
dispose: () => undefined
```

и не проверяют реальный UCI lifecycle.

## Как исправить

Типы должны владеть lifecycle явно.

Например:

```ts
type DisposableCandidateGenerator = CandidateGenerator & {
  dispose(): void;
}

type DisposableTacticalGate = CandidateTacticalGate & {
  dispose(): void;
}
```

А `PatternSteeringProviders.dispose()` должен закрывать:

```text
generator
tacticalGate
maia
```

И обязательно через `try/finally`.

---

# 16. P0/P1 — local steering CLI имеет ту же lifecycle leak

В local `pattern-steering.ts` на каждый case создаются:

```text
candidate generator
tactical gate
Maia providers
```

После case закрывается `providers.maia/providers.styleEngines`, но generator/tacticalGate не закрываются.

Для `--subset 100` это может стать тяжёлой утечкой процессов и памяти.

---

# 17. P1 — tactical gate оценивает candidates строго последовательно

В:

```ts
for (const seed of request.candidates)
```

каждый candidate запускает отдельный:

```text
CSTal depth 14 searchmoves
```

последовательно.

Если candidates = 8:

```text
8 full Tal searches
```

на **каждом attacker ply**.

Потом Pattern steering отдельно последовательно вызывает Maia для каждого accepted candidate.

## Возможная реальная стоимость одного attacker ply

```text
8 × Tal search
+
Naccepted × Maia 4 sec
+
Pattern matching
```

Pattern matching здесь вообще не bottleneck.

## Что делать

Сохранить safety boundary, но изменить pipeline:

```text
mandatory Tal own moves
+
Patricia exploration
↓
cheap MateGeometry prefilter
↓
small exploration shortlist
+
mandatory Tal moves
↓
Tal tactical gate
↓
accepted shortlist
↓
Maia
```

Pattern Layer можно использовать как дешёвый retrieval filter **до дорогого Tal gate**, но Tal own bestmoves всегда сохраняются, а final selection всё равно невозможен без Tal acceptance.

---

# 18. P1 — Maia replies тоже идут последовательно

В `evaluatePatternSteeringCandidates()`:

```ts
for candidate:
    await maia(...)
```

Maia3 уже config'ится с MultiPV 5, но steering использует только один move и отдельный request на candidate.

## MVP

Можно оставить argmax reply.

## Для performance

Нужно хотя бы:

```text
shortlist before Maia
```

## Позже

Лучше batch Maia inference для нескольких after-candidate positions.

---

# 19. P1 — Tal gate использует только CSTal ABSURD

`createWindowsCstalTacticalGate()` всегда создаёт:

```text
cstal-absurd
```

То есть candidate от CSTal EXTREME тоже судится ABSURD mode.

Это не обязательно неправильно, но решение сейчас не обосновано.

## Риск

EXTREME может считать свой жертвенный move хорошим, а ABSURD gate его reject'нет.

## Нужно определить policy явно

Варианты:

### A. ABSURD = единый safety judge

Тогда это сознательное product decision и benchmark.

### B. Candidate accepted своим Tal mode

```text
ABSURD candidate → ABSURD gate
EXTREME candidate → EXTREME gate
Patricia candidate → both modes / selected main mode
```

### C. Ensemble veto

```text
accept if at least one Tal mode rates it within safety band
```

Для этого проекта B или C выглядят естественнее, потому что ABSURD и EXTREME дают разные стили.

---

# 20. P1 — score parser игнорирует UCI score bounds

Parser не учитывает:

```text
lowerbound
upperbound
```

Если last observed score является bound, gate может принять его как exact score.

## Исправить

Возвращать:

```ts
{
  kind,
  value,
  bound: "exact" | "lower" | "upper"
}
```

и safety gate должен работать conservatively.

---

# 21. P1 — candidate gate не проверяет root PV candidate

Даже если `bestmove` совпал, полезно проверять:

```text
PV[0] == requested searchmove
```

Сейчас `talPv` собирается, но root consistency не проверяется.

Это должно быть contract assertion.

---

# 22. P1 — production steering всё ещё не использует cache

В новом runtime path нет реального:

```text
PatternContext cache
PatternAssessment cache
MaiaResponse cache
EngineMove cache
RolloutSuffix cache
```

Хотя cache namespaces уже существуют.

Это особенно болезненно теперь, когда steering повторяется на каждом attacker ply и по нескольким candidates.

## Минимальный приоритет

1. `PATTERN_CONTEXT`
2. `PATTERN_ASSESSMENT`
3. `MAIA_RESPONSE`
4. Tal `searchmoves` result
5. `ROLLOUT_SUFFIX`

Транспозиции между candidate lines должны реально reuse'иться.

---

# 23. P1 — no single-flight / in-flight de-duplication

При remote concurrency два workers могут одновременно попросить один и тот же:

```text
position + engine config
```

Если shared cache появится без single-flight, оба всё равно посчитают expensive search.

Нужен claim/lease/in-flight promise на cache key.

---

# 24. P1 — matchers всё ещё слишком общие

Новый коммит почти не исправлял `matchers.ts`.

Поэтому прошлый semantic review остаётся актуальным.

Примеры:

```text
ANASTASIA
= edge king
+ any knight escape control
+ any heavy line
+ blocked escapes
```

Это не точная Anastasia geometry.

`BODEN crossing` по-прежнему слишком грубый.

`HOOK` и `VUKOVIC` всё ещё почти неразличимы.

## Что делать

Не расширять generic heuristics.

Нужен:

```text
MateGeometryDescriptor
```

с family-specific roles и relative geometry.

Pattern Layer не должен становиться generic tactical engine.

---

# 25. P1 — generic tactical relation ontology всё ещё лишняя

`context.ts` по-прежнему имеет:

```text
ATTACKS
DEFENDS
BLOCKS
PINS
XRAYS
CAN_CAPTURE
CAN_INTERPOSE
CAN_REACH_IN_1
CAN_REACH_IN_2
...
```

но большая часть не реализована.

Это архитектурно опасно: coding agent легко начнёт "допиливать" второй шахматный движок.

## Правило надо сделать жёстче

Оставлять только predicates, которые нужны конкретной mate geometry.

Не:

```text
pin is good
xray is good
```

а:

```text
this exact square must be covered
this exact blocker must exist
this role piece must occupy/attack this relative slot
```

---

# 26. P1 — canonicalization всё ещё имеет unsafe rank mirror

Canonicalization всё ещё перебирает:

```text
fileSign ±1
rankSign ±1
```

Хотя теперь escape geometry тоже нормализуется.

Rank mirror может ломать semantics:

```text
pawn direction
home rank
promotion direction
```

## Лучше

Нормализовать через legal chess symmetries:

```text
file mirror
color swap + 180° rotation
```

а family-specific extra symmetry разрешать явно.

---

# 27. P1 — relevance filter всё ещё основан на arbitrary radius

Attacking N/B/R/Q попадают в relevant set при distance <= 3.

Это не "mate relevance", а heuristic radius.

Можно потерять дальнюю rook/queen, которая является будущей mating role, или включить ненужную фигуру около king.

Нужен role-based relevance, не generic distance.

---

# 28. P1 — near-O(1) retrieval пока отсутствует

Runtime всё ещё:

```ts
PATTERN_FAMILY_IDS
.map(...)
.sort(...)
```

на всех 34 families.

Для 34 это дешёво, но architecture near-O(1) пока не сделана.

После исправления semantic matchers:

```text
L0 cache
↓
L1 MateGeometrySignature
↓
uint64 candidate-family bitmap
↓
2–5 exact family matchers
```

34 families идеально помещаются в один `uint64`.

---

# 29. P1 — remote steering не имеет общего per-case timeout/cancellation

Post-hoc jobs имеют timeout/abort lifecycle.

Steering branch в `runBatch()` напрямую делает:

```text
await generatePatternSteeredTalPath(...)
```

и не оборачивает весь case в общий timeout/AbortController.

Отдельный UCI call имеет timeout, но общий path может быть очень длинным.

Нужно:

```text
caseTimeout
abort signal
finally dispose
```

для steering branch.

---

# 30. P1 — current steering artifact не содержит достаточно диагностических данных

CLI пишет в основном line.

Но для отладки steering нужны per-attacker-ply decisions:

```text
candidate pool
Tal gate score/veto
targetFamily
beforeScore
afterCandidateScore
afterMaiaScore
patternDelta
selected move
Maia reply
```

Иначе held-out steering benchmark почти невозможно нормально анализировать.

Нужно добавить:

```text
PatternSteeringDecisionTrace[]
```

к artifact.

---

# 30A. Фактический разбор приложенного steering artifact

Файл:

```text
pattern-steering-1789740390395.jsonl
```

содержит 100 selected cases.

Фактический итог:

```text
cases                     = 100
Incomplete                = 100
PROVIDER_UNAVAILABLE      = 100
non-zero ply lines        = 0
played plies total        = 0
```

Разбивка provider failure:

```text
cstal-absurd  = 96
cstal-extreme = 4
```

Причина во всех 100 случаях:

```text
UCI engine exited
```

## Вывод

Этот artifact **не измеряет качество PatternAffinity, recognizer или steering**.

Pipeline падает до первого сыгранного ply.

Поэтому нельзя делать вывод:

```text
"паттерны не работают"
```

или:

```text
"steering ухудшает Tal"
```

на основании этого run.

Сначала надо исправить CSTal lifecycle/searchmoves/provider stability и получить хотя бы валидный steering artifact с ненулевыми plies.

## Отдельно важно

После infrastructure fix следующий benchmark должен логировать Pattern decisions. Иначе даже успешная line не покажет, почему был выбран конкретный ход.

Минимум per attacker ply:

```text
candidate
Tal acceptance / score
selected targetFamily
before affinity
after candidate affinity
after Maia affinity
pattern delta
final steering value
selected move
Maia reply
```

---

# 31. P1 — held-out steering report всё ещё не выполнен

`tasks.md`:

```text
[ ] Run held-out steering report ...
```

Это правильно оставлено незакрытым.

До исправления P0 выше запускать финальный benchmark рано.

Сначала:

```text
searchmoves verification
relative Tal safety
candidate pool reservation
terminal handling
lifecycle disposal
```

потом benchmark.

---

# 32. P1 — GitHub CI/status для HEAD не найден

Для:

```text
c685eda...
```

GitHub connector не вернул commit statuses или workflow runs.

Поэтому нельзя считать `npm run gate` подтверждённым только по наличию tests в repo.

Нужен реальный локальный/CI run artifact.

---

# 33. Что теперь считать закрытым из прошлого ревью

Можно закрыть:

```text
✓ iterative Tal attacker path
✓ Tal veto interface
✓ Pattern steering before commitment
✓ per-family PatternProgress
✓ targetFamily
✓ legacy CLI separation
✓ remote steering mode
✓ controls vs hard-negative metric split
✓ per-trajectory monotonicity
✓ tie-aware Spearman
✓ calibrated threshold
✓ canonical escape geometry added
```

---

# 34. Что остаётся обязательным до MVP steering benchmark

## P0 MUST FIX

```text
1. Replace hard-zero matcher semantics in production steering with continuous PatternAffinity / PatternPotential.
2. Remove `prefilter -> similarity 0` as a steering decision rule.
3. Make display states (`far/near/...`) descriptive only; never use them as "pattern found / not found" gates.
4. Change move selection from raw max PatternDelta to a policy centered on post-Maia attractor affinity / expected affinity, with progress as a secondary signal.
5. Guarantee steering always returns a Tal-safe move even when all pattern affinities are low or all deltas are negative.
6. Mark the 15 extended families honestly as non-steerable until they have real soft affinity implementations.
7. Verify CSTal searchmoves actually forces requested move.
8. Compare candidate to Tal baseline, not absolute -150 only.
9. Guarantee at least Tal own bestmove survives.
10. Fix Patricia starving CSTal own candidates.
11. Handle terminal candidate before Maia.
12. Return Terminal status correctly.
13. Dispose candidate-generator and tactical-gate UCI sessions.
14. Fix CSTal provider stability: current artifact has 100/100 `UCI engine exited` before ply 1.
```

Только после этого новый steering path можно считать корректным enough для held-out experiment.

---

# 35. Следующий P1 block

После P0:

```text
8. Decide ABSURD-vs-EXTREME tactical gate policy.
9. Shortlist before expensive Tal/Maia calls.
10. Add Maia batching/top-k later.
11. Wire caches + suffix memoization.
12. Add single-flight cache dedup.
13. Add steering decision traces.
14. Add per-case timeout/abort.
15. Replace generic matchers with real MateGeometry for first 5 families.
16. Fix canonical symmetry/relevance.
17. Add uint64 family gating near-O(1).
```

---

# 36. Рекомендуемый следующий pipeline

```text
POSITION
   ↓
mandatory CSTal own candidates
   +
Patricia exploration candidates
   ↓
dedupe
   ↓
cheap MateGeometry / soft-attractor retrieval
   ↓
exploration shortlist
   +
mandatory Tal candidates
   ↓
Tal searchmoves gate
   ↓
relative-to-Tal-best safety filtering
   ↓
for every surviving move and every relevant family:
    PatternAffinity(before, family)
    PatternAffinity(afterCandidate, family)
   ↓
Maia likely reply
   ↓
PatternAffinity(afterMaia, family)
   ↓
SteeringValue = post-Maia affinity + λ * progress
   ↓
choose best (move, targetFamily) pair
   ↓
commit attacker move
   ↓
Maia move
   ↓
repeat
```

Критический invariant:

```text
нет порога "pattern found", необходимого для продолжения steering.
Пороговые states используются только как labels/reporting.
```

---

# 37. Recommended tactical safety policy

Не использовать один:

```text
score >= -150
```

Вместо этого:

```text
Tal root best score = B
candidate score = C
```

Rules:

```text
if Tal has forced mate:
    only preserve forced mate class unless explicit research mode

if candidate is mate against Tal:
    reject

if both cp:
    accept only if B - C <= allowedLoss
```

Можно начать с conservative:

```text
allowedLoss = 50–100 cp
```

и calibrate later.

Но это policy parameter, не magic constant в Pattern Layer.

---

# 38. Recommended candidate reservation

Например при final limit 10:

```text
1 CSTal ABSURD own move   mandatory
1 CSTal EXTREME own move  mandatory
8 Patricia MultiPV        exploration
```

При final limit 8:

```text
2 Tal mandatory
6 Patricia
```

Optional later:

```text
+ Seer
+ Jakal
```

но mandatory Tal slots нельзя вытеснять.

---

# 39. Recommended process ownership

Создать единый resource bundle:

```ts
type PatternSteeringRuntime = {
  generator: DisposableCandidateGenerator;
  tacticalGate: DisposableTacticalGate;
  maia: DisposableMoveProvider;
  dispose(): void;
};
```

Использование:

```ts
const runtime = create...
try {
   await generatePatternSteeredTalPath(...)
} finally {
   runtime.dispose()
}
```

Это нужно и local CLI, и remote batch.

---

# 40. Recommended terminal contract

После каждого committed move:

```text
apply
↓
computeFacts
↓
if terminal:
    stop immediately
```

Ни один provider не должен вызываться из terminal position.

Regression tests:

```text
attacker mates on candidate move
defender mates
stalemate
horizon ends on attacker ply
horizon ends on defender ply
```

---

# 41. Recommended steering artifact

На каждом attacker ply хранить примерно:

```json
{
  "positionHash": "...",
  "candidates": [
    {
      "uci": "Rxf7",
      "source": "Patricia",
      "talAccepted": true,
      "talScore": {"kind":"centipawns","value":120},
      "targetFamily": "ANASTASIA",
      "beforeScore": 0.42,
      "afterCandidateScore": 0.64,
      "afterMaiaScore": 0.73,
      "patternDelta": 0.31
    }
  ],
  "selected": "Rxf7",
  "maiaReply": "..."
}
```

Без этого мы не поймём, почему steering выигрывает или проигрывает.

---

# 42. После correctness — near-O(1)

Не оптимизировать generic matcher.

Когда MateGeometry correct:

```text
Position hash
↓
cache hit? → return
↓
MateGeometrySignature
↓
uint64 pattern candidate mask
↓
2–5 family exact checks
```

Это практически бесплатный слой на фоне Tal и Maia.

Главная performance проблема сейчас — не 34 Pattern checks.

Главная performance проблема:

```text
N × CSTal searchmoves
+
N × Maia calls
```

Именно туда сначала надо бить.

---

# 43. Definition of Done для следующего delta

Следующий коммит можно считать хорошим завершением current MVP foundation, если:

```text
[ ] production steering uses continuous PatternAffinity, not hard "found/not found" matching
[ ] `prefilter == false` does not automatically mean affinity 0
[ ] low-affinity `far` families can still produce useful positive progress and be selected
[ ] selection considers post-Maia affinity / expected affinity, not raw delta alone
[ ] all-low/all-negative Pattern cases still return a Tal-safe move
[ ] taxonomy clearly distinguishes active steerable families from catalog-only families
[ ] searchmoves root move verified
[ ] real CSTal binary smoke test exists
[ ] Tal safety relative to root best
[ ] no all-candidates-rejected failure
[ ] CSTal own moves guaranteed in candidate pool
[ ] terminal candidate never calls Maia
[ ] Terminal status correct
[ ] all UCI sessions disposed
[ ] CSTal no longer exits on every steering case
[ ] steering case has timeout/abort
[ ] decision trace persists target family + affinity/progress values
[ ] npm run gate actually executed
[ ] valid held-out steering benchmark with non-zero plies then run
```

---

# 44. Что НЕ надо делать ещё

Пока не надо:

```text
fine-tune CSTal
train Pattern Head
train V(s,p,e)
add thousands of deadly clusters
add HNSW/FAISS
rewrite chess tactics in Pattern Layer
add generic pin/xray bonuses
```

Сначала нужно получить **корректный, быстрый и измеримый Tal-guided steering loop**.

---

# 45. Финальная архитектурная граница

Система должна оставаться такой:

```text
Patricia
→ breadth

CSTal
→ chess quality + tactical creativity + veto

Pattern Layer
→ mate attractor direction only

Maia
→ likely human response

Mate verifier
→ objective proof

Cache
→ avoid repeated work
```

Pattern Layer никогда не должен становиться:

```text
маленьким плохим шахматным движком рядом с Tal
```

Его задача гораздо уже и полезнее:

> **среди тактически приемлемых для Tal дверей выбрать ту, которая сильнее ведёт к интересной матовой геометрии против вероятных человеческих ответов.**
\n---\n\n# 46. Обновлённый приоритет следующих коммитов\n\n## Commit 1 — `fix: make pattern steering continuous instead of hard-gated`\n\n- убрать semantic `prefilter -> 0` из production steering;\n- ввести `PatternAffinity`;\n- оставить thresholds только для labels;\n- добавить tests для low-affinity steering.\n\n## Commit 2 — `fix: rank by attractor affinity, not raw delta only`\n\n- хранить `targetFamily`;\n- primary: post-Maia affinity / expected affinity;\n- secondary: progress;\n- all-negative fallback к лучшему Tal-safe move.\n\n## Commit 3 — `fix: verify CSTal searchmoves and relative tactical safety`\n\n- real binary smoke test;\n- `bestmove == requested candidate`;\n- Tal baseline comparison;\n- guaranteed Tal best fallback.\n\n## Commit 4 — `fix: reserve CSTal candidates and own UCI lifecycle`\n\n- mandatory ABSURD/EXTREME slots;\n- Patricia fills exploration slots;\n- dispose generator/gate sessions in `finally`.\n\n## Commit 5 — `fix: terminal steering semantics`\n\n- candidate mate stops before Maia;\n- correct `Terminal` status;\n- regression tests.\n\n## Commit 6 — `fix: stabilize steering runtime before benchmark`\n\n- устранить `UCI engine exited`;\n- case timeout/abort;\n- decision trace;\n- real `npm run gate`.\n\n## Commit 7 — `refactor: replace boolean family matchers with soft MateGeometry affinity`\n\nСначала 5 семейств:\n\n```text\nANASTASIA\nARABIAN\nBACK_RANK\nBODEN\nSMOTHERED\n```\n\nЗатем остальные Lichess core.\n\n## Commit 8 — `perf: cache affinity and add uint64 family gating`\n\nТолько после корректной semantics.\n\n---\n\n# 47. Итоговая продуктовая формулировка\n\nPattern Layer не должен ждать, пока матовый паттерн уже почти собран.\n\nОн должен постоянно строить landscape:\n\n```text\nпозиция\n→ какие mating attractors сейчас ближе\n→ какой Tal-safe move повышает их affinity\n→ какой вероятный Maia response повышает/понижает affinity\n→ какой move + family pair имеет максимальный expected mating-pattern potential\n```\n\nТо есть задача не:\n\n```text\n"найти 100% совпадение с известным матовым рисунком"\n```\n\nа:\n\n```text\n"вести Tal по наиболее перспективному градиенту матовой геометрии,\nне разрешая Pattern Layer спорить с Tal о шахматной корректности".\n```\n