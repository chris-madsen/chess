# Capability: Game Integration

## Purpose

Import positions and games for analysis while protecting Player agency and external-platform integrity.

## Requirement: Read-only analysis integration

Game Integration SHALL be read-only during ordinary analysis.

### Scenario: Import a game position

- GIVEN a supported external game reference, PGN, or FEN
- WHEN Game Integration imports a PositionSnapshot
- THEN the snapshot is validated and passed to Scenario Analysis
- AND no challenge, game, chat message, resign, abort, draw offer, or move submission is sent externally.

### Scenario: Reject unsupported platform reference

- GIVEN an unsupported or malformed external game reference
- WHEN import is requested
- THEN the system returns a structured import error
- AND no write-capable platform API is called.

## Requirement: Separate external writes

### Scenario: Reject implicit move submission

- GIVEN a Decision exists in an AnalysisSession
- WHEN ordinary analysis completes
- THEN Game Integration does not submit the Decision to any platform.

### Scenario: Future write capability requires explicit path

- GIVEN a future implementation adds platform writes
- WHEN ordinary analysis requests are executed
- THEN they still cannot reach the write path
- AND write behavior is available only through a separately specified, named, confirmed, and audited command.

## Requirement: Protect credentials

Credential-bearing data SHALL remain outside domain records, logs, fixtures, and coaching output.

### Scenario: Token-like value appears in adapter response

- GIVEN an adapter receives a token-like or authorization value
- WHEN it writes logs or errors
- THEN the value is redacted
- AND tests can verify the redaction pattern.

## Requirement: Bound external probes

External bot probes SHALL be explicit, bounded, and recorded.

### Scenario: Probe one external bot for one first move

- GIVEN the Player opts into an external probe
- AND quota allows the request
- WHEN the system asks LeelaAlien or Boris-Trapsky from a PositionSnapshot
- THEN the system records the probe metadata
- AND at most the actually observed first move is converted to a CandidateSeed.

### Scenario: Prevent recursive online tree probing

- GIVEN an external probe has produced a CandidateSeed
- WHEN HumanPath generation continues
- THEN later plies use Maia and Stockfish according to HumanPath
- AND the system does not create new external games for every branch continuation.
