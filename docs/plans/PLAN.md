# Следующий этап: Pattern-guided CSTal×Maia MVP

## Summary

Текущий репозиторий находится на этапе **cache foundation**:

- OpenSpec/DDD/Event Storming оформлены;
- Zobrist/state key и cache port добавлены;
- есть bounded in-memory LRU;
- существующий StylePath пока не использует Pattern Layer и cache;
- пользовательские `game.txt` и conversation-файлы остаются нетронутыми.

Следующий этап — реализовать отдельный `PatternGuidedStylePath`, не меняя default StylePath.

## 1. Уточнить доменную модель

Добавить ADTs:

- `PatternFamily`;
- `PatternEvidence`;
- `PatternAssessment`;
- `PatternState`: `far`, `promising`, `forming`, `near`, `mate_basin`, `forced_mate`;
- `HumanReachability`;
- `MateVerification`;
- `CandidatePool`;
- `RolloutSuffix`.

Исправить cache-модель:

- `ZobristPositionKey` отвечает только за board state;
- `RuleContext` хранит halfmove clock и repetition context;
- `HistorySignature` для Maia history-aware режима хранится отдельно;
- не считать полную move history автоматически доказательством repetition state.

Первая версия Pattern Families — декларативные symbolic definitions, без фиксированных FEN:

- Anastasia;
- Boden;
- Pillsbury;
- Arabian;
- Smothered;
- Back rank;
- Deflection;
- Attraction;
- Sacrifice.

## 2. Реализовать deterministic Pattern Engine

Создать pure domain policies:

- `extractPatternFeatures(position, facts)`;
- `scorePatternFamily(position, family)`;
- `calculatePatternProgress(previous, next)`;
- `classifyPatternState(assessment)`;
- `mergePatternEvidence(line)`.

Обязательные правила:

- irrelevant background pieces не должны ломать pattern family;
- legal move и provenance не создаются Pattern Engine;
- similarity не является доказательством forced mate;
- numeric HumanReachability нельзя выдумывать.

Для Maia reachability:

- добавить порт ranked Maia candidates;
- использовать численную вероятность только если adapter реально отдаёт calibrated probability/logit;
- иначе возвращать `Unavailable` с причиной и сохранять Maia candidate ranking как evidence.

## 3. Добавить candidate pool и rollout use case

Новый application use case:

```text
generatePatternGuidedRollouts
```

Поток:

```text
PositionSnapshot
  → candidate pool
  → deduplicate legal candidates
  → cache lookup
  → CSTal × Maia rollout
  → PatternAssessment
  → MateVerification
  → ranking
```

Candidate pool MVP:

- собственный best move CSTal ABSURD;
- собственный best move CSTal EXTREME;
- optional Patricia MultiPV;
- optional Seer/Jackal best moves;
- configurable maximum 8–12 candidates;
- недоступный источник не заменяется выдуманным ходом.

Каждый rollout:

```text
CandidateSeed
→ Maia response
→ same CSTal provider continuation
→ Maia response
→ same CSTal provider continuation
→ ...
```

Порядок источников и provenance сохраняются для каждого ply. Existing `StylePath` остаётся без изменений; новый режим получает отдельный label `PatternGuidedStylePath`.

## 4. Интегрировать cache в rollout

Расширить cache port typed operations:

```ts
getPositionEvaluation(...)
getMaiaResponse(...)
getPatternAssessment(...)
getRolloutSuffix(...)
put(...)
```

Cache entries должны содержать:

- `schemaVersion`;
- `PositionStateKey`;
- provider/model/configuration fingerprints;
- model/policy version;
- provenance;
- terminal/forced-mate status;
- creation timestamp.

Правила:

- exact hit переиспользует compatible result;
- другой Maia Elo не даёт exact hit;
- history-aware Maia учитывает `HistorySignature`;
- изменение CSTal mode/version/depth invalidates engine result;
- Pattern model version invalidates PatternAssessment;
- suffix reuse разрешён только при совпадении всей rollout policy;
- cache miss/error ведёт к явному recomputation;
- cache entry с незаконным move повторно валидируется и отклоняется.

После in-memory adapter добавить durable local adapter:

- JSON entries в `.local/pattern-cache/`;
- atomic temp-file + rename;
- bounded size/TTL;
- без секретов;
- shared Redis/PostgreSQL оставить отдельным deployment adapter после benchmark.

## 5. Forced-mate precedence

Добавить `MateVerifier` application port.

Разделить:

- `TerminalMate` — deterministic факт текущей позиции;
- `ForcedMate` — результат отдельного verifier;
- `PatternSimilarity` — эстетическая/структурная близость.

Режимы:

```text
до ForcedMate:
  tactical safety
  CSTal quality
  PatternProgress
  HumanReachability

после ForcedMate:
  Pattern steering disabled
  MateVerifier result authoritative
```

Если verifier недоступен, система не утверждает forced mate и возвращает `Unknown/Unavailable`.

## 6. API и CLI

Сохранить default behavior полностью совместимым.

Добавить optional pattern mode:

```json
{
  "pattern": {
    "enabled": true,
    "targetFamily": "ANASTASIA",
    "candidateLimit": 10,
    "cache": "memory"
  }
}
```

Default:

- `enabled: false`;
- существующий StylePath не меняется;
- cache используется только в PatternGuided mode.

API/SSE snapshot должен дополнительно возвращать:

- selected pattern family;
- per-line PatternAssessment;
- PatternProgress;
- HumanReachability status;
- MateVerification;
- cache hit/miss/partial-hit statistics;
- degraded/error state.

CLI добавить:

```bash
--pattern anastasia
--candidate-limit 10
--cache memory|file|off
```

Обычная команда без `--pattern` должна выдавать прежний результат.

## 7. Тесты и acceptance criteria

### Domain

- одинаковая motif geometry при разном фоне получает совместимые признаки;
- similarity не объявляет forced mate;
- progress воспроизводим;
- pattern state переходы детерминированы;
- unavailable Maia probability не превращается в число;
- ForcedMate отключает steering.

### Rollout

- candidate pool дедуплицирует legal moves;
- illegal candidate не вызывает провайдер;
- каждый ply имеет корректный provenance;
- Maia не заменяется CSTal и наоборот;
- provider failure оставляет partial rollout без выдуманных plies.

### Cache

- transposition даёт одинаковый Zobrist key;
- castling/en-passant различаются;
- Elo/model/configuration изолируют entries;
- suffix reuse проверяет все policy fingerprints;
- corrupt/illegal cache entry отклоняется;
- cache failure вызывает recomputation.

### Integration

- default StylePath snapshots не меняются;
- `--pattern` создаёт PatternGuided output;
- API и CLI используют одинаковый application use case;
- Windows smoke test проверяет реальный CSTal×Maia rollout;
- benchmark сравнивает cold cache, warm cache, partial hit и suffix reuse.

Команды проверки:

```bash
npm run gate
npm run style:lines:cstal -- --maia3-elo 2300 --raw-file game.txt --watch --refresh-ms 2000
```

Для live Windows smoke использовать отдельный opt-in test с локальным token, без публикации credentials.

## Assumptions

- Maia 79M остаётся frozen.
- CSTal v2 остаётся black-box UCI provider.
- MultiPV CSTal не предполагается: candidate pool строится через доступные providers.
- Numeric HumanReachability появляется только после подтверждения реального Maia probability output.
- Pattern-guided mode сначала запускается отдельно от default StylePath.
- Незакоммиченные `docs/conversations/chess-gpt.md`, `docs/conversations/chess-gpt2.md` и `game.txt` не изменяются и не включаются в следующие коммиты.
