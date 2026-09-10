# Design: DDD Hexagonal Domain Skeleton

## Architecture

The implementation follows functional core / imperative shell.

- `domain` owns immutable ADTs, value objects, pure policies, event builders, and FSM transition tables.
- `application` owns use-case orchestration and ports.
- `adapters` own vendor-specific details, initially only `chess.js`.
- `tests` own contract evidence.

Dependency direction is `adapters -> application -> domain`.

## Bounded contexts

- Player Coaching records reasoning and decisions.
- Position Intelligence validates positions and derives board facts.
- Scenario Analysis builds HumanPath lines.
- Engine Execution is represented by ports and fake providers in this change.
- External Idea Probe is represented by source/provenance types only.
- Run Registry is represented by run/request identifiers and provenance metadata.
- Puzzle Training is documented as a separate future mode.

## State machines

`AnalysisSessionFSM` prevents decisions before review and generation before seeds. `ScenarioLineFSM` prevents provider calls before seed acceptance and prevents continuing after terminal or failed states.

## Contracts

Bertrand-Meyer contracts are expressed as tests:

- preconditions reject bad input before side effects;
- postconditions verify accepted data is canonical and legal;
- invariants keep provenance, source order, and read-only safety intact.
