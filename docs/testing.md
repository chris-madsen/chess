# Testing Strategy

## Test principle

Tests enforce domain invariants before testing chess strength. Exact engine moves are often version-, hardware-, and limit-sensitive. Most tests should assert legality, source order, provenance completeness, deterministic fixture behavior, and safety boundaries.

## Test pyramid

```text
many domain unit tests
some application orchestration tests
some adapter contract tests with fixtures
few opt-in integration tests with real engines/models
very few live external probe tests, disabled by default
```

## Domain tests

Domain tests must be fast, deterministic, and network-free.

Cover:

- FEN and move ingestion boundaries;
- `PositionSnapshot` canonicalization and hashing;
- legal move acceptance and illegal move rejection;
- `CandidateSeed` source validation;
- HumanPath source sequence calculation;
- scenario horizon and terminal-state stop rules;
- `MoveProvenance` completeness checks;
- prohibition on attributing continuations to external seed bots;
- `Decision` not being a `PlatformCommand`;
- immutability of frozen domain records.

Example names:

```text
positionSnapshot_rejectsInvalidFen_withoutProviderCalls
candidateSeed_acceptsLegalPlayerMove_withPlayerProvenance
scenarioLine_rejectsIllegalSeed_beforeInvokingEngines
humanPath_preservesMaiaStockfishAlternation
externalAlienSeed_doesNotLabelContinuationAsAlien
moveProvenance_rejectsUnknownSourceKind
analysisSession_decisionIsNotPlatformCommand
```

## Application orchestration tests

Use fake providers and repositories to verify:

- provider call order;
- no provider call after seed rejection;
- partial line behavior after provider timeout;
- run records are written with request IDs;
- CoachAssessment receives structured facts, not raw provider objects;
- ordinary analysis never calls platform write ports.

Recommended fake providers should be deterministic and return scripted legal/illegal moves.

## Adapter contract tests

Use recorded fixtures and local test doubles for:

- Stockfish normal `bestmove` response;
- Stockfish malformed output;
- Stockfish timeout;
- Stockfish illegal output relative to requested position;
- Maia normal response;
- Maia no legal output / malformed output;
- ExternalProbe observed legal first move;
- ExternalProbe failed/aborted game;
- redaction of platform credentials from logs.

Contract tests should assert conversion into domain-shaped results and provider errors. They should not require live public Lichess bots.

## Integration tests

Opt-in integration tests may launch local Stockfish and local Maia. They should:

- pin binary/model identity where possible;
- use small horizons and deterministic limits;
- assert legal HumanPath output and complete provenance;
- avoid exact move assertions unless using fixed fixtures;
- be skipped when binaries or model weights are unavailable.

Suggested environment gates:

```text
RUN_ENGINE_INTEGRATION=1
STOCKFISH_PATH=/path/to/stockfish
MAIA_MODEL_PATH=/path/to/maia
```

## Live external probe tests

Live tests against external bots/platforms must be disabled by default and require explicit opt-in. They should use strict quotas and should never branch recursively.

Suggested environment gates:

```text
RUN_LIVE_PROBE_TESTS=1
LICHESS_TOKEN=<provided outside repository>
```

Assertions should focus on safety and provenance, not on expecting a specific bot move.

## Safety tests

Safety tests are mandatory for any feature touching integrations.

Cover:

- ordinary scenario generation never calls a write-capable platform adapter;
- a `Decision` does not become a platform action;
- external writes, if ever added, require a separate explicit command path;
- logs redact token-like values;
- external probe quotas are enforced;
- HumanPath does not substitute Stockfish for Maia silently;
- coach output cannot claim unavailable provenance.

## Golden tests

Golden files are useful for coaching output shape, but should be stable and factual. Avoid golden tests that depend on exact long LLM prose. Prefer structured snapshots:

- line labels;
- source sequence;
- move list;
- provenance summaries;
- warning flags;
- coaching bullet categories.

## Requirement-to-test mapping

Every accepted OpenSpec scenario should have at least one corresponding test when implementation exists. Test names or metadata should reference the capability and scenario.

Example mapping:

| Spec scenario | Test example |
|---|---|
| Reject an illegal candidate | `scenarioLine_rejectsIllegalSeed_beforeInvokingEngines` |
| External idea remains a one-move attribution | `externalAlienSeed_doesNotLabelContinuationAsAlien` |
| Reject unlabelled adapter output | `moveProvenance_rejectsUnlabelledAdapterOutput` |
| A decision does not play a move | `analysisSession_neverSubmitsMoveToPlatform` |

## Verification commands

When scripts exist, completion should run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

If a command is a placeholder or cannot run because implementation is absent, report that explicitly and describe the remaining verification gap.
