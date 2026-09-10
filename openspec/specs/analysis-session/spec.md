# Capability: Analysis Session

## Purpose

Support a deliberate coaching loop in which the Player expresses reasoning before receiving generated scenario lines and explanations. The session is a learning container, not a game controller.

## Requirement: Start from a validated position

The system SHALL create an AnalysisSession only from a valid `PositionSnapshot`.

### Scenario: Start analysis from a valid position

- GIVEN a valid FEN or imported game position
- AND the position has a legal side to move
- WHEN the Player starts an AnalysisSession
- THEN the system stores a canonical `PositionSnapshot`
- AND records the position hash
- AND no external platform write is invoked.

### Scenario: Reject invalid position input

- GIVEN malformed FEN, inconsistent castling rights, impossible side-to-move state, or illegal move history
- WHEN the Player starts an AnalysisSession
- THEN the system rejects the request with a structured domain error
- AND no engine, Maia runtime, external probe, or platform write is invoked.

## Requirement: Capture player reasoning

The system SHALL allow an AnalysisSession to record the Player's assessment, plan, candidate moves, requested horizon, questions, and uncertainty.

### Scenario: Preserve the player's stated assessment

- GIVEN an active AnalysisSession
- WHEN the Player records material, king safety, pawn structure, threats, and evaluation notes
- THEN the original assessment text is retained
- AND later CoachAssessment may critique it without replacing the original.

### Scenario: Preserve the player's stated plan

- GIVEN an active AnalysisSession
- WHEN the Player records a PlayerPlan
- THEN the original plan text is retained with the session
- AND the plan is linked to any CandidateSeeds the Player associates with it.

### Scenario: Accept incomplete reasoning with an explicit marker

- GIVEN the Player cannot provide a full assessment
- WHEN the session records partial reasoning
- THEN missing sections are represented explicitly
- AND the coach may ask focused questions instead of inventing missing reasoning.

## Requirement: Candidate moves are parsed and validated

The system SHALL parse candidate move notation against the current position before using it as a `CandidateSeed`.

### Scenario: Accept legal player candidate

- GIVEN a valid PositionSnapshot
- AND the Player submits a legal move in supported notation
- WHEN the system ingests the candidate
- THEN it stores a canonical legal move
- AND attaches `PLAYER_IDEA` provenance.

### Scenario: Reject illegal player candidate

- GIVEN a valid PositionSnapshot
- AND the Player submits a move not legal in that position
- WHEN the system ingests the candidate
- THEN it rejects the candidate with an `ILLEGAL_MOVE` error
- AND the candidate is not used for ScenarioLine generation.

## Requirement: Keep decision separate from execution

A Player `Decision` SHALL be stored as analysis data only.

### Scenario: A decision does not play a move

- GIVEN a completed AnalysisSession with ScenarioLines
- WHEN the Player records a Decision
- THEN the selected move is stored as a Decision
- AND no move is submitted to an external chess platform.

### Scenario: Ordinary analysis cannot schedule a platform action

- GIVEN ordinary analysis mode
- WHEN any session workflow completes
- THEN no challenge, move, chat, resign, abort, or draw-offer command is created.
