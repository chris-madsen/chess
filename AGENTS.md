# Chess Trainer — Instructions for AI Coding Agents

## Mission

Build a human-in-the-loop chess training and analysis system. The system helps a player articulate an assessment, plan, and candidate moves after Maia's move, then produces explicitly sourced scenario lines and coaching explanations. It must improve practical decision-making against human-like opponents; it is not an autonomous chess-playing or cheating tool.

## Read first

Before planning or editing code, read in order:

1. `AGENTS.md`
2. `openspec/AGENTS.md`
3. `openspec/project.md`
4. `docs/glossary.md`
5. `docs/architecture.md`
6. `docs/decisions/INDEX.md` and relevant ADRs
7. Relevant current specification under `openspec/specs/`
8. Relevant OpenSpec change under `openspec/changes/` when implementing an active change

## Non-negotiable invariants

- The player remains the decision-maker. The system must not submit moves to Lichess, Maia, or another platform during ordinary analysis.
- The player should first provide their own assessment, plan, and one or more candidate moves whenever practical.
- A `ScenarioLine` is a modeled teaching line, not automatically an engine principal variation.
- LeelaAlien and Boris-Trapsky are external Lichess bots. They can supply only an actually observed first move (`CandidateSeed`) from a bounded probe. Never call a whole line a LeelaAlien or Boris-Trapsky line unless every move was actually played by that bot in one game.
- Maia is used to model likely human opponent responses. Do not silently replace Maia's modeled response with Stockfish's best defense in the default human-path scenario.
- Stockfish 19 NNUE provides strong continuations for the player's side after a Maia response. It is a calculation assistant and safety check, not the default decision-maker.
- Every move in every generated line must have `MoveProvenance`: source, model/engine identity, version, configuration, request ID, and timestamp when available.
- Never invent a bot move, a model response, an engine evaluation, or a game result.
- Pattern steering SHALL NOT override a CSTal/Tal tactical veto. Pattern similarity is an attractor signal only after a candidate passes the Tal tactical gate.
- The production PatternSteeredTalPath repeats the attacker-side loop `CandidatePool -> TalGate -> PatternProgress -> commit`, with Maia responses on defender plies; Stockfish is not a substitute for Tal in this path.
- The legacy post-hoc PatternSelectionExperiment and legacy `assessPattern` scorer are benchmark-only and SHALL NOT be used as the production runtime steering path.

## Architecture rules

- Use TypeScript and a data-oriented, anemic domain model.
- Use the `refactor` workflow for implementation: functional core, imperative shell, ADTs, freeze/ingest boundaries, ports, structured events, fail-closed behavior, and stable Makefile entrypoints.
- Model behavior through pure functions, discriminated unions, ADTs, FSM transition tables, and explicit data. Prefer functional dispatch to inheritance hierarchies.
- Use DDD and hexagonal architecture: bounded contexts, aggregates, value objects, domain services, application ports, adapters, and anti-corruption layers.
- Keep unstable vendors and protocols behind ACLs: chess-rule libraries, UCI engines, Maia runtime, external bot probes, game-platform integrations, persistence, and LLM providers.
- Dependency direction: `adapters -> application -> domain`. The domain may not import UCI, child-process, HTTP, database, filesystem, Lichess, LLM, or vendor-specific code.
- Do not introduce a dependency for a trivial local abstraction. Prefer standard platform/project tools before custom machinery.

## Working rules

- Understand the user-visible outcome and real data flow before choosing a solution.
- Fix root causes, not symptoms. Do not hide failures by suppressing exceptions, fabricating success, deleting state, or adding retries before understanding the failure.
- Model types and data before implementation. Identify entities, states, relationships, invariants, owners, and boundary schemas before code that crosses boundaries.
- Preserve one canonical vocabulary and source of truth. Use `docs/glossary.md` terms consistently across specs, code, tests, and docs.
- Avoid instruction bloat. Add durable rules only when code, tests, schemas, or existing instructions cannot enforce the issue better.
- Generated artifacts are not source code. Edit the canonical source and run the generator when generated files exist.
- Prefer declarative and reproducible operations: manifests, migrations, scripts, Makefile targets, and idempotent commands over ad hoc mutation.
- Preserve authoritative state. Do not introduce shadow state that can diverge from the real owner without explicit synchronization policy.
- Design lifecycle explicitly for components that own processes, listeners, timers, subscriptions, or external resources. Provide start/stop or cleanup contracts when applicable.
- Keep changes small and reviewable. Do not mix unrelated cleanup, formatting, dependency upgrades, and behavior changes unless required for the requested outcome.
- Verification is part of implementation. Invoking a setter or seeing no exception is not evidence; test the authoritative boundary.
- Maintain living project knowledge. Update specs, ADRs, glossary, architecture, and tests when durable behavior or terminology changes.
- Preserve honest failure. Keep useful errors visible, causal, structured, and actionable. Never convert unknown or degraded state into success.
- Use security and safety defaults: validate every boundary, keep secrets out of logs/repo/UI, require explicit authorization for destructive or externally visible actions.

## Specification-driven delivery

- For a new capability, behavior change, architecture change, safety change, external integration, or ambiguous request, create an OpenSpec change before implementation.
- Do not invent unspecified product behavior. If the specification is insufficient, identify the gap and ask one focused question.
- Update specs and tests whenever observable behavior changes.
- Do not edit accepted ADRs. Add a superseding ADR when a durable decision changes.

## Bertrand-Meyer contracts

Use contract tests for important preconditions, postconditions, and invariants:

- preconditions reject invalid FEN, illegal moves, missing provenance, wrong source order, and unsafe external writes before side effects;
- postconditions guarantee accepted moves are legal, provenance is attached, terminal states stop generation, and errors preserve causal context;
- invariants make impossible states unrepresentable where practical through ADTs and FSMs.

## Side effects, secrets, and safety

- Never commit API tokens, private keys, credentials, `.env` files, model secrets, or raw authorization headers.
- Normal analysis is read-only with respect to external chess platforms.
- External probes are automated Lichess API game probes, not manual UI work: create/accept a bounded casual game, stream the game, observe the target bot's actual move, record provenance, and clean up safely. They are opt-in, rate-limited, recorded, and may not recursively branch game trees.
- Validate FEN, move legality, UCI/SAN, and engine output before use.

## Completion

Before claiming completion, run the repository's configured typecheck, tests, lint, and build. Report commands that could not run, their reason, and the remaining verification gap.

A task is complete only when the requested outcome is implemented, the root cause or intended architecture is addressed, relevant tests/checks pass, documentation is updated, no unrelated user changes are overwritten, and remaining risks are stated clearly.
