# Event Storming

## Notation

| Type | Meaning |
|---|---|
| Command | Intention to change domain state |
| Domain Event | Immutable fact that occurred |
| Policy | Rule reacting to command/event |
| Read Model | Projection used for decisions or UI |
| Hotspot | Risk or unresolved design pressure |

## Player Coaching

| Commands | Events | Policies | Hotspots |
|---|---|---|---|
| `StartAnalysisSession`, `RecordPlayerReasoning`, `RecordDecision` | `AnalysisSessionStarted`, `PlayerReasoningRecorded`, `DecisionRecorded` | Decision never submits a move; incomplete reasoning is explicit | Coach prose may overstate certainty |

Aggregate: `AnalysisSession`. Value objects: `PlayerAssessment`, `PlayerPlan`, `Decision`.

## Position Intelligence

| Commands | Events | Policies | Hotspots |
|---|---|---|---|
| `IngestPosition`, `ParseMove`, `ComputePositionFacts` | `PositionIngested`, `MoveParsed`, `PositionFactsComputed` | Invalid FEN and illegal moves fail closed | Tactical facts must not become engine evaluation |

Aggregate: `PositionSnapshot`. Value objects: `Fen`, `LegalMove`, `PositionHash`, `PositionFacts`.

## Scenario Analysis

| Commands | Events | Policies | Hotspots |
|---|---|---|---|
| `AcceptCandidateSeed`, `GenerateHumanPath`, `AppendScenarioPly` | `CandidateSeedAccepted`, `ScenarioLineStarted`, `ScenarioPlyAccepted`, `ScenarioLineCompleted`, `ScenarioLineIncomplete` | Source order is CandidateSeed, Maia, Stockfish, Maia, Stockfish | Provider substitution can silently change product behavior |

Aggregate: `ScenarioLine`. Value objects: `ScenarioHorizon`, `PlyIndex`, `MoveProvenance`.

## Engine Execution

| Commands | Events | Policies | Hotspots |
|---|---|---|---|
| `RequestMaiaMove`, `RequestStockfishMove` | `ProviderMoveReturned`, `ProviderTimedOut`, `ProviderRejected` | Provider output is untrusted until legal and provenanced | Real runtimes may drift by version/configuration |

Aggregate: `ProviderRun`. ACL: provider ports.

## External Idea Probe

| Commands | Events | Policies | Hotspots |
|---|---|---|---|
| `RequestExternalSeed`, `CreateProbeChallenge`, `StreamProbeGame`, `SubmitRelayMove`, `RecordObservedBotMove`, `CleanupProbeGame` | `ExternalProbeStarted`, `ProbeChallengeCreated`, `ProbeGameStreamed`, `ProbeRelayMoveSubmitted`, `ExternalBotMoveObserved`, `ProbeGameCleanedUp`, `ExternalProbeRejected` | Opt-in, automated API game lifecycle, bounded, non-recursive, rate-limited | Public bots are playable opponents, not direct best-move endpoints |

Aggregate: `ExternalProbe`. ACL: future Lichess probe adapter.

## Run Registry

| Commands | Events | Policies | Hotspots |
|---|---|---|---|
| `RecordProviderRun`, `RecordScenarioRun` | `ProviderRunRecorded`, `ScenarioRunRecorded` | Append-only reproducibility facts | Secrets must be redacted |

Aggregate: `ProviderRun`. Read model: provenance summaries.

## Puzzle Training

| Commands | Events | Policies | Hotspots |
|---|---|---|---|
| `StartPuzzleAttempt`, `SubmitPuzzleMove`, `ClassifyPuzzleAttempt` | `PuzzleAttemptStarted`, `PuzzleMoveSubmitted`, `PuzzleAttemptClassified` | Checks/captures/threats before strategy prose | Puzzle goals differ from HumanPath coaching |

Aggregate: `PuzzleAttempt`. Future context; no implementation in this increment.

## Pattern Intelligence

| Commands | Events | Policies | Hotspots |
|---|---|---|---|
| `AnalyzePatternLine`, `ScorePatternProgress`, `RerankCandidatePool`, `VerifyForcedMate` | `PatternAnalysisStarted`, `PatternAssessmentProduced`, `PatternProgressObserved`, `HumanReachabilityEstimated`, `ForcedMateVerified`, `PatternSteeringDisabled` | Pattern facts never replace legality/provenance; forced mate has precedence | Family definitions may overfit exact positions; verifier and scorer must stay separate |

Aggregate: `PatternAssessment`. Value objects: `PatternFamily`, `PatternProgress`, `HumanReachability`, `MateVerification`.

## Analysis Cache

| Commands | Events | Policies | Hotspots |
|---|---|---|---|
| `LookupAnalysisState`, `StoreAnalysisState`, `ReuseRolloutSuffix` | `AnalysisCacheHit`, `AnalysisCacheMiss`, `PartialCacheReuse`, `RolloutSuffixReused`, `CacheEntryRejected` | Configuration fingerprints and rule/history context are mandatory; cache failure falls back to explicit recomputation | Stale provider settings, concurrent writers, and history-aware Maia semantics |

Aggregate: `CacheEntry`. Value objects: `ZobristPositionKey`, `RuleContext`, `HistorySignature`, `AnalysisCacheKey`.
