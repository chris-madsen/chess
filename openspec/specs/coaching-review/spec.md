# Capability: Coaching Review

## Purpose

Explain scenario lines as a coaching conversation without concealing uncertainty or turning the system into an autonomous decision-maker.

## Requirement: Separate facts from interpretation

CoachAssessment SHALL distinguish observed moves, modeled moves, engine outputs, imported records, and LLM interpretation.

### Scenario: Explain a mixed-source line honestly

- GIVEN a ScenarioLine seeded by a LeelaAlien observed move and continued by Maia and Stockfish
- WHEN CoachAssessment is generated
- THEN it identifies the first move as the observed LeelaAlien idea
- AND identifies Maia plies as modeled likely human responses
- AND identifies Stockfish plies as engine continuations
- AND does not claim that LeelaAlien calculated the full line.

### Scenario: Refuse to invent missing evaluation

- GIVEN a ScenarioLine has no engine evaluation field for a move
- WHEN CoachAssessment discusses the move
- THEN it may discuss qualitative plans and risks
- AND it does not invent a centipawn score, win probability, or mate distance.

## Requirement: Coach the player's reasoning

CoachAssessment SHALL compare generated evidence to the Player's original assessment and plan.

### Scenario: Compare the player plan to a line

- GIVEN PlayerAssessment and PlayerPlan are present
- WHEN CoachAssessment reviews ScenarioLines
- THEN it explains which elements of the plan are supported, challenged, or untested
- AND it offers practical questions and risks rather than only numeric engine evaluation.

### Scenario: Identify tactical discipline gaps

- GIVEN a line contains checks, captures, forced recaptures, or attacked high-value pieces
- WHEN CoachAssessment is generated
- THEN it highlights relevant forcing moves
- AND explains whether the Player's plan accounted for them.

### Scenario: Explain simplification decisions

- GIVEN a scenario line trades into an endgame
- WHEN CoachAssessment reviews the line
- THEN it explains the endgame model in human terms such as king activity, passed pawns, opposition, square rule, or blockade
- AND avoids overstating the level of play implied by engine accuracy alone.

## Requirement: Preserve player agency

### Scenario: Recommendation is non-executing

- GIVEN CoachAssessment recommends one CandidateSeed as practical
- THEN it labels the recommendation as advice
- AND it does not submit or schedule a move.

### Scenario: Encourage player decision

- GIVEN several scenario lines have been reviewed
- WHEN CoachAssessment concludes
- THEN it can ask the Player to choose or revise a move
- AND it must not claim the system has made the final decision.

## Requirement: Display uncertainty

CoachAssessment SHALL show uncertainty when evidence is incomplete or provider output is limited.

### Scenario: Partial line due to provider failure

- GIVEN a ScenarioLine is incomplete because a provider timed out
- WHEN CoachAssessment is generated
- THEN it marks the line as partial
- AND does not extrapolate missing moves as facts.
