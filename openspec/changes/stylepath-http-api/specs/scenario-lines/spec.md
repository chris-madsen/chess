## Requirement: Expose StylePath through HTTP API

The system SHALL expose one-shot local StylePath generation through an authenticated HTTP API while preserving ScenarioLine provenance.

### Scenario: API returns structured StylePath lines

- GIVEN the HTTP API receives a valid FEN request
- AND authentication succeeds
- WHEN StylePath analysis completes
- THEN the response contains one result per configured style engine
- AND every ply includes UCI, SAN, source, provider identity, request ID, input position hash, and configuration.

### Scenario: API rejects invalid input before providers

- GIVEN the HTTP API receives malformed JSON, invalid FEN, invalid RAW SAN, or both FEN and RAW SAN
- WHEN the request is handled
- THEN it returns a structured error
- AND no style engine or Maia provider is called.
