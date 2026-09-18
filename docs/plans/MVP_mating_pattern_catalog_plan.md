# MVP: расширение каталога матовых паттернов для Pattern Layer

**Версия:** 2.0  
**Дата ревью:** 2026-09-18  
**Назначение:** самостоятельная спецификация MVP. Документ не требует чтения предыдущих обсуждений.

---

## 0. Контекст проекта

Цель проекта — построить внешний **Pattern Layer** над существующим шахматным пайплайном:

```text
Patricia MultiPV / другие proposal engines
                ↓
          Candidate Pool
                ↓
        Pattern Layer
                ↓
      reranking кандидатов
                ↓
          CSTal ↔ Maia(Elo)
                ↓
   rollout до мата / termination
                ↓
      forced-mate verification
```

Роли компонентов:

- **Patricia** — удобный источник нескольких root-кандидатов через MultiPV.
- **CSTal** — основной атакующий/жертвенный движок, задающий желаемый стиль.
- **Maia-3** — модель человеческого ответа соперника заданного Elo.
- **Pattern Layer** — понимает, к каким матовым/тактическим семействам приближается позиция и какие ходы увеличивают этот потенциал.
- **Forced-mate verifier** — отделяет «похоже на матовый паттерн» от объективно доказанного мата.

На стадии MVP **не требуется модифицировать исходники CSTal и не требуется обучать большую шахматную сеть**.

---

# 1. Цель именно этого MVP

Нужно доказать три вещи:

1. Позицию можно сопоставлять не с одной фиксированной FEN, а с **семейством матовых геометрий**.
2. Можно считать **PatternProgress**: ход приблизил позицию к матовому семейству или отдалил от него.
3. Этот сигнал можно использовать при выборе root-кандидатов так, чтобы CSTal + Maia чаще приходили к красивым и затем форсированным матам.

MVP не должен быть энциклопедией всех матов. Нужен контролируемый **seed catalogue**, который достаточно широк для экспериментов и при этом хорошо размечен.

---

# 2. Главный принцип представления паттерна

Не хранить паттерн как конкретную позицию.

Неправильно:

```text
pattern == exact FEN
```

Правильно:

```text
Pattern Family
├── canonical_id
├── human_name
├── aliases
├── provenance
├── textual_definition
├── structural_features
├── positive_examples
├── hard_negative_examples
├── canonical_symmetries
├── prototype_embeddings
└── transition_examples
```

Пример:

```yaml
canonical_id: anastasia_mate
human_name: "Anastasia's Mate"

aliases:
  - anastasiaMate
  - Anastasia Mate
  - Anastasia's Mate

provenance:
  - lichess

structural_features:
  - enemy king confined near board edge
  - knight controls key escape squares
  - rook or queen supplies checking line
  - another friendly piece / board edge restricts escape
```

**Имя — только label. Настоящий объект Pattern Layer — геометрия и отношения фигур.**

---

# 3. Иерархия источников

Для MVP использовать источники в таком порядке.

| Приоритет | Источник | Что из него брать |
|---|---|---|
| 1 | Lichess `lila` | официальные ключи тем и текстовые определения |
| 1 | Lichess Puzzle Database | FEN, solution moves, rating, themes, opening tags |
| 1 | `lichess-puzzler` | логика/идея автоматической разметки тактических тем |
| 2 | классическая шахматная литература / справочники | дополнительные устойчивые именованные матовые семейства |
| 2 | ChessMood 37 patterns | расширенный reference-список и aliases |
| 2 | Mesotten, *The Checkmate Patterns Manual* | проверка классической taxonomy |
| 3 | `deadly` | king-centric abstraction, transition graph, неназванные clusters |
| 3 | ChessLM | generic position embeddings |
| 3 | Maia-3 + `chessformer_lens` | human model и экспериментальные hidden features |

---

# 4. Lichess — обязательное ядро MVP

## 4.1. Где находится актуальная taxonomy

Основной код:

- GitHub:  
  https://github.com/lichess-org/lila/blob/master/modules/puzzle/src/main/PuzzleTheme.scala

В `PuzzleTheme.scala` есть отдельная категория:

```scala
I18nKey.puzzle.mateThemes
```

На момент ревью в ней **19 отдельных mate themes**.

Главная страница Lichess Puzzle Themes:

- https://lichess.org/training/themes

---

# 5. Все 19 Lichess mate themes + прямые ссылки

Эти 19 паттернов являются **обязательным ядром MVP**.

| # | Internal key Lichess | Название | Прямая Lichess-тренировка |
|---:|---|---|---|
| 1 | `anastasiaMate` | Anastasia's Mate | https://lichess.org/training/anastasiaMate |
| 2 | `arabianMate` | Arabian Mate | https://lichess.org/training/arabianMate |
| 3 | `backRankMate` | Back Rank Mate | https://lichess.org/training/backRankMate |
| 4 | `balestraMate` | Balestra Mate | https://lichess.org/training/balestraMate |
| 5 | `blindSwineMate` | Blind Swine Mate | https://lichess.org/training/blindSwineMate |
| 6 | `bodenMate` | Boden's Mate | https://lichess.org/training/bodenMate |
| 7 | `cornerMate` | Corner Mate | https://lichess.org/training/cornerMate |
| 8 | `doubleBishopMate` | Double Bishop Mate | https://lichess.org/training/doubleBishopMate |
| 9 | `dovetailMate` | Dovetail Mate | https://lichess.org/training/dovetailMate |
| 10 | `epauletteMate` | Epaulette Mate | https://lichess.org/training/epauletteMate |
| 11 | `hookMate` | Hook Mate | https://lichess.org/training/hookMate |
| 12 | `killBoxMate` | Kill Box Mate | https://lichess.org/training/killBoxMate |
| 13 | `pillsburysMate` | Pillsbury's Mate | https://lichess.org/training/pillsburysMate |
| 14 | `morphysMate` | Morphy's Mate | https://lichess.org/training/morphysMate |
| 15 | `operaMate` | Opera Mate | https://lichess.org/training/operaMate |
| 16 | `swallowstailMate` | Swallow's Tail Mate | https://lichess.org/training/swallowstailMate |
| 17 | `triangleMate` | Triangle Mate | https://lichess.org/training/triangleMate |
| 18 | `vukovicMate` | Vukovic Mate | https://lichess.org/training/vukovicMate |
| 19 | `smotheredMate` | Smothered Mate | https://lichess.org/training/smotheredMate |

Это важно не только как список названий: каждую URL можно использовать для ручной проверки того, что Lichess действительно относит к данной теме.

---

# 6. Откуда взять определения этих 19 паттернов

Lichess хранит human-readable definitions отдельно:

- https://github.com/lichess-org/lila/blob/master/translation/source/puzzleTheme.xml

Для каждого паттерна взять:

```text
external_key
human_name
description
```

Например эти определения полезны для:

- документации;
- sanity-check ручного symbolic matcher;
- будущего explanation layer;
- контроля aliases и терминологии.

**Но текстовое определение нельзя использовать как единственный формальный detector.**

---

# 7. Откуда взять миллионы примеров

## 7.1. Lichess Puzzle Database

Главная страница открытой базы:

- https://database.lichess.org/#puzzles

В текущем формате записи содержат:

```text
PuzzleId
FEN
Moves
Rating
RatingDeviation
Popularity
NbPlays
Themes
GameUrl
OpeningTags
DailyDate
```

То есть для темы `bodenMate` можно напрямую фильтровать поле `Themes` и получать реальные размеченные puzzle-позиции.

### На MVP сохранять

```text
puzzle_id
initial_fen
solution_moves
rating
themes
opening_tags
game_url
```

И дополнительно восстановить все промежуточные позиции:

```text
s0 → s1 → s2 → ... → mate
```

---

## 7.2. Lichess Puzzler

Репозиторий:

- https://github.com/ornicar/lichess-puzzler

Использование в нашем проекте:

- понять логику существующих tags;
- использовать как reference для слабой автоматической разметки;
- сверять, почему конкретная puzzle получила тему.

**Не использовать `lichess-puzzler` как runtime planner.**

Он отвечает на вопрос:

```text
"есть ли тема в уже найденной тактической линии?"
```

а наш Pattern Layer должен отвечать:

```text
"насколько позиция потенциально близка к теме
и можно ли направить игру в эту сторону?"
```

---

# 8. Сколько Lichess-примеров брать на MVP

Не нужно сразу использовать всю Puzzle Database.

Рекомендуемый объём:

```text
редкий паттерн:
500–1000 positives, если столько существует

обычный паттерн:
2000–5000 positives

очень частый паттерн:
до 10000 positives
```

Для MVP разумный итоговый порядок:

```text
~30k–100k исходных размеченных mate examples
```

После извлечения промежуточных состояний и augmentation это даст заметно больше state samples.

---

# 9. Почему нельзя брать только финальную матовую позицию

Из puzzle-линии:

```text
s0 → s1 → s2 → s3 → mate
```

нужно хранить все состояния.

Это позволит проверить:

```text
PatternScore(s0)
PatternScore(s1)
PatternScore(s2)
PatternScore(s3)
PatternScore(mate)
```

Ожидаемое поведение:

```text
far → forming → near → mate basin → mate
```

Это основа будущего `PatternProgress`.

---

# 10. Второй слой MVP — дополнительные именованные паттерны

После того как pipeline заработал на 19 Lichess themes, добавить **8–15 дополнительных матовых семейств**, которых Lichess не выделяет отдельными `mateThemes`.

Важно: не называть весь этот слой «классическими» без проверки. Некоторые названия старые и общепринятые, некоторые — современная учебная taxonomy.

## Приоритетные кандидаты

### Высокий приоритет

- Damiano's Mate
- Greco's Mate
- Lolli's Mate
- Legal's Mate
- Blackburne's Mate
- Anderssen's Mate
- Mayet's Mate
- Réti's Mate
- Max Lange Mate
- Suffocation Mate

### Второй приоритет

- Lawnmower Mate
- David and Goliath Mate
- Two Knights Mate
- h-file Mate
- Diagonal Corridor Mate

Цель:

```text
19 Lichess
+
8–15 extended
=
~27–34 mate families
```

Этого достаточно для MVP.

---

# 11. Откуда брать extended taxonomy

## 11.1. ChessMood / Avetik Grigoryan

Расширенный список из 37 mating patterns:

- https://www.chess.com/blog/Avetik_ChessMood/the-complete-checkmate-patterns-list

Использовать как:

```text
reference taxonomy
aliases
названия дополнительных паттернов
человеческие примеры
```

Не считать каждый термин автоматически каноническим.

---

## 11.2. Raf Mesotten — The Checkmate Patterns Manual

Страница книги:

- https://www.newinchess.com/the-checkmate-patterns-manual

Использовать для:

- проверки устойчивости названия;
- сопоставления aliases;
- решения, является ли паттерн достаточно важным для MVP.

Не использовать содержимое книги как bulk training dataset.

---

# 12. Как получить data для extended patterns

У дополнительных паттернов нет готового Lichess `Themes=...`.

Поэтому для MVP нужен seed-based подход.

Для одного паттерна:

```text
50–200 high-confidence seed positions
```

Затем:

1. вручную/полуавтоматически подтвердить geometry;
2. canonicalize;
3. построить symbolic matcher;
4. применить controlled perturbations;
5. искать совпадения в открытых PGN / forced-mate collections;
6. подтверждать найденные позиции matcher'ом и mate verifier'ом.

На MVP не нужно добиваться тысяч ручных examples для каждого такого семейства.

---

# 13. Controlled perturbations

Нам специально нужны варианты одной и той же геометрии с разным «шумом».

Например для Boden:

```text
base position
+
лишняя пешка на другом фланге
+
переставленная неучаствующая ладья
+
зеркальное отражение
+
смена цветов
```

Label остаётся:

```text
boden_mate
```

Так Pattern Layer учится игнорировать нерелевантные детали.

---

# 14. Canonicalization

Перед сравнением паттернов позиции надо нормализовать.

Минимум:

```text
1. атакующая сторона приводится к одной ориентации
2. black/white symmetry
3. file mirror
4. при необходимости rank mirror
5. enemy king становится локальным origin
6. фигуры кодируются относительно king-centric coordinates
```

Пример:

```text
absolute:
king = g8
rook = g7
knight = e7

relative:
king   = (0, 0)
rook   = (0, -1)
knight = (-2, -1)
```

Для Pattern Layer относительные отношения важнее абсолютных клеток.

---

# 15. Symbolic representation

Для каждого mate family сделать ручной baseline-граф.

Узлы:

```text
enemy king
attacking pieces
relevant defenders
escape squares
blocking pieces
critical squares
```

Отношения:

```text
ATTACKS
DEFENDS
BLOCKS
PINS
XRAYS
OCCUPIES
CAN_REACH_IN_1
CAN_REACH_IN_2
ESCAPE_SQUARE
```

Пример:

```yaml
pattern: anastasia_mate

requirements:
  enemy_king:
    region: edge

  attackers:
    knight: required
    rook_or_queen: required

relations:
  - knight controls key escape square
  - rook_or_queen supplies checking line
  - board edge / friendly unit restricts king
```

---

# 16. Hard negatives

На каждый паттерн нужны позиции, которые визуально похожи, но тактически не работают.

Примеры:

- конь стоит «как в Anastasia», но не контролирует нужную клетку;
- ладья имеет линию, но король получает дополнительный escape square;
- атакующая фигура pinned;
- защитник может захватить mating piece;
- геометрия почти готова, но критическая линия закрыта.

Именно hard negatives предотвращают:

```text
"похоже по картинке" == "паттерн почти готов"
```

---

# 17. Tactical motifs хранить отдельно от mate families

Pattern Layer должен понимать не только конечные маты, но и промежуточные комбинационные механизмы.

Из Lichess взять как минимум:

| Motif | Lichess |
|---|---|
| Attraction | https://lichess.org/training/attraction |
| Clearance | https://lichess.org/training/clearance |
| Deflection | https://lichess.org/training/deflection |
| Discovered Attack | https://lichess.org/training/discoveredAttack |
| Discovered Check | https://lichess.org/training/discoveredCheck |
| Double Check | https://lichess.org/training/doubleCheck |
| Interference | https://lichess.org/training/interference |
| Pin | https://lichess.org/training/pin |
| Sacrifice | https://lichess.org/training/sacrifice |
| Skewer | https://lichess.org/training/skewer |
| X-Ray Attack | https://lichess.org/training/xRayAttack |
| Capturing Defender | https://lichess.org/training/capturingDefender |
| Exposed King | https://lichess.org/training/exposedKing |
| Kingside Attack | https://lichess.org/training/kingsideAttack |
| Attacking f2/f7 | https://lichess.org/training/attackingF2F7 |

Они могут образовывать цепочки:

```text
Sacrifice
→ Attraction
→ Deflection
→ Exposed King
→ Anastasia Mate
```

Это напрямую связано с желаемым комбинационным стилем CSTal.

---

# 18. `deadly`: что взять уже в MVP

Репозиторий:

- https://github.com/0oj/deadly

Проект анализирует миллионы forced-mate sequences и строит king-centric abstractions и transition networks.

На MVP взять **методические идеи**, а не импортировать тысячи clusters как готовую taxonomy.

## Взять

### King-centric abstraction

Локальное состояние вокруг defending king:

```text
occupancy
control
escape squares
board edge
relevant local geometry
```

### Transition graph

```text
PatternState A
→ PatternState B
→ PatternState C
→ Mate
```

### Идею funnel / mate basin

Много разных линий могут сходиться в одно и то же структурное предматовое состояние.

## Пока не брать

```text
3,602 clusters → 3,602 "новых паттерна"
```

Это задача Alpha после того, как базовый matcher и scoring уже проверены.

---

# 19. ChessLM на MVP

Репозиторий:

- https://github.com/bluehood/Encoder-ChessLM

Модель:

- https://huggingface.co/odestorm1/chesslm

ChessLM выдаёт generic embedding шахматной позиции и может использоваться как **дополнительный soft signal**.

Для одного паттерна лучше иметь несколько prototypes:

```text
prototype A
prototype B
prototype C
...
```

а не один средний centroid.

Считать:

```text
cosine similarity(current_position, prototypes)
```

Но:

```text
embedding similarity ≠ tactical reachability
```

Поэтому ChessLM нельзя использовать как единственный detector.

---

# 20. Maia-3 и chessformer_lens

Maia-3:

- https://github.com/CSSLab/maia3

Chessformer interpretability toolkit:

- https://github.com/chessformer-lens/chessformer_lens

На MVP Maia остаётся:

```text
frozen
```

Её основная роль:

```text
P(human response | position, Elo)
```

`chessformer_lens` можно использовать для экспериментов с hidden representations, но MVP не должен зависеть от успешного обучения отдельного Maia Pattern Head.

---

# 21. MVP PatternScore

Первая версия:

```text
PatternScore(p, s) =
    α * SymbolicSimilarity
  + β * ChessLMSimilarity
  + γ * OptionalMaiaPatternSignal
```

На самом первом baseline допустимо:

```text
γ = 0
```

То есть начать только с:

```text
symbolic + ChessLM
```

Все компоненты хранить отдельно для ablation.

Пример:

```json
{
  "pattern": "anastasia_mate",
  "symbolic": 0.82,
  "chesslm": 0.71,
  "combined": 0.78
}
```

---

# 22. PatternProgress

Для каждого candidate move:

```text
before = PatternScore(position, target)
after  = PatternScore(position_after_move, target)

PatternProgress = after - before
```

Пример:

```text
Anastasia:
before = 0.55

Rf3:
after = 0.73

ΔPatternProgress = +0.18
```

Этот сигнал добавляется к оценке кандидата.

---

# 23. Candidate generation в текущей архитектуре

На MVP разумный root pool:

```text
Patricia MultiPV:       8–12
CSTal own best move:       1
Seer / Jakal optional:   1–2
Pattern proposal later:  1–3
```

После дедупликации:

```text
~8–15 unique candidates
```

Каждый кандидат затем проходит:

```text
candidate
↓
PatternScore / PatternProgress
↓
Maia(Elo) response
↓
CSTal
↓
Maia
↓
...
↓
mate / termination
```

---

# 24. Forced mate остаётся отдельным понятием

Никогда не считать:

```text
PatternScore = 0.95
```

эквивалентом:

```text
forced mate
```

Правильная логика:

```text
high pattern potential
↓
human-conditioned Tal + Maia rollout
↓
позиция вошла в mate basin
↓
объективная проверка всех legal defenses
↓
forced mate
```

Нужно отдельно показывать:

```text
Pattern similarity
Human reachability
Forced mate status
```

---

# 25. Кэширование и транспозиции

Pattern extraction сразу делать memoizable.

Ключ позиции должен учитывать:

```text
piece placement
side to move
castling rights
en-passant state
```

Для pattern cache:

```text
PatternCacheKey =
    PositionKey
  + PatternModelVersion
```

Для Maia:

```text
MaiaCacheKey =
    PositionKey
  + Elo
  + MaiaModelVersion
  + history_signature   # если включён history-aware режим
```

Для полного rollout:

```text
RolloutCacheKey =
    PositionKey
  + TalConfig
  + MaiaConfig
  + Elo
  + PatternModelVersion
```

Это позволит переиспользовать suffix, если разные порядки ходов привели в одну позицию.

---

# 26. Как расширять taxonomy внутри MVP — правильный порядок

## MVP-A — Lichess core

Сначала:

```text
19 Lichess mate themes
+
15 tactical motifs
```

Задача:

- ingestion;
- canonicalization;
- symbolic matcher;
- PatternScore;
- PatternProgress;
- direct links/manual validation;
- integration с candidate pool.

**Не добавлять новые названия, пока это не работает.**

---

## MVP-B — extended named mates

После успешного baseline:

```text
+8–15 additional named mate families
```

Для каждого:

```text
50–200 verified seeds
symbolic definition
aliases
hard negatives
```

---

## MVP-C — experimental structure

Только после этого:

```text
deadly transition structures
unnamed clusters as experimental IDs
```

Но unnamed clusters пока не должны участвовать в продуктовой taxonomy наравне с человеческими именованными паттернами.

---

# 27. Рекомендуемая структура каталога

```text
patterns/
│
├── mate_families/
│   ├── lichess/
│   │   ├── anastasia_mate.yaml
│   │   ├── arabian_mate.yaml
│   │   └── ...
│   │
│   └── extended/
│       ├── damiano_mate.yaml
│       ├── greco_mate.yaml
│       └── ...
│
├── tactical_motifs/
│   ├── attraction.yaml
│   ├── deflection.yaml
│   └── ...
│
└── experimental/
    └── deadly/
        ├── cluster_0001.yaml
        └── ...
```

---

# 28. Пример pattern record

```yaml
canonical_id: anastasia_mate
type: mate_family

display_name: "Anastasia's Mate"

aliases:
  lichess: anastasiaMate
  common:
    - Anastasia Mate
    - Anastasia's Mate

sources:
  taxonomy:
    - https://github.com/lichess-org/lila/blob/master/modules/puzzle/src/main/PuzzleTheme.scala
  description:
    - https://github.com/lichess-org/lila/blob/master/translation/source/puzzleTheme.xml
  training:
    - https://lichess.org/training/anastasiaMate

geometry:
  king_region:
    - edge

  required_roles:
    - knight
    - rook_or_queen

  relations:
    - knight_controls_escape
    - rook_or_queen_checks_along_line
    - king_is_confined

examples:
  source: lichess_puzzle_db

status:
  mvp: required
```

---

# 29. Что НЕ делать на MVP

Не нужно:

- импортировать тысячи `deadly` clusters как named patterns;
- строить detector по exact FEN;
- считать puzzle solution единственным путём;
- обучать новый chess foundation model;
- fine-tune CSTal NNUE;
- full fine-tune Maia-3;
- делать RL;
- смешивать mate families и tactical motifs в один flat namespace;
- пытаться сразу определить «все существующие маты в шахматах».

---

# 30. Обучение: что требуется на MVP

Базовый MVP можно реализовать **без обучения нового большого ML-модуля**.

Используются:

```text
symbolic matcher
+
готовые ChessLM embeddings
+
готовая Maia-3
```

## Если добавить маленький Pattern Head как эксперимент

Рекомендуемый стартовый датасет:

```text
20k–100k labelled / augmented states
```

С frozen backbone это маленькая задача.

Ориентир для AWS SageMaker с одной A10G-class GPU:

```text
training:
~0.5–2 GPU-hours

порядок стоимости одного run:
~$1–5

feature extraction / несколько экспериментов:
ориентировочно ~$10–50
```

Это **не обязательная часть MVP-A**. Сначала нужен baseline без обучения.

---

# 31. Definition of Done для MVP

MVP считается успешным, если:

1. Все 19 Lichess mate themes загружены как самостоятельные pattern records.
2. Для каждой темы есть:
   - direct Lichess URL;
   - Lichess source key;
   - textual definition;
   - positive examples;
   - symbolic representation.
3. Нерелевантная пешка/фигура не разрушает recognition.
4. Mirror/color-equivalent позиции распознаются как одно семейство.
5. Hard negative получает заметно меньший score, чем реальный pattern.
6. По puzzle trajectories PatternScore в среднем растёт к мату.
7. Для root candidates можно считать `ΔPatternProgress`.
8. Patricia MultiPV + CSTal candidate pool можно rerank'ить по этому сигналу.
9. CSTal + Maia rollout продолжает считаться до мата/termination, а не ограничивается 3–5 ходами.
10. Forced mate подтверждается отдельно от similarity.
11. Все позиции/embeddings/suffix rollouts могут кэшироваться по transposition key.
12. После успешного Lichess-core можно добавить extended mate families без изменения архитектуры.

---

# 32. Что получаем на выходе MVP

Для произвольной позиции система должна уметь вернуть примерно:

```json
{
  "top_patterns": [
    {
      "pattern": "anastasia_mate",
      "similarity": 0.72
    },
    {
      "pattern": "pillsbury_mate",
      "similarity": 0.54
    }
  ],

  "candidate_moves": [
    {
      "move": "Rf3",
      "target_pattern": "anastasia_mate",
      "pattern_before": 0.72,
      "pattern_after": 0.84,
      "pattern_progress": 0.12
    }
  ]
}
```

Дальше этот candidate проходит через:

```text
Maia(Elo)
↔
CSTal
```

до конца линии.

И финально система различает:

```text
похоже на паттерн
↓
реально приближается к паттерну
↓
человек вероятно входит в линию
↓
после определённого момента мат становится forced
```

---

# 33. Главные ссылки MVP

## Lichess

- Puzzle themes:  
  https://lichess.org/training/themes

- Lichess mate theme source:  
  https://github.com/lichess-org/lila/blob/master/modules/puzzle/src/main/PuzzleTheme.scala

- Lichess theme descriptions:  
  https://github.com/lichess-org/lila/blob/master/translation/source/puzzleTheme.xml

- Lichess Puzzle Database:  
  https://database.lichess.org/#puzzles

- Lichess Puzzler:  
  https://github.com/ornicar/lichess-puzzler

## Extended taxonomy

- ChessMood — 37 Checkmate Patterns:  
  https://www.chess.com/blog/Avetik_ChessMood/the-complete-checkmate-patterns-list

- Raf Mesotten — The Checkmate Patterns Manual:  
  https://www.newinchess.com/the-checkmate-patterns-manual

## Structural discovery

- `deadly`:  
  https://github.com/0oj/deadly

## Embeddings

- Encoder-ChessLM:  
  https://github.com/bluehood/Encoder-ChessLM

- ChessLM model:  
  https://huggingface.co/odestorm1/chesslm

## Human-response model

- Maia-3:  
  https://github.com/CSSLab/maia3

- chessformer_lens:  
  https://github.com/chessformer-lens/chessformer_lens

---

# 34. Короткая рекомендация

Для MVP не начинать с попытки собрать «максимально полный список матов».

Правильная последовательность:

```text
19 Lichess named mate themes
        ↓
полный working pipeline
        ↓
8–15 дополнительных human-named families
        ↓
deadly / unnamed structural discovery
        ↓
opening-specific motifs на Alpha
```

То есть сначала создаётся **надёжный эталонный слой**, где labels уже существуют и их можно проверять на Lichess, а затем taxonomy расширяется без изменения архитектуры.

Это минимизирует риск потратить время на спорные названия и редкие схемы до того, как доказано, что сам `PatternProgress → steering → CSTal×Maia → forced mate` работает.
