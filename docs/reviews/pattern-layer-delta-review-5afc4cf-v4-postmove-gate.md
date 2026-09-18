# Pattern Layer — Delta Review + CSTal `searchmoves` fallback

Repository: https://github.com/chris-madsen/chess/tree/master  
Current reviewed HEAD: `5afc4cfcea71505c9397a09e331aec182b80e6a8`  
Previous reviewed HEAD: `b7bc2bd821b7989a61e1346f16f032ae54c1e9a7`  
Новый коммит после прошлого ревью:

```text
5afc4cf fix: preserve remote steering provider errors
```

Дата ревью: 2026-09-18

---

# КРИТИЧЕСКОЕ ДОПОЛНЕНИЕ: CSTal НЕ поддерживает `searchmoves`

Фактическая проверка на реальных Windows binaries дала:

```text
fail: CSTal ABSURD bestmove=d2d4; requested=e2e4
fail: CSTal EXTREME bestmove=d2d4; requested=e2e4
ok: Maia3 79M e2e4
ok: Maia 1900 g2g3
```

Это означает не "CSTal плохой" и не "Pattern steering невозможен".

Это означает конкретно:

> CSTal 2.07 ABSURD/EXTREME в используемой сборке игнорирует UCI `searchmoves`.

Следовательно текущий `createUciTacticalGate()` нельзя использовать как CSTal gate, потому что он требует:

```text
go ... searchmoves <candidate>
```

и правильно fail-closed проверяет:

```text
bestmove == requested candidate
PV[0] == requested candidate
```

На реальном CSTal эта проверка закономерно падает.

## Это НЕ повод откатываться на legacy post-hoc

Legacy:

```text
сначала построить готовую ABSURD line
сначала построить готовую EXTREME line
↓
потом выбрать красивую
```

можно оставить только как historical baseline.

Правильное решение — заменить способ tactical gating, а не сам steering architecture.

---

# P0 — убрать ложную декларацию `supportsSearchMoves: true`

Сейчас `styleConfig()` делает:

```ts
...(key.startsWith("cstal-")
  ? { supportsSearchMoves: true }
  : {})
```

После реального smoke-test это утверждение доказанно неверно.

Нужно:

```text
CSTal ABSURD:
searchmoves = UNSUPPORTED

CSTal EXTREME:
searchmoves = UNSUPPORTED
```

Не надо оставлять boolean `true` и надеяться на runtime error.

Лучше capability model:

```ts
type SearchMovesCapability =
  | "VERIFIED"
  | "UNSUPPORTED"
  | "UNKNOWN";
```

Для текущих binaries:

```text
UNSUPPORTED
```

---

# P0 — лучший обход: POST-MOVE TAL GATE

## Идея

Если CSTal нельзя заставить анализировать конкретный root move через:

```text
searchmoves Rxf7
```

мы сами легально применяем:

```text
Rxf7
```

через `ChessRulesPort`.

Получаем:

```text
S
↓ Rxf7
S'
```

И уже `S'` отправляем CSTal как обычную позицию:

```text
position <S'>
go depth 14
```

Candidate уже произошёл.

CSTal физически не может заменить:

```text
Rxf7
```

на:

```text
Nf5
```

Потому что root position для его поиска уже находится ПОСЛЕ `Rxf7`.

Это надёжнее попытки эмулировать unsupported UCI command.

---

# Почему это сохраняет нашу архитектуру

После candidate move ход принадлежит defender.

CSTal здесь используется не как human opponent model, а как:

```text
TACTICAL SAFETY JUDGE
```

Он ищет сильное опровержение candidate.

После того как candidate признан safe:

```text
Maia(Elo)
```

отдельно отвечает:

> что вероятнее всего сыграет человек?

То есть ответственности остаются чистыми:

```text
CSTal post-move analysis
= tactical safety / refutation pressure

Maia
= likely human response

Pattern Layer
= mating-attractor direction
```

Pattern Layer всё ещё не оценивает шахматную корректность.

---

# Как должен работать PostMoveTalGate

Для позиции:

```text
S
```

есть candidate pool:

```text
CSTal ABSURD own move
CSTal EXTREME own move
Patricia MultiPV candidates
```

Для каждого candidate `m`:

```text
S_m = applyMove(S, m)
```

Если `S_m` terminal:

```text
attacker checkmated defender
→ winning terminal candidate

draw/stalemate
→ draw class
```

Если позиция не terminal:

```text
CSTal ABSURD evaluates S_m
```

Все candidates оцениваются одинаковым способом и одинаковым budget.

Это важно: мы получаем apples-to-apples comparison.

---

# Очень важный момент: score perspective

После candidate:

```text
attacker сделал ход
↓
defender to move
```

UCI score обычно относится к side-to-move, но для старого CSTal это НЕЛЬЗЯ молча предполагать.

Нужно один раз проверить реальный score convention на известных asymmetric positions.

После верификации adapter должен нормализовать любой score к:

```text
ATTACKER PERSPECTIVE
```

Например если CSTal после нашего хода сообщает с точки зрения defender:

```text
score cp -180
```

то normalized attacker score:

```text
+180 cp
```

Если:

```text
score mate -3
```

с точки зрения defender,

то это должно стать:

```text
attacker has winning mate class
```

Нужен explicit helper:

```ts
normalizeScoreToAttacker(
  rawScore,
  scorePerspective,
  sideToMove,
  attackerSide
)
```

Не размазывать sign inversion по gate code.

---

# Нужно верифицировать score perspective CSTal отдельно

Добавить в `verify:cstal-windows` не только bestmove test, но и score-semantics test.

Нужны позиции с очевидной asymmetric evaluation:

```text
known winning position for side A
known losing / mating position
```

Проверить:

```text
sign
mate sign
PV legality
```

После этого config должен иметь явную семантику:

```ts
scorePerspective: "SIDE_TO_MOVE"
```

или фактически обнаруженную для CSTal.

---

# Как сравнивать candidates после post-move evaluation

Поскольку CSTal ABSURD own move обязан быть в candidate pool, можно использовать единый относительный Tal baseline:

```text
evaluate post-move position
для ВСЕХ candidates одинаковым judge
```

Например после нормализации к attacker perspective:

```text
CSTal ABSURD own:  +2.40
CSTal EXTREME:     +2.10
Patricia Rxf7:     +2.28
Patricia Qh5:      +0.70
Patricia g4:       -1.20
```

При:

```text
allowedLoss = 100 cp
```

best:

```text
+2.40
```

Tal-safe:

```text
ABSURD +2.40
Rxf7   +2.28   loss 12 cp
EXTREME +2.10  loss 30 cp
```

Reject:

```text
Qh5 +0.70
g4  -1.20
```

Pattern Layer затем выбирает attractor только среди safe moves.

---

# Почему это лучше explicit root-baseline + post-move candidate score

Можно дополнительно считать unrestricted score исходной позиции `S`.

Но root score:

```text
depth 14 from S
```

и post-move score:

```text
depth 14 from S_m
```

имеют разную search horizon.

Для MVP проще и чище:

> оценивать ВСЕ candidate positions одинаковым post-move search budget и сравнивать их между собой.

Mandatory ABSURD own candidate служит Tal reference door.

Позже можно сохранить unrestricted root analysis как diagnostics, но safety comparison лучше держать homogeneous.

---

# Нужен правильный comparator для EngineScore

Нельзя сравнивать raw:

```ts
score.value
```

для:

```text
centipawns
mate
```

Нужен один canonical comparator.

Порядок с attacker perspective:

```text
positive forced mate
>
centipawn positions
>
negative forced mate
```

Внутри winning mate:

```text
mate +1
>
mate +2
>
mate +3
```

быстрее mate лучше.

Внутри losing mate:

```text
mate -5
>
mate -2
>
mate -1
```

более далёкий проигрыш лучше.

Сделать:

```ts
compareEngineScoresForAttacker(a, b)
```

и использовать его:

```text
best candidate
relative safety
fallback
trace ordering
tests
```

---

# Что делать, если все candidates плохие

Не надо делать вид:

```text
TAL_SAFE
```

если все проигрывают.

Нужна отдельная семантика:

```text
accepted: true
reason: TAL_BEST_AVAILABLE_FALLBACK
safetyClass: DEGRADED
```

Pattern steering в таком режиме может выбирать только среди equally-degraded moves или вообще не добавлять большой stylistic bias.

Но система обязана сделать legal move.

---

# Как должен выглядеть новый port

Существующий:

```ts
CandidateTacticalGate
```

можно сохранить.

Поменять adapter implementation:

```text
SearchMovesTalGate
```

для движков с VERIFIED `searchmoves`;

```text
PostMoveTalGate
```

для CSTal 2.07.

Например:

```ts
createUciPostMoveTacticalGate(
  chess,
  cstalAbsurdConfig,
  {
    allowedLossCentipawns: 100,
    preserveMateClass: true,
    scorePerspective: "SIDE_TO_MOVE"
  }
)
```

Wiring:

```text
CSTal ABSURD
→ PostMoveTalGate
```

Не надо, чтобы domain/application layer знал, почему именно engine не поддерживает `searchmoves`.

Это задача UCI adapter/ACL.

---

# Что изменить в `createWindowsCstalTacticalGate()`

Сейчас:

```ts
return createUciTacticalGate(...)
```

Нужно:

```ts
return createUciPostMoveTacticalGate(...)
```

и configuration provenance:

```text
role = tactical-gate
gateMode = POST_MOVE_EVALUATION
judge = CSTal ABSURD
searchmovesCapability = UNSUPPORTED
```

Так artifact честно объяснит, каким способом candidate был проверен.

---

# `verify:cstal-windows` тоже нужно изменить

Сейчас отсутствие `searchmoves` делает весь verify красным.

После появления fallback это неправильно.

Нужно разделить:

## Mandatory engine health

```text
CSTal starts
uciok
readyok
normal bestmove works
score info exists
post-move analysis works
multiple sequential searches stable
```

Если это не работает:

```text
FAIL
```

## Optional capability

```text
searchmoves
```

Для текущего CSTal:

```text
INFO/WARN:
CSTal ABSURD searchmoves unsupported
CSTal EXTREME searchmoves unsupported
fallback=POST_MOVE_EVALUATION
```

Это НЕ должно валить verify, если PostMoveTalGate успешно проверен.

---

# Почему текущий smoke `searchmoves e2e4` тоже надо убрать как обязательный

Результат уже доказал:

```text
requested e2e4
returned d2d4
```

Больше нет смысла пытаться "починить" сам старый engine, если это не наш fork.

Наша задача — корректно адаптировать его capability.

UCI ACL существует именно для этого.

---

# Acceptance tests для PostMoveTalGate

## 1. Candidate реально уже применён

Given:

```text
candidate e2e4
```

engine получает position:

```text
after e2e4
black to move
```

Не:

```text
starting position + searchmoves
```

---

## 2. Different candidates produce different positions

```text
e2e4
d2d4
```

должны дать разные position hashes и отдельные evaluations.

---

## 3. Score sign normalized

Если defender-side raw score:

```text
-120 cp
```

normalized attacker:

```text
+120 cp
```

---

## 4. Mate sign normalized

Defender:

```text
mate -2
```

должен стать attacker-winning mate class.

---

## 5. Immediate mate candidate bypasses engine

Если candidate сам ставит мат:

```text
Qe8#
```

он сразу:

```text
WINNING_TERMINAL
```

без лишнего CSTal request.

---

## 6. Preserve mate class

Если best candidate:

```text
forced mate for attacker
```

non-mate candidate не проходит ради PatternAffinity.

---

## 7. Losing mate always vetoed against non-losing alternatives

---

## 8. All candidates compared with identical search budget

---

## 9. ABSURD own candidate is mandatory baseline candidate

Gate не должен работать без Tal reference door, если policy обещает Tal-relative safety.

---

# Performance

PostMoveTalGate по стоимости почти того же порядка, что и intended `searchmoves` gate:

```text
N candidates
→ N CSTal searches
```

Так что это не архитектурная катастрофа.

Позже оптимизировать:

```text
candidate pool
↓
cheap PatternAffinity
↓
keep mandatory Tal moves
+ top exploration subset
↓
PostMoveTalGate
↓
Maia only top safe subset
```

И cache:

```text
ENGINE_MOVE / POSITION_EVALUATION
key =
postMovePositionHash
+ CSTal version
+ mode
+ depth/nodes/time
+ options
```

Транспозиции будут reuse'иться автоматически.

---

# Как после исправления смотреть настоящую ближайшую к паттерну линию

После внедрения PostMoveTalGate НЕ надо использовать legacy post-hoc как основной способ.

Нужно снова запускать production steering:

```bash
npm run pattern:experiment -- \
  --dataset datasets/pattern-mvp-lichess.jsonl \
  --provider remote \
  --subset 5 \
  --maia3-elo 1800 \
  --concurrency 2 \
  --out .local/pattern-steering.jsonl
```

И смотреть:

```text
decisionTraces
```

На каждом attacker ply:

```text
candidate
Tal safety
targetFamily
beforeAffinity
afterCandidateAffinity
afterMaiaAffinity
patternDelta
selected
```

То есть получаем именно:

> какая Tal-safe ветка после вероятного ответа Maia ближе всего к доступному mating attractor.

Legacy:

```text
pattern:legacy-posthoc
```

оставить только для comparison baseline.

---

# Текущий статус до реализации fallback

Пока PostMoveTalGate НЕ реализован:

```text
production Pattern steering с CSTal gate
не может считаться рабочим
```

потому что текущий gate требует unsupported `searchmoves`.

Legacy post-hoc можно запускать как временный diagnostic, но он не заменяет нужную архитектуру.

---

# Новый приоритет P0

Перед held-out steering benchmark:

```text
[ ] Mark CSTal searchmoves capability UNSUPPORTED
[ ] Implement createUciPostMoveTacticalGate
[ ] Verify CSTal score perspective
[ ] Normalize score to attacker perspective
[ ] Add correct mate/centipawn comparator
[ ] Wire createWindowsCstalTacticalGate to post-move mode
[ ] Make verify:cstal-windows accept unsupported searchmoves when fallback passes
[ ] Add post-move gate contract tests
[ ] Re-run actual Windows smoke
```

Только после этого:

```text
[ ] remote Patricia
[ ] targetFamily = max final post-Maia affinity
[ ] cache identity fixes
[ ] held-out recognizer rerun
[ ] held-out steering run
```

---

# Дополнение по текущему HEAD `5afc4cf`

Последний commit:

```text
fix: preserve remote steering provider errors
```

исправил важную часть прошлого замечания:

> remote error не должен маскироваться под нормальную ScenarioLine.

`fetchRemotePatternSteeringBatch()` теперь, если server вернул:

```text
item.error
```

возвращает structured `Err` с исходным provider error.

Это хорошо.

Но сам CSTal gate всё равно остаётся неработоспособным для текущих binaries до замены `searchmoves` strategy на PostMoveTalGate.

---



# Полный предыдущий delta-review (остальные пункты остаются актуальны)


# 0. Короткий итог

Последние два коммита реально исправили значительную часть предыдущего ревью.

Теперь production steering уже гораздо ближе к правильной системе:

```text
candidate generation
↓
Tal tactical gate
↓
continuous PatternAffinity
↓
Maia response
↓
post-Maia PatternAffinity
↓
commit
↓
repeat Tal ↔ Maia
```

Исправлено:

- hard-zero prefilter больше не обнуляет production steering;
- PatternAffinity теперь continuous;
- даже affinity < 0.25 участвует в steering;
- отрицательный PatternDelta не приводит к "ничего не найдено";
- selection теперь ставит post-Maia affinity выше raw delta;
- Tal tactical gate проверяет `searchmoves` root/PV consistency;
- UCI score bounds учитываются;
- relative Tal safety появился;
- CSTal candidate slots зарезервированы;
- terminal candidate не вызывает Maia;
- decision traces сохраняются;
- Pattern и Maia caches начали реально использоваться;
- UCI lifecycle для generator/gate стал disposable;
- remote batch получил progress streaming и per-case timeout wrapper.

Но до корректного held-out steering benchmark ещё есть несколько важных проблем.

Самые серьёзные:

1. **Remote steering вообще не включает Patricia**, хотя локальный включает.
2. `targetFamily` всё ещё выбирается по максимальному **delta**, а не по максимальной итоговой **post-Maia affinity**. Поэтому selector формально ещё не делает ровно то, что требуется продуктом.
3. Maia cache key не содержит Elo/model/config — возможен reuse ответа Maia между разными Elo.
4. Pattern cache key не содержит `attackerSide`, а scorer semantics изменились без нормального version bump.
5. Remote adapter способен принять `Incomplete` steering result как обычную line и записать его в artifact.
6. Continuous affinities пока математически грубые и местами неверно нормализованы.
7. 14 core-family scorers всё ещё в основном generic boolean heuristics.
8. Tal/Patricia/Maia path всё ещё очень дорогой: searchmoves и Maia идут последовательно.
9. Held-out steering report ещё не выполнен, а старый recognizer report уже устарел после изменения scorer semantics.
10. Для текущего HEAD нет GitHub CI/workflow evidence.

---

# 1. Что исправлено после прошлого ревью

## FIXED — production steering больше не hard-zero matcher

Раньше:

```ts
matcher.prefilter(context)
  ? matcher.score(context)
  : similarity = 0
```

То есть если позиция ещё не удовлетворяла structural precondition, pattern исчезал из steering.

Теперь:

```ts
const result = matcher.score(context);
```

`prefilter` больше не используется в `assessPatternContext()`.

Это именно то, что требовалось.

Теперь возможна траектория:

```text
Anastasia
0.09
→ 0.17
→ 0.31
→ 0.48
→ 0.69
→ 0.87
```

без требования сначала оказаться в готовой Anastasia geometry.

### Статус

**Исправлено концептуально.**

---

# 2. FIXED — низкая affinity больше не означает "паттерн не найден"

Добавлен тест:

```text
steering selects low-affinity attractor progress
instead of requiring a display threshold
```

То есть:

```text
0.19
```

имеет право выиграть steering, даже если это ниже:

```text
promising = 0.25
```

Это правильно.

`far/promising/forming/near/mate_basin` теперь фактически display labels, а не разрешение/запрет steering.

---

# 3. FIXED — отрицательный delta тоже не останавливает planner

Есть regression test:

```text
all negative attractor deltas still return
the best Tal-safe candidate
```

Это важное исправление.

Если все варианты ухудшают affinity:

```text
A  -0.03
B  -0.06
C  -0.11
```

система всё равно выбирает наименее плохой Tal-safe branch.

Она больше не должна говорить:

```text
ничего не нашёл
ничего не могу сделать
```

---

# 4. FIXED — post-Maia affinity поставлена выше raw delta

Selection теперь:

```text
afterResponseScore
↓
patternDelta
↓
top post-response score
↓
UCI tie-break
```

То есть кандидат с:

```text
final affinity 0.80
delta +0.10
```

должен победить:

```text
final affinity 0.25
delta +0.20
```

Это соответствует нашей договорённости лучше, чем старое максимизирование одного delta.

---

# 5. FIXED — production steering использует только steerable core catalog

Добавлены:

```text
STEERABLE_PATTERN_FAMILY_IDS
CATALOG_ONLY_PATTERN_FAMILY_IDS
```

Сейчас production steering использует 19 Lichess core families.

15 extended families остаются catalog/provenance-only.

Это хорошее решение: нельзя молча steering'ить к pattern families, для которых scorer ещё не готов.

---

# 6. FIXED — Patricia starvation локально исправлена

`CandidateGeneratorSource` получил:

```ts
mandatory?: boolean
```

CSTal ABSURD/EXTREME sources помечаются:

```text
mandatory: true
```

И final merge теперь:

```text
mandatoryCandidates
+
explorationCandidates
```

до `slice(limit)`.

Также Patricia budget уменьшается:

```text
candidateLimit - numberOfMandatoryTalSources
```

При limit 8 получается концептуально:

```text
2 CSTal mandatory
+
6 Patricia exploration
```

Это правильная форма candidate pool.

---

# 7. FIXED — terminal candidate больше не зовёт Maia

После candidate move теперь проверяется:

```text
afterFacts.isTerminal
```

И matting candidate:

```text
Qe8#
```

заканчивает path сразу.

Есть regression test:

```text
checkmating candidate is terminal and never calls Maia
```

### Статус

**Исправлено.**

---

# 8. FIXED — terminal status в iterative path исправлен

`PatternSteeredTalPath` после committed candidate снова проверяет terminal facts и возвращает:

```text
Terminal
```

а не старый misleading:

```text
Complete
```

---

# 9. FIXED — decision trace теперь сохраняется

`ScenarioLine` получил:

```text
decisionTraces
```

Per candidate сохраняются:

```text
uci
source
talAccepted
talScore
targetFamily
beforeAffinity
afterCandidateAffinity
afterMaiaAffinity
patternDelta
```

Это очень полезно.

Теперь steering можно анализировать как систему принятия решений, а не только смотреть финальную PV.

---

# 10. FIXED — UCI searchmoves runtime validation стала гораздо честнее

Tactical gate теперь проверяет:

```text
requested searchmove
==
bestmove
```

и если PV есть:

```text
PV[0]
==
requested searchmove
```

Если движок проигнорировал:

```text
go ... searchmoves Rxf7
```

и вернул другой root move, это hard error.

Это исправляет очень опасную предыдущую дыру.

---

# 11. FIXED — UCI score bounds учитываются

Теперь:

```text
score cp 40 lowerbound
```

не считается exact tactical score.

Такие candidates получают:

```text
TAL_SCORE_BOUND_UNSAFE
```

Это правильный conservative behavior для safety gate.

---

# 12. FIXED — relative Tal safety появилась

Gate теперь после candidate scoring вычисляет best candidate и требует:

```text
bestScore - candidateScore
<= allowedLossCentipawns
```

Default:

```text
allowedLossCentipawns = 100
```

Также:

```text
preserveMateClass = true
```

То есть если best candidate является forced mate, non-mate line не должна пройти только ради PatternAffinity.

Это правильное направление.

---

# 13. FIXED — candidate/gate lifecycle теперь disposable

`CandidateGenerator` и `CandidateTacticalGate` получили:

```text
dispose()
```

Composite generator вызывает dispose child generators.

Server и local CLI теперь закрывают:

```text
generator
tacticalGate
Maia
style providers
```

Это исправляет предыдущую утечку UCI процессов.

---

# 14. FIXED — Pattern/MAIA cache начали использоваться

В steering path появились:

```text
PATTERN_ASSESSMENT cache
MAIA_RESPONSE cache
```

Это уже лучше полного пересчёта каждого transposition.

Но cache identity сейчас имеет ошибки — см. P0/P1 ниже.

---

# 15. FIXED — remote batch progress наконец стримится

Commit:

```text
a9b0e0a fix: stream pattern steering batch progress
```

CLI теперь показывает:

```text
completed / total
```

во время remote run.

Это чисто operational, но полезно.

---

# 16. P0 — remote production steering НЕ ИСПОЛЬЗУЕТ Patricia

Это сейчас один из самых важных оставшихся багов.

В local CLI:

```ts
const patricia =
  paths.patriciaPath === undefined
    ? undefined
    : createPatriciaCandidateGenerator(...);

createWindowsCstalPatternCandidateGenerator(
  ...,
  patricia
);
```

То есть local:

```text
Patricia MultiPV
+
CSTal ABSURD
+
CSTal EXTREME
```

Но Windows server создаёт:

```ts
const generator =
  createWindowsCstalPatternCandidateGenerator(
    chess,
    paths,
    options,
    8
  );
```

Пятый argument `patricia` НЕ передаётся.

Следовательно remote steering, который является default CLI mode:

```text
--provider remote
```

на практике использует только:

```text
CSTal ABSURD own move
+
CSTal EXTREME own move
```

а не наш intended candidate pool.

## Почему это критично

Мы хотели:

```text
Patricia = breadth
Tal       = tactical creativity/safety
Pattern   = direction
Maia      = human response
```

В remote benchmark Patricia сейчас отсутствует.

Поэтому результат такого benchmark не отвечает на основной продуктовый вопрос.

## Как исправить

Если Patricia установлена на Windows:

```ts
const patricia =
  paths.patriciaPath === undefined
    ? undefined
    : createPatriciaCandidateGenerator(chess, paths, 8);

const generator =
  createWindowsCstalPatternCandidateGenerator(
    chess,
    paths,
    options,
    8,
    patricia
  );
```

Если Patricia живёт только на Linux, architecture должна быть другой:

```text
Linux Patricia MultiPV
↓
candidate moves sent to Windows
↓
Windows CSTal tactical gate
↓
Pattern + Maia
```

Но default remote benchmark не должен молча тестировать другую candidate policy.

## Acceptance

Decision trace remote run должен реально содержать candidate sources:

```text
Patricia
CSTal ABSURD
CSTal EXTREME
```

когда они доступны.

---

# 17. P0 — targetFamily всё ещё выбирается не по максимальной final affinity

Это тонкий, но фундаментальный semantic bug.

Сейчас `familyProgress()` делает:

```text
для каждой family:
delta = afterMaia - before

targetFamily =
argmax(delta)
```

А затем `selectPatternSteeringCandidate()` сравнивает:

```text
afterResponseScore
```

НО `afterResponseScore` относится именно к family, которая победила по delta.

Это не то же самое, что:

```text
максимальная PatternAffinity после Maia
```

## Пример

До хода:

```text
Anastasia  0.80
Boden      0.10
```

После candidate + Maia:

```text
Anastasia  0.82   delta +0.02
Boden      0.40   delta +0.30
```

Current code выбирает:

```text
targetFamily = Boden
afterResponseScore = 0.40
```

и фактически игнорирует тот факт, что позиция уже имеет:

```text
Anastasia = 0.82
```

Хотя пользовательская цель:

> выбирать ход, где вероятность/близость к какому-либо mating attractor максимальна.

## Правильнее

Для каждого candidate считать отдельно:

```text
bestFinalFamily =
argmax_p A_afterMaia(p)

bestFinalAffinity =
max_p A_afterMaia(p)

deltaForBestFinalFamily =
A_afterMaia(bestFinalFamily)
-
A_before(bestFinalFamily)
```

Selection:

```text
1. highest bestFinalAffinity
2. highest deltaForBestFinalFamily
3. Tal quality / deterministic tie-break
```

Можно дополнительно хранить:

```text
bestProgressFamily =
argmax delta
```

для diagnostics.

Но steering target должен соответствовать той family, affinity которой мы реально максимизируем.

---

# 18. P0 — Maia cache key не содержит Elo и model identity

`maiaResponseFor()` строит key:

```ts
configuration: {
  provider: "maia",
  policy: "argmax-response"
}
```

Но server-level:

```text
patternCache
```

живёт дольше одного case и одного batch.

В key нет:

```text
maia3 Elo
model version
Maia3 vs Maia1900
temperature
top-p
history policy/version
```

## Что может произойти

Batch A:

```text
same position
Maia Elo 1400
→ cached e7e5
```

Batch B:

```text
same position
Maia Elo 2200
```

получит:

```text
cached e7e5 from Elo 1400
```

без нового Maia inference.

Это прямо ломает:

```text
HumanReachability(s,p,Elo)
```

## Как исправить

Cache identity должен получать explicit immutable Maia identity:

```text
providerKey
modelVersion
elo
temperature
topP
historyMode
policyVersion
```

Например:

```ts
MaiaAnalysisContext {
  provider: "maia3-79m";
  modelVersion: "...";
  elo: 1800;
  temperature: 1;
  topP: 1;
  useHistory: true;
}
```

Именно этот context должен входить в `MAIA_RESPONSE` cache key.

---

# 19. P0/P1 — Pattern cache key не содержит attackerSide

`familiesFor()` cache key содержит:

```text
position
modelVersion
retrieval=steerable-19
```

Но Pattern score зависит от:

```text
analysis.attackerSide
analysis.defenderSide
```

Одна и та же board position теоретически может быть оценена:

```text
White attacks Black king
```

и:

```text
Black attacks White king
```

Сейчас cache identity этого не различает.

## Исправить

Добавить:

```text
attackerSide
```

в Pattern cache configuration.

Например:

```ts
configuration: {
  modelVersion,
  retrieval: "steerable-19",
  attackerSide: context.analysis.attackerSide
}
```

---

# 20. P0/P1 — scorer semantics изменились, model version НЕ изменена нормально

В production assessor всё ещё:

```text
PATTERN_MODEL_VERSION =
"symbolic-v3-named-catalog"
```

и:

```text
...-relational-v1
```

Но semantics только что сильно изменились:

```text
hard-zero matcher
→ continuous affinity
→ post-Maia-first selection
```

Это новая scorer version.

## Почему важно

- benchmark artifacts должны быть сравнимы;
- cache entries должны инвалидироваться;
- старый held-out recognizer result больше не относится к текущему scorer;
- provenance должна честно показывать algorithm version.

## Нужно

Например:

```text
symbolic-v4-continuous-attractor-v1
```

или другую новую version.

---

# 21. P0 — remote adapter может проглотить `Incomplete` как обычный результат

Server помечает:

```text
line.status === "Incomplete"
→ batch result status = "error"
```

Это правильно.

Но `fetchRemotePatternSteeringBatch()` при чтении result проверяет в основном:

```text
steeringLine exists
```

и затем строит `ScenarioLine`.

Он не требует:

```text
item.status === "complete"
```

и не запрещает:

```text
steeringLine.status === "Incomplete"
```

## Почему это опасно

Именно так можно снова получить artifact:

```text
100 cases
100 Incomplete
0 plies
```

и CLI спокойно запишет его как "результат benchmark".

## Исправить

Remote adapter должен:

```text
if item.status !== "complete":
    preserve structured case failure
    DO NOT return it as successful ScenarioLine
```

Варианты:

### strict

Любая failed case → `Err`.

### better benchmark API

Вернуть:

```ts
{
  completed: Record<caseId, ScenarioLine>,
  failed: Record<caseId, DomainError>
}
```

и artifact явно хранит обе группы.

Но нельзя превращать failed case в successful line object.

---

# 22. P1 — searchmoves smoke test слишком слабый

`scripts/verify-cstal-windows.mjs` заставляет:

```text
starting position
searchmoves e2e4
```

Проблема:

CSTal и без `searchmoves` вполне может самостоятельно выбрать:

```text
e2e4
```

Тогда verification скажет:

```text
searchmoves supported
```

хотя engine мог полностью проигнорировать token.

Runtime gate теперь дополнительно проверяет каждый candidate и fail-closed, поэтому production safety улучшена.

Но deployment smoke test всё ещё слабый.

## Правильный smoke

Сначала:

```text
unrestricted bestmove = X
```

Затем выбрать другой legal move:

```text
Y != X
```

И проверить:

```text
go ... searchmoves Y
→ bestmove Y
→ PV[0] Y
```

Только это реально доказывает capability.

---

# 23. P1 — Tal baseline сейчас implicit, а не explicit

Предыдущая проблема частично смягчена.

Теперь CSTal ABSURD own move является mandatory candidate.

Поскольку tactical judge тоже:

```text
CSTal ABSURD depth 14
```

candidate set обычно содержит собственный unrestricted ABSURD bestmove.

Поэтому:

```text
best forced candidate score
```

примерно служит Tal baseline.

Это уже намного лучше, чем раньше.

## Но architecture всё ещё неявная

Candidate generator возвращает только move, без unrestricted root score.

Потом gate снова forced-search'ит даже Tal own move.

Лучше иметь:

```text
TalBaseline {
  bestMove
  bestScore
  PV
  searchConfig
}
```

и candidate loss считать относительно него.

Плюсы:

- semantics очевидна;
- меньше повторных searches;
- decision trace показывает настоящий Tal baseline;
- проще доказать "Pattern не ухудшил Tal больше X".

Это P1, не blocker текущего correctness, если mandatory ABSURD move действительно гарантирован.

---

# 24. P1 — единый ABSURD judge является policy, но пока не доказано, что он лучший

Теперь docs честно фиксируют:

```text
CSTal ABSURD =
ABSURD_UNIFIED_SAFETY_JUDGE
```

То есть:

```text
ABSURD candidate
EXTREME candidate
Patricia candidate
```

все судятся ABSURD.

Это уже не случайный код — policy стала explicit.

Но её всё ещё надо benchmark'нуть.

## Возможная проблема

EXTREME может считать свою жертву хорошей:

```text
EXTREME: + / practical
```

а ABSURD может veto.

Тогда часть raison d'être EXTREME теряется.

## Нужен A/B benchmark

Сравнить:

```text
A. ABSURD unified judge
B. source-specific Tal judge
C. accept if ABSURD OR EXTREME says safe
```

По:

```text
forced-mate rate
PatternAffinity achieved
Tal evaluation loss
human practical success
latency
```

Не менять policy на глаз — измерить.

---

# 25. P1 — mate-score ordering в relative gate некорректно формализован

Current `best` comparator для same score kind делает:

```text
higher numeric value = better
```

Для centipawns это нормально.

Для UCI mate score:

```text
mate 1
```

обычно лучше:

```text
mate 3
```

потому что это mate быстрее.

Но numeric compare считает:

```text
3 > 1
```

то есть mate-in-3 "лучше" mate-in-1.

Для отрицательных mates semantics ещё сложнее.

## Нужно

Ввести explicit comparator:

```ts
compareEngineScores(a,b)
```

с правилами:

```text
positive mate > any cp
mate +1 > mate +2 > mate +3
cp compare normally
any cp > negative mate
mate -5 > mate -3 > mate -1
```

И тот же comparator использовать:

```text
best selection
fallback
trace ranking
```

Не сравнивать raw `value` между разными score kinds.

---

# 26. P1 — current "continuous" edge affinity никогда не достигает 0

Сейчас:

```ts
edgeAffinity =
1 - distanceToEdge / 4
```

На 8×8 максимальный `distanceToEdge` для central square равен примерно:

```text
3
```

Значит даже король в центре получает:

```text
1 - 3/4 = 0.25
```

то есть minimum edge-affinity около 25%.

Это завышает edge-based patterns.

## Исправить

Нормализовать по реальному maximum distance:

```text
maxDistanceToEdge = 3
```

или определить более осмысленную smooth function.

Например:

```text
edge:
distance 0 → 1.00
distance 1 → 0.55
distance 2 → 0.20
distance 3 → 0.00
```

---

# 27. P1 — cornerAffinity нормализована ещё хуже

Сейчас:

```text
1 - nearestCornerManhattanDistance / 14
```

Но максимальная distance до **ближайшего** corner на 8×8 около:

```text
6
```

Значит king в центре получает примерно:

```text
1 - 6/14
≈ 0.57
```

То есть любой король на доске уже минимум ~57% "corner-like".

Это явно ломает scale.

Arabian/Smothered и другие corner-related patterns получают искусственно высокий baseline.

## Исправить

Нормализовать nearest-corner distance по реальному maximum:

```text
6
```

или использовать geometric role function.

Например:

```text
corner square       1.00
1 king-step away    0.65
2 steps             0.30
3+                   rapidly → 0
```

---

# 28. P1 — continuous field всё ещё не является настоящим pattern potential

Для first-wave появились smooth:

```text
edgeAffinity
cornerAffinity
homeRankAffinity
blockedEscapeAffinity
```

Это хорошо.

Но:

```text
knightControlAffinity
```

остаётся 0 до тех пор, пока knight уже реально не контролирует escape.

И:

```text
heavyLineAffinity
```

остаётся 0, пока rook/queen уже реально не имеет line attack.

Это всё ещё скорее:

```text
current geometry similarity
```

а не:

```text
reachability / potential
```

## Для будущего steering

Нужно добавить mate-role proximity:

```text
distance to required knight role squares
distance / alignment to heavy-piece corridor
number of legal Tal-safe moves to role
king confinement trend
```

Но не превращать Pattern Layer в chess evaluator.

Tal всё равно отвечает за tactical correctness.

---

# 29. P1 — 14 остальных core scorers всё ещё в основном boolean generic heuristics

`corePolicies` всё ещё основан на:

```text
has rook?
has knight?
some ATTACKS?
N controlled escapes?
```

И итог:

```text
70% booleanScore
+
30% generic geometryScore
```

Это лучше hard-zero, но недостаточно для различения named mate families.

Например:

```text
HOOK
VUKOVIC
```

по-прежнему практически одинаковы.

## Что делать

После infrastructure fixes:

переписать все 19 steerable families через:

```text
MateGeometryDescriptor
```

с family-specific roles.

Не generic tactical bonuses.

---

# 30. P1 — `prefilter` остался в interface как мёртвая семантика

`PatternMatcher` всё ещё содержит:

```ts
prefilter()
```

но production assessor его не использует.

Это опасно для будущего coding agent:

он может снова решить:

```text
prefilter false
→ score 0
```

и вернуть старый баг.

## Исправить

Либо удалить поле,

либо переименовать:

```text
indexHint
fastRetrievalHint
```

и документировать:

> Hint MUST NOT change PatternAffinity semantics.

---

# 31. P1 — PatternAffinity всё ещё НЕ probability

Сейчас:

```text
affinity ∈ [0,1]
```

означает heuristic geometric closeness.

Это НЕ:

```text
70% probability of reaching Anastasia mate
```

Поэтому UI/artifacts должны использовать термин:

```text
PatternAffinity
```

а не `probability`.

## Настоящая вероятность позже

Нужна:

```text
PatternReachability(s,p,Elo,N)
```

например:

```text
P(reach p within N plies |
  current position,
  Tal steering,
  Maia(Elo))
```

Её можно калибровать на rollout corpus.

До этого affinity — честное название.

---

# 32. P1 — scorer change требует нового held-out recognizer run

`tasks.md` всё ещё говорит:

```text
[x] Run held-out recognizer report
```

Но тот report был выполнен до major semantic change:

```text
hard-zero
→ continuous attractor affinity
```

Значит старый report больше не валиден для текущей model version.

## Нужно

После version bump:

```text
rerun held-out recognizer
```

и сохранить новый artifact.

Особенно проверить:

```text
top1
topK
hard-negative rejection
control FPR
trajectory monotonicity
per-family distribution
```

---

# 33. P1 — held-out steering report всё ещё не выполнен

Это честно оставлено:

```text
[ ] Run held-out steering report
```

Не закрывать этот checkbox до исправления P0:

```text
remote Patricia
target-family semantics
cache identity
failed-case handling
```

Иначе benchmark даст цифры для неправильного pipeline.

---

# 34. P1 — Pattern cache использует assessment cache, но не отдельный context cache

Сейчас перед cache lookup всё равно выполняется:

```text
computeFacts
extractPatternPositionContext
```

и только затем:

```text
PATTERN_ASSESSMENT cache
```

То есть expensive matcher work экономится, но context extraction нет.

Для 64-square board это не катастрофа.

После semantic correctness можно добавить:

```text
PATTERN_CONTEXT
```

cache:

```text
(zobrist, attackerSide, extractorVersion)
→ PatternPositionContext / MateGeometrySignature
```

---

# 35. P1 — Tal gate / candidate engine cache ещё не используется

Каждая transposition может повторно вызвать:

```text
Patricia
ABSURD
EXTREME
CSTal searchmoves candidates
```

Хотя namespaces:

```text
ENGINE_MOVE
ROLLOUT_SUFFIX
```

уже предусмотрены.

После correctness:

```text
ENGINE_MOVE:
position + engine + config + forced root move

ROLLOUT_SUFFIX:
position + steering policy + Elo + model versions
```

---

# 36. P1 — нет single-flight для expensive duplicate work

Даже если cache добавится, параллельные workers могут одновременно miss'нуть один key и оба считать:

```text
same Tal search
same Maia response
```

Для distributed/multi-worker setup нужен:

```text
in-flight claim / lease / promise
```

на expensive keys.

---

# 37. P1 — candidate generation и tactical gate всё ещё последовательные

Composite candidate generator:

```text
source1 await
source2 await
source3 await
```

Tactical gate:

```text
candidate1 searchmoves
candidate2 searchmoves
candidate3 searchmoves
...
```

Maia replies тоже идут:

```text
candidate1 await
candidate2 await
...
```

Pattern arithmetic уже очень дешёвая.

Настоящий bottleneck сейчас:

```text
N × Tal depth14
+
N × Maia 4s
```

## Оптимальный следующий pipeline

```text
Tal mandatory candidates
+
Patricia candidates
↓
cheap immediate PatternAffinity for all
↓
keep:
  all mandatory Tal
  top K exploration by affinity
↓
Tal gate only this shortlist
↓
accepted candidates
↓
top K for Maia
↓
Maia
↓
final post-Maia selection
```

Важно:

cheap PatternAffinity может использоваться для **shortlisting** до Tal gate,

но final move всё равно обязан пройти Tal safety.

---

# 38. P1 — per-case timeout не отменяет underlying steering cooperatively

Server делает:

```ts
Promise.race([
  generatePatternSteeredTalPath(...),
  timeoutPromise
])
```

После timeout `finally` dispose'ит providers.

Но сам `generatePatternSteeredTalPath()` не получает:

```text
AbortSignal
```

То есть losing promise формально продолжает жить, пока следующий provider access не упадёт/не завершится.

## Лучше

Передавать:

```ts
abortSignal
```

во:

```text
PatternSteeredTalPath
CandidateGenerator
TacticalGate
Maia
```

и прекращать loop явно.

---

# 39. P1 — remote benchmark failure semantics нужно сделать per-case явными

Лучший формат:

```json
{
  "caseId": "...",
  "status": "complete | error",
  "line": {...},
  "error": {...}
}
```

CLI artifact должен хранить failures, а summary:

```text
completed
failed
incomplete
```

отдельно.

Не надо:

```text
одна failure → потерять весь benchmark
```

и нельзя:

```text
failure → masquerade as successful line
```

---

# 40. P1 — DecisionTrace не хранит rejected candidates

Сейчас trace строится из:

```text
evaluated
```

а rejected Tal candidates были отфильтрованы раньше:

```ts
if (!tacticalAssessment.accepted) continue;
```

Поэтому artifact показывает только survivors.

Для debugging Tal-gate нужно видеть:

```text
all generated candidates
Tal score
accepted/rejected
reason
```

Иначе невозможно понять:

```text
Patricia предложила хороший attractor,
но Tal почему-то его vetoed
```

## Исправить

Trace:

```text
generatedCandidates
↓
tacticalAssessment for all
↓
pattern assessment for survivors
↓
selected
```

---

# 41. P1 — multi-source provenance теряется при dedup

Если Patricia и CSTal предлагают один и тот же move:

```text
Rxf7
```

composer сохраняет первый occurrence.

Поскольку Patricia обычно идёт раньше, trace может показать:

```text
source = Patricia
```

и потерять факт:

```text
CSTal ABSURD independently proposed same move
```

Это не correctness blocker, но для анализа ценно.

Позже стоит хранить:

```text
proposedBy: [Patricia, CSTal ABSURD]
```

при одном canonical move.

---

# 42. P1 — near-O(1) retrieval пока не реализован

Production steering проверяет все 19 steerable families.

Для 19 это практически дешёво.

Но обсуждавшаяся architecture:

```text
L0 cache
↓
MateGeometrySignature
↓
uint64 family mask
↓
2–5 exact scorers
```

ещё не реализована.

Это не приоритет перед scorer correctness.

Главный latency сейчас не patterns, а Tal/Maia.

---

# 43. P1 — canonical symmetry/relevance старые проблемы остаются

Последние два commits почти не исправляли:

```text
rank mirror semantics
arbitrary radius relevance
```

Поэтому прошлое замечание остаётся.

Canonicalization должна отражать:

```text
mate-role geometry
```

и использовать только chess-semantic symmetries.

---

# 44. CI / verification gap

Для текущего HEAD:

```text
b7bc2bd...
```

GitHub connector не показывает:

```text
commit statuses
workflow runs
```

Это не доказывает, что tests падают.

Но нельзя утверждать:

```text
current master fully passes gate
```

только потому, что тесты добавлены.

Нужно реально зафиксировать:

```bash
npm run gate
npm run verify:cstal-windows
```

на актуальном code + actual Windows binaries.

---

# 45. Что закрыто из предыдущего delta-review

Можно считать закрытым:

```text
✓ hard-zero production prefilter
✓ low-affinity steering
✓ negative-delta fallback
✓ post-Maia affinity primary candidate ordering
✓ steerable-vs-catalog taxonomy
✓ CSTal mandatory slot reservation
✓ terminal candidate handling
✓ terminal status
✓ decision traces
✓ searchmoves root/PV runtime verification
✓ bound-aware UCI score parsing
✓ relative candidate safety
✓ UCI generator/gate disposal
✓ Pattern assessment cache
✓ Maia response cache plumbing
✓ remote progress output
```

---

# 46. Что осталось сделать в первую очередь

## P0 — до следующего benchmark

### 1. Подключить Patricia в REMOTE steering

Сейчас remote ≠ local candidate policy.

Это надо исправить первым.

### 2. Исправить targetFamily semantics

Primary target:

```text
argmax final post-Maia PatternAffinity
```

а delta — secondary.

### 3. Исправить Maia cache identity

В key обязательно:

```text
model
version
Elo
temperature
topP
history mode
```

### 4. Добавить attackerSide в Pattern cache key

### 5. Bump Pattern model/scorer version

### 6. Не принимать remote `Incomplete/error` как успешную ScenarioLine

---

# 47. Следующий P1 block

После P0:

```text
7. strengthen searchmoves smoke test
8. explicit Tal baseline / baseline score provenance
9. proper mate-score comparator
10. benchmark ABSURD unified judge vs alternatives
11. fix edgeAffinity normalization
12. fix cornerAffinity normalization
13. improve first-wave role proximity
14. rewrite remaining 14 core matchers as real MateGeometry
15. remove/rename dead prefilter API
16. rerun held-out recognizer
17. run held-out steering
18. persist rejected candidates in traces
19. add engine/gate/suffix caches
20. add single-flight
21. bounded parallel Tal/Maia evaluation
22. cooperative cancellation
23. near-O(1) family bitset after semantic correctness
```

---

# 48. Рекомендуемая final selection semantics

Для каждого Tal-safe move `m`:

```text
for each steerable family p:

A_before(p)

A_after_move(m,p)

A_after_Maia(m,p)
```

Определить:

```text
Target(m)
=
argmax_p A_after_Maia(m,p)
```

И:

```text
FinalAffinity(m)
=
max_p A_after_Maia(m,p)
```

Затем:

```text
Delta(m)
=
A_after_Maia(m, Target(m))
-
A_before(Target(m))
```

Move selection:

```text
1. highest FinalAffinity
2. highest Delta for SAME target family
3. Tal score / style policy
4. deterministic tie-break
```

Это буквально реализует требование:

> Из Tal-safe ходов выбирай тот, после вероятного Maia response, где близость к какому-либо mating pattern максимальна.

---

# 49. Future true probability

Текущий scorer должен называться:

```text
PatternAffinity
```

Не probability.

Настоящая probability должна появиться как:

```text
PatternReachability(s,p,Elo,N)
```

Например:

```text
P(
  reach Anastasia basin within 6 plies
  |
  current position,
  Tal steering,
  Maia-1800
)
```

Для этого сначала нужен чистый rollout dataset.

Не надо называть heuristic `0.73` вероятностью `73%`.

---

# 50. Итоговая architecture после оставшихся fixes

```text
POSITION
   ↓
Candidate proposals
   ├─ CSTal ABSURD mandatory
   ├─ CSTal EXTREME mandatory
   └─ Patricia MultiPV exploration
   ↓
dedupe + multi-source provenance
   ↓
cheap PatternAffinity shortlist
   ↓
CSTal tactical safety
   ↓
Tal-safe candidates
   ↓
Maia(Elo) likely response
   ↓
post-Maia PatternAffinity for ALL 19 attractors
   ↓
choose max final attractor affinity
   ↓
commit
   ↓
repeat
```

Pattern Layer:

```text
does NOT evaluate chess quality
does NOT veto Tal
does NOT require exact pattern match
does NOT stop because all affinities are low
```

Он делает только:

> among Tal-safe branches, keep moving toward the strongest available mating attractor.

---

# 51. Definition of Done перед серьёзным held-out steering run

```text
[ ] Remote candidate pool includes Patricia + ABSURD + EXTREME
[ ] Target family = highest post-Maia final affinity
[ ] Maia cache includes Elo/model/config
[ ] Pattern cache includes attackerSide
[ ] Pattern model version bumped
[ ] Incomplete remote cases are failures, not successful lines
[ ] searchmoves smoke forces a non-default move
[ ] mate-score comparator correct
[ ] edge/corner affinity normalization corrected
[ ] current scorer held-out recognizer rerun
[ ] npm run gate recorded
[ ] verify:cstal-windows passes on actual binaries
[ ] only then run held-out steering benchmark
```

---

# 52. Главный вывод

Текущий `master` уже перестал быть системой:

```text
"паттерн не совпал → 0 → сдаёмся"
```

Это важная победа.

Но он ещё не до конца стал системой:

```text
"из всех Tal-safe вариантов выбери ход,
который после вероятного ответа Maia
максимизирует близость к лучшему доступному
матовому attractor"
```

Чтобы получить именно это, сейчас критично добить:

```text
remote Patricia
+
target-family selection semantics
+
cache identity
+
honest failure handling
```

После этого уже имеет смысл верить held-out steering benchmark.
