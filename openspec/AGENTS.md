# OpenSpec Instructions

## Purpose

OpenSpec is the behavior contract for Chess Trainer. It converts product decisions into testable requirements before code changes are made.

## When an OpenSpec change is required

Create a change before implementation when work:

- adds a capability;
- changes user-visible coaching behavior;
- changes source ordering in scenario lines;
- changes provenance requirements;
- adds or replaces an engine/model/provider;
- adds an external integration;
- changes safety boundaries or external write behavior;
- changes persistence or reproducibility contracts;
- changes domain terminology in a way that affects code or tests.

Documentation elaboration that does not change behavior may update accepted docs directly. If the elaboration introduces a new requirement, add or update the relevant spec before implementation.

## Workflow

1. Read `../AGENTS.md`, `project.md`, relevant accepted specs, glossary, architecture, and ADRs.
2. Create a change directory under `openspec/changes/<change-id>/`.
3. Write `proposal.md`, `design.md` when needed, `tasks.md`, and spec deltas.
4. State observable requirements using GIVEN / WHEN / THEN scenarios.
5. Implement only approved tasks.
6. Add or update tests mapped to scenarios.
7. Verify behavior.
8. Update canonical specs after acceptance.
9. Archive the change after integration.

## Domain naming rules

Use the ubiquitous language from `../../docs/glossary.md`. Do not use these terms interchangeably:

- `ScenarioLine`
- `PrincipalVariation`
- `CandidateSeed`
- `ExternalProbe`
- `HumanPath`
- `AdversarialCheck`
- `CoachAssessment`
- `Decision`
- `PlatformCommand`

In particular, a `ScenarioLine` is a mixed-source teaching model and must disclose `MoveProvenance` for every ply.

## Spec style

Use this shape:

```text
## Requirement: <observable rule>

The system SHALL ...

### Scenario: <short behavior name>

- GIVEN ...
- AND ...
- WHEN ...
- THEN ...
- AND ...
```

Prefer concrete observable requirements over implementation details. If an implementation detail is required for safety or architecture, state why.

## Safety language

Use explicit prohibitions for safety-critical behavior:

- SHALL NOT submit moves during ordinary analysis.
- SHALL NOT invent provenance.
- SHALL NOT recursively probe external bots.
- SHALL reject illegal provider output.
- SHALL label Maia plies as modeled human-likelihood.
