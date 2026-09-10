# Boundary Schemas

## Rules

Boundary schemas convert unstable outside data into domain ADTs once. ACL functions validate, normalize, and return `Result`; they do not make product decisions beyond rejecting invalid input.

## ACL 1: Chess rules library to Position Intelligence

Outside: `chess.js` objects, SAN/UCI strings, FEN text.

Inside:

```ts
PositionSnapshot
LegalMove
PositionFacts
```

Forbidden leakage: raw `Chess` instances in domain records.

## ACL 2: Engine providers to Scenario Analysis

Outside: UCI transcripts, process status, model runtime output.

Inside:

```ts
ProvidedMove
ProviderError
MoveProvenance
```

Forbidden leakage: UCI protocol lines in domain types.

## ACL 3: External bot/platform to External Idea Probe

Outside: Lichess API responses, challenge responses, game stream events, game IDs, bot profiles.

Inside:

```ts
CandidateSeed
ExternalProbeRecord
```

Forbidden leakage: raw authorization headers, platform response shapes. The ACL owns automated challenge creation, stream handling, relay moves, and cleanup; callers receive only domain probe results.

## ACL 4: Persistence to Run Registry

Outside: database rows, filesystem paths.

Inside:

```ts
ScenarioRunRecord
ProviderRunRecord
```

Forbidden leakage: driver-specific row models in domain.

## ACL 5: LLM provider to Coaching

Outside: provider prompts/responses.

Inside:

```ts
CoachAssessment
```

Forbidden leakage: LLM output as factual move provenance.
