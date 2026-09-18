# Понял проект и паттерны


9/18/2026, 3:26:44 PM

Бро, а как добиться того, чтоб эти матовые паттерны оч быстро проверялись. В идеале за O(1)?

## Response:
9/18/2026, 3:26:54 PM

> **Designing pattern lookup**
>
> I’m distinguishing theoretical from practical O(1): chess’s fixed board makes exhaustive checks asymptotically constant, but thousands of arbitrary patterns still hurt performance. A king-centered bitboard signature, precomputed tables, and incremental attack updates can provide genuinely fast constant-time candidate retrieval.
>
> **Designed a pattern lookup**
>
> 
>
> Worked for 13s

Да. Причём в шахматах тут есть важный нюанс: **формально можно приблизиться к O(1), а для наших 34–50 паттернов фактически сделать почти настоящий O(1)**.

Потому что доска всегда 64 клетки. То есть даже полный проход по доске — с точки зрения алгоритмической сложности константа. Но нам важнее не академическая асимптотика, а чтобы проверка занимала микросекунды, а не миллисекунды.

Я бы делал в три слоя.

### 1. Bitboards вместо объектов и переборов

Не хранить:

```text
[{piece:"N", square:"f6"}, ...]
```

а иметь обычные 64-битные маски:

```text
whiteKnights
whiteRooks
whiteQueens
blackKing
whiteAttacks
blackAttacks
occupied
```

Тогда куча вопросов решается одной-двумя CPU-инструкциями:

```text
есть ли конь в нужной зоне?
(knights & knightZone) != 0

закрыты ли escape squares?
(escapeMask & freeSquares) == 0

контролирует ли атакующий нужную клетку?
(attacks & criticalSquareMask) != 0
```

Это практически мгновенно.

---

### 2. Candidate-family bitset

Вот это для нас вообще очень вкусно.

У нас 34 матовых семейства. Они все помещаются в **один `uint64`**.

Каждому pattern даём бит:

```text
bit 0  = Anastasia
bit 1  = Arabian
bit 2  = Boden
...
bit 33 = Vukovic
```

Начинаем:

```text
candidates = 0x3FFFFFFFF   // все 34
```

И затем одним `AND` отбрасываем невозможное.

Например у позиции нет коня:

```text
candidates &= PATTERNS_NOT_REQUIRING_KNIGHT
```

Нет пары слонов:

```text
candidates &= PATTERNS_NOT_REQUIRING_TWO_BISHOPS
```

Король не на краю:

```text
candidates &= PATTERNS_NOT_REQUIRING_EDGE_KING
```

Нет тяжёлой фигуры:

```text
candidates &= PATTERNS_NOT_REQUIRING_ROOK_OR_QUEEN
```

После нескольких битовых операций из:

```text
34 patterns
```

может остаться:

```text
ANASTASIA
ARABIAN
HOOK
VUKOVIC
```

То есть retrieval:

```text
34 → 4
```

за буквально десяток CPU instructions.

Это уже практически **O(1)**.

---

### 3. Только оставшимся 2–5 семействам — точный matcher

И только потом проверяем реальные relations:

```text
ATTACKS
BLOCKS
CONTROLS_ESCAPE
XRAY
PIN
DEFENDS
```

Например для Anastasia:

```text
king on edge?
       ↓
есть knight в relevant zone?
       ↓
knight реально контролирует critical escape?
       ↓
есть rook/queen checking corridor?
       ↓
remaining escape blocked?
```

И всё это опять bitboards.

Не нужно проходить по доске.

---

Можно даже сделать так:

```text
Position
   ↓
extract/update bitboards
   ↓
structural signature
   ↓
uint64 candidatePatterns
   ↓
bitset AND filters
   ↓
3 candidates
   ↓
3 relational matchers
```

В практическом смысле это будет дешевле одного нормального chess-engine node expansion на порядки.

---

## А можно ещё быстрее: king-zone signature

Мы почти всегда анализируем геометрию вокруг одного короля.

Берём:

```text
3×3
или
5×5
```

около defending king.

И кодируем признаки в один 64/128-bit integer.

Например:

```text
bits 0–7    occupied escape squares
bits 8–15   attacked escape squares
bits 16–23  defended escape squares
bits 24–31  knight attacks
bits 32–39  rook/queen ray relations
bits 40–47  bishop ray relations
bits 48–55  blockers
...
```

Получаем:

```text
KingPatternSignature = uint64 / uint128
```

Тогда coarse lookup вообще:

```text
signature → candidatePatternBitset
```

через hash table.

Среднее lookup:

```text
O(1)
```

---

## Причём можно сделать memoization прямо этого signature

У нас уже будет Zobrist:

```text
PositionKey
```

Cache:

```text
(positionZobrist, attackerSide)
        ↓
PatternContext
KingSignature
candidatePatternBitset
scores
```

Тогда если позиция встретилась через транспозицию:

```text
cache hit
```

и вообще ничего повторно не проверяем.

---

## Ещё сильнее — incremental update после хода

Не надо после каждого хода заново строить всё.

Был:

```text
PatternContext(S)
```

сделали:

```text
Nf5
```

Изменились только:

```text
from square
to square
attack map этого коня
возможно slider rays через from/to
king escape map, если это рядом
```

То есть:

```text
Context(S')
=
update(Context(S), move)
```

а не:

```text
rebuildFromFen(S')
```

И это опять практически фиксированная стоимость.

Для knight/pawn/king вообще тривиально.

Для bishop/rook/queen надо обновить несколько ray lines.

---

# Можно ли получить буквально один lookup?

Для **финального точного recognition** — не всегда разумно.

Потому что паттерны содержат wildcards:

```text
"неважно, что стоит на a3"
"ладья может быть здесь или здесь"
"ферзь может заменить ладью"
```

Если попытаться заранее создать таблицу:

```text
каждая возможная позиция → pattern
```

она взорвётся по размеру.

Но мы можем сделать почти то же самое:

```text
signature
↓
candidate bitset
↓
2–4 tiny exact checks
```

По latency это будет практически неотличимо от O(1).

---

# Самое интересное: для 34 patterns индекс вообще элементарный

Например заранее:

```text
PATTERNS_REQUIRING_KNIGHT       = 0b...
PATTERNS_REQUIRING_TWO_BISHOPS  = 0b...
PATTERNS_REQUIRING_EDGE_KING    = 0b...
PATTERNS_REQUIRING_CORNER_KING  = 0b...
PATTERNS_REQUIRING_HEAVY_PIECE  = 0b...
```

А позиция даёт:

```text
hasKnight
hasTwoBishops
kingEdge
kingCorner
hasHeavyPiece
```

Псевдологика:

```text
candidates = ALL_PATTERNS

if (!hasKnight)
    candidates &= ~REQUIRES_KNIGHT

if (!hasTwoBishops)
    candidates &= ~REQUIRES_TWO_BISHOPS

if (!kingEdge)
    candidates &= ~REQUIRES_EDGE

if (!kingCorner)
    candidates &= ~REQUIRES_CORNER
```

В итоге один `uint64` говорит, какие matchers вообще запускать.

Вот это я бы точно заложил в `symbolic-v4-relational`.

---

# А когда будет 3 000 deadly clusters?

Тогда один `uint64` уже не хватит, но принцип тот же.

До 4096 patterns:

```text
4096 bits = 512 bytes
```

На каждый coarse feature есть 512-byte bitmap.

Дальше:

```text
candidateBitmap &= bitmapForFeature
```

Современный CPU такие массивы жрёт очень быстро, особенно SIMD.

Даже 10 000 patterns — это не страшно.

Но для тысяч fuzzy clusters я бы уже добавил:

```text
embedding
↓
HNSW / FAISS
↓
top 10–30
↓
exact relational matcher
```

Это уже не строгий worst-case O(1), но practically near-constant retrieval.

---

## В итоге я бы построил четыре уровня

```text
L0 — Zobrist cache
      ↓ hit?
      return immediately

L1 — bitboard structural gating
      ↓
      34 → 3–8 patterns

L2 — exact relational bitboard matchers
      ↓
      top patterns + missing conditions

L3 — embedding/ANN
      только когда каталог станет огромным
```

Для нынешнего MVP L3 вообще не обязателен.

И очень важная штука: **не надо пытаться делать O(1) за счёт ухудшения семантики**, как Luna сейчас сделала со своими `nearbyKnightCount`. Правильный relational matcher тоже можно сделать почти целиком битовыми операциями.

То есть мы можем получить одновременно:

**нормальное шахматное понимание + микросекундную проверку**.

Для наших 34 именованных матов я бы ожидал, что сам Pattern Layer после построения attack maps будет настолько дешёвым, что на фоне одного запроса к Maia или одного поиска CSTal его стоимость практически исчезнет.

## Prompt:
9/18/2026, 3:29:14 PM

```
ATTACKS
BLOCKS
CONTROLS_ESCAPE
XRAY
PIN
DEFENDS
```

Это не не матовые паттерны. Если мы эту общеизвестную ерунду начнём велосипедить, мы можем ухудшить Таля

## Response:
9/18/2026, 3:29:23 PM

Да. Вот здесь ты прав — я смешал два уровня.

`ATTACKS / PIN / XRAY / DEFENDS` — **не паттерны**. И если начать превращать их в самостоятельную «оценку позиции» и подмешивать к CSTal, мы действительно рискуем построить рядом с Талем убогий псевдодвижок, который будет спорить с гораздо более сильным поиском Tal.

Правильнее так:

```text
CSTal
= отвечает за шахматы
= тактика
= жертвы
= оценка позиции
= форсированные варианты
= что вообще хорошо играть

Pattern Layer
= НЕ оценивает шахматы заново
= НЕ пытается быть вторым engine
= отвечает только:
  "насколько эта позиция похожа
   на конкретное матовое семейство?"
```

То есть для Anastasia нам не нужен generic:

```text
+0.2 за pin
+0.1 за xray
+0.3 за attack
```

Это действительно ерунда.

Нам нужен именно **Anastasia matcher**:

```text
Anastasia-family
│
├─ король прижат к краю
├─ конь занимает характерную позицию
│  относительно короля
├─ ладья/ферзь имеет характерную
│  mating-line geometry
└─ оставшееся пространство короля
   ограничено своей фигурой / краем
```

И всё.

Для Boden:

```text
Boden-family
│
├─ два слона
├─ характерные пересекающиеся диагонали
│  относительно короля
├─ король ограничен собственными фигурами
└─ финальная mating geometry
```

Не надо спрашивать:

```text
"сильный ли это pin?"
"хороший ли xray?"
"достаточно ли атакующих фигур?"
```

Это Tal знает в сто раз лучше нашего Pattern Layer.

### Тогда зачем вообще нужны `ATTACKS`, `CONTROLS_ESCAPE` и т. п.?

Только как **низкоуровневые геометрические predicates**, а не как шахматная оценка.

Например:

```text
does_knight_control(square_h7) = true
```

нужно не потому, что:

> контроль h7 хорош на +0.14.

А потому что:

> без контроля этого конкретного поля данная реализация Anastasia геометрически не совпадает с шаблоном.

То есть это разница между:

```text
TACTICAL HEURISTIC
"контроль escape square повышает оценку позиции"
```

и:

```text
PATTERN PREDICATE
"это поле должно быть закрыто,
иначе это не данное матовое семейство"
```

Это принципиально разные вещи.

---

Я бы поэтому вообще поменял терминологию в нашем плане.

Не:

```text
relational tactical graph
```

потому что это действительно звучит как попытка написать второй Stockfish.

А:

```text
Mate Geometry Descriptor
```

Например:

```text
MateGeometry
├── king-relative piece locations
├── king confinement geometry
├── mating-piece role
├── supporting-piece role
├── required covered squares
└── allowed symmetries / substitutions
```

Это гораздо ближе к нашей задаче.

---

И тогда архитектура становится безопасной для Таля:

```text
                 CSTal
                   │
             candidate moves
                   │
                   ▼
             apply candidate
                   │
                   ▼
        Mate Pattern Recognizer
                   │
       ┌───────────┴────────────┐
       │                        │
   Anastasia .72             Boden .18
       │
       ▼
ΔAnastasia = +0.21
```

Pattern Layer **ничего не говорит о том, хороший ход или плохой**.

Он говорит только:

> этот ход заметно приблизил нас к Anastasia-family.

А итоговое решение:

```text
Tal tactical quality
+
маленький PatternProgress bonus
```

Причём Tal должен иметь право наложить абсолютное вето.

Если Tal говорит:

```text
Rxf7 = -6.5
```

а Pattern Layer говорит:

```text
Anastasia +0.40
```

мы не играем `Rxf7` только ради красивого рисунка.

То есть:

$$
PatternBonus \ll TacticalSafety
$$

---

### Я бы сделал ещё жёстче

На первом MVP вообще **не вмешиваться Pattern Layer в CSTal evaluation**.

Пусть Tal остаётся совершенно нетронутым.

Например Patricia/CSTal дают:

```text
Nf5
Rxf7
Qh5
g4
```

Tal independently оценивает/продолжает каждый candidate.

Pattern Layer только добавляет metadata:

```text
Nf5
Tal: good
Pattern: Anastasia +0.08

Rxf7
Tal: good
Pattern: Anastasia +0.31

Qh5
Tal: good
Pattern: Pillsbury +0.17

g4
Tal: weaker
Pattern: none
```

И **только среди приемлемых для Tal вариантов** можно предпочесть более pattern-rich.

Вот так мы Таля не портим.

---

Есть ещё более чистая схема:

```text
1. Tal определяет Pareto set допустимых атакующих ходов.

2. Pattern Layer НЕ имеет права добавить
   ход, который Tal отфильтровал как плохой.

3. Pattern Layer только меняет порядок
   среди оставшихся хороших Tal candidates.

4. Maia проверяет практическую вероятность
   человеческого ответа.

5. После появления forced mate
   Pattern Layer вообще перестаёт влиять.
```

Это очень хорошая safety boundary.

---

И с O(1) идея остаётся, просто меняется смысл индекса.

Не:

```text
есть pin?
есть xray?
есть attack?
```

а:

```text
king geometry = EDGE
attacking material around king = N + R/Q
relative knight zone = ...
relative heavy-piece corridor = ...
```

По этой сигнатуре:

```text
MateGeometrySignature
        ↓
hash / bitset lookup
        ↓
possible families:
ANASTASIA
HOOK
ARABIAN
```

А затем 2–3 маленьких **чисто геометрических** matcher'а.

Никакого нового chess evaluation.

---

Я бы даже сформулировал архитектурное правило для `AGENTS.md`/спеки:

> **Pattern Layer MUST NOT reimplement chess evaluation.**  
> It may derive only pattern-specific geometric descriptors required to recognize or measure progress toward a mating family. Tactical soundness, move quality, sacrifices, defensive resources and general positional evaluation remain the responsibility of chess engines.

И рядом второе:

> **Pattern signals MAY rerank tactically acceptable engine candidates, but MUST NOT override a tactically losing engine assessment solely to increase pattern similarity.**

Вот это уже очень важная поправка к моему предыдущему плану. Я бы её внес туда обязательно.

## Prompt:
9/18/2026, 3:33:50 PM

И как мы научим Таля приводить позицию к какому-либо матовому паттерну? Или как мы вообще их использовать будем с теми кирпичами, что задумали? Объясни мне

## Response:
9/18/2026, 3:34:02 PM

Бро, ключевая мысль такая: **на MVP мы вообще не “учим Таля” матовым паттернам внутри него.** Мы строим над ним внешний планировщик, который заставляет Таля исследовать те его собственные хорошие атакующие ходы, которые ведут в сторону интересного матового семейства.

То есть Tal остаётся Tal. Мы не лезем в его NNUE, не добавляем ему `+0.3 за Anastasia`, не пытаемся заново объяснить ему шахматы.

Его роль:

```text
CSTal
=
"какие здесь есть сильные, агрессивные,
жертвенные шахматные продолжения?"
```

Pattern Layer отвечает на совершенно другой вопрос:

```text
Pattern Layer
=
"какое из этих сильных продолжений
ведёт к интересной матовой геометрии?"
```

А Maia:

```text
Maia(Elo)
=
"что после этого наиболее вероятно
сыграет человек такого рейтинга?"
```

Вот из этих трёх вещей и получается обучение/наведение.

---

## Как это выглядит на практике

Допустим текущая позиция `S`.

Patricia MultiPV и сам Tal дают нам, например:

```text
Nf5
Rxf7
Qh5
g4
```

Tal может сказать условно:

```text
Nf5   — хорошая атака
Rxf7  — хорошая жертва
Qh5   — хорошая атака
g4    — допустимо
```

Мы не пытаемся заменить эту оценку.

Теперь Pattern Layer смотрит **только на матовую геометрию**.

В позиции `S` он видит:

```text
Anastasia-family   0.36
Pillsbury-family   0.22
Arabian-family     0.15
```

После `Nf5`:

```text
Anastasia 0.48
```

После `Rxf7`:

```text
Anastasia 0.67
```

После `Qh5`:

```text
Pillsbury 0.51
```

То есть Pattern Layer говорит:

> `Rxf7` очень сильно двигает позицию в сторону Anastasia geometry.

Но этого ещё недостаточно.

---

## Дальше включается Maia

Мы спрашиваем:

```text
после Rxf7 что скорее всего сыграет Maia-2100?
```

Допустим:

```text
...Kg8   43%
...Rxf7  27%
...Kh8   18%
...
```

Берём наиболее важные человеческие ответы.

После `Rxf7 ...Kg8`:

```text
Anastasia 0.81
```

После `Rxf7 ...Rxf7`:

```text
Anastasia 0.29
```

Получаем уже не:

```text
Rxf7 красиво выглядит
```

а:

```text
Rxf7
→ вероятный человеческий ответ
→ очень высокая вероятность войти
  в Anastasia-like geometry
```

Вот это уже настоящий **human-conditioned steering**.

---

# А потом снова Tal

Из новой позиции:

```text
Rxf7 ...Kg8
```

мы снова спрашиваем Tal:

```text
какие сильные атакующие ходы ты хочешь играть теперь?
```

Он, допустим, предлагает:

```text
Nf5
Rf3
Qh5
```

Pattern Layer опять ничего не изобретает.

Он просто видит:

```text
Rf3:
Anastasia 0.81 → 0.91

Nf5:
0.81 → 0.83

Qh5:
0.81 → 0.75
```

Если `Rf3` при этом остаётся нормальным для Tal, именно его можно предпочесть.

Получается цикл:

```text
Tal предлагает
      ↓
Pattern Layer направляет
      ↓
Maia моделирует человека
      ↓
Tal снова предлагает
      ↓
Pattern Layer снова направляет
      ↓
...
```

То есть мы **не учим Tal знать Anastasia**.

Мы используем Tal как очень талантливого тактического исполнителя, которому внешний planner говорит:

> «Из твоих хороших идей вот эта сильнее ведёт нас к выбранной композиционной цели».

---

# Это на самом деле похоже на navigation

Представь автомобиль.

Tal — водитель:

```text
умеет рулить,
обгонять,
тормозить,
понимает дорогу.
```

Pattern Layer — GPS:

```text
говорит, в какую сторону надо двигаться.
```

Maia — модель трафика:

```text
предсказывает,
куда поедет другой автомобиль.
```

Forced mate verifier — проверка:

```text
дорога действительно заканчивается там,
где мы думаем.
```

Было бы безумием писать в GPS собственную физику автомобиля.

Вот почему ты правильно заметил опасность с `PIN/XRAY/etc.` как отдельными оценками: **Pattern Layer не должен становиться вторым шахматным движком**.

---

# Но возникает главный вопрос: откуда Pattern Layer знает, что мы «приближаемся» к Anastasia?

Вот здесь как раз нужны те кирпичи, которые мы собирали.

Не один exact final diagram.

У нас будет множество Lichess Anastasia puzzles:

```text
s0 → s1 → s2 → s3 → Anastasia mate
```

и ещё тысячи других:

```text
t0 → t1 → t2 → Anastasia mate
u0 → u1 → u2 → u3 → u4 → Anastasia mate
...
```

Из них мы постепенно получаем **область пространства позиций**, ведущую к Anastasia.

Не:

```text
эта позиция == Anastasia
```

а:

```text
эта позиция находится далеко
эта ближе
эта уже forming
эта находится в Anastasia basin
эта — финальная geometry
```

И здесь как раз появляются три уровня.

### Первый MVP

Ручная/геометрическая близость:

```text
какие необходимые элементы уже существуют;
какие отсутствуют;
какие относительные расположения фигур подходят.
```

Не шахматная оценка, а именно geometry descriptor.

Например:

```text
Anastasia:
king confinement       ✓
knight role            ✓
heavy-piece corridor   partially
final mating alignment ✗
```

Получаем:

```text
0.68
```

---

### Следующий уровень

ChessLM / embeddings.

Мы берём тысячи реальных Anastasia states:

```text
near Anastasia
forming Anastasia
final Anastasia
```

и получаем несколько prototypes / clusters.

Текущая позиция сравнивается с ними.

Это уже позволяет ловить варианты, которые ручная схема описывает плохо.

---

### Ещё позже — самое интересное

Обучаем:

$$
V(s,p,e)
$$

где:

```text
s = текущая позиция
p = матовый pattern
e = Elo соперника
```

И модель отвечает:

> Какова вероятность из позиции `s` прийти к паттерну `p`, если наши ходы выбираются атакующим search, а соперник отвечает как Maia(Elo)?

Вот это уже не просто similarity.

Это **reachability**.

Именно она в конечном счёте нам и нужна.

---

# Тогда выбор хода становится очень красивым

Tal предлагает:

```text
m1
m2
m3
m4
```

Для каждого мы можем получить:

```text
Tal tactical quality
Pattern reachability
Human response probability
Forced-mate potential
```

Но принцип безопасности такой:

```text
сначала Tal определяет,
что ход шахматно допустим/интересен

потом Pattern Layer выбирает
среди этих вариантов
```

То есть Pattern Layer не получает права сказать:

```text
Tal: -7
Pattern: +0.95 Anastasia

→ сыграем!
```

Нет.

Так мы Tal действительно испортим.

---

# А Patricia зачем тогда?

Очень важный кирпич.

CSTal закрытый и обычно выдаёт нам один основной ход.

Но вполне может существовать:

```text
Tal internally likes:
A
B
C
D

выдал только A
```

а `C` мог бы привести к очень красивому Boden/Anastasia.

Поэтому Patricia MultiPV даёт нам **ширину**:

```text
Patricia:
A
B
C
D
E
F
G
H
```

Плюс:

```text
CSTal own bestmove
```

Получаем candidate pool.

Если CSTal поддерживает UCI `searchmoves`, вообще прекрасно:

```text
Patricia предлагает Rxf7
↓
CSTal searchmoves Rxf7
↓
"Tal, оцени и продолжи именно эту дверь"
```

Тогда Patricia лишь показывает двери, а Tal сам идёт через них.

Если `searchmoves` нет:

```text
apply Rxf7
↓
Maia отвечает
↓
Tal получает новую позицию
```

Тоже работает.

---

# Получается, что Pattern Layer вообще не обязан знать «лучший шахматный ход»

Это очень важное архитектурное разделение:

```text
Patricia
→ exploration / breadth

CSTal
→ tactical creativity + attacking quality

Maia
→ human opponent model

Mate Pattern Layer
→ goal / direction

Forced Mate Verifier
→ truth

Cache
→ не считать одинаковое второй раз
```

И вот эти кирпичи практически идеально дополняют друг друга.

---

# Более точная схема всей системы

```text
                         POSITION S
                             │
                             ▼
                    Root Move Proposers
             ┌───────────────┼───────────────┐
             │               │               │
          Patricia         CSTal          optional
          MultiPV          own move       Seer/Jakal
             └───────────────┼───────────────┘
                             ▼
                       Candidate Pool
                             │
                             ▼
                    Tal tactical filter
                             │
                    acceptable candidates
                             │
                             ▼
                      Pattern Layer
                    /       |       \
              Anastasia   Boden    Pillsbury
                   │
                   ▼
            PatternProgress
                   │
                   ▼
                 Maia(Elo)
                   │
          likely human replies
                   │
                   ▼
          expected PatternProgress
                   │
                   ▼
              choose branch
                   │
                   ▼
                    CSTal continues
                   │
                   ▼
                  repeat
                   │
                   ▼
             MATE BASIN reached
                   │
                   ▼
          independent mate verifier
                   │
                   ▼
               FORCED MATE
```

Вот это уже действительно система **«Tal, направленный в сторону красивых комбинационных целей»**, но без попытки переписать Tal.

---

## И в какой момент мы выбираем сам target pattern?

Не надо заранее говорить:

```text
хочу только Anastasia
```

Это тоже было бы искусственно.

В каждой позиции recognizer может сказать:

```text
Anastasia reachability  0.62
Boden                    0.08
Pillsbury                0.49
Arabian                   0.14
```

По мере игры targets могут меняться.

Например:

```text
ход 12:
Pillsbury наиболее перспективен

ход 14:
после человеческой ошибки
вдруг открылась Anastasia

ход 16:
Anastasia становится почти forcing
```

Planner переключает цель.

То есть паттерн — **не жёсткое назначение**, а attractor.

Это, мне кажется, самая правильная модель нашей идеи:

> **Tal генерирует красивые тактические возможности; матовые паттерны работают как attractors в пространстве позиций; Maia показывает, к каким attractors реально склонен привести человеческий ответ.**

А уже позже `V(s,p,e)` позволит вместо довольно тупого `PatternSimilarity` непосредственно оценивать:

> «Если отсюда идти через Tal × Maia, насколько реально вообще попасть в этот attractor?»

Вот тогда система станет по-настоящему интересной.



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)