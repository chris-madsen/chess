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

## Non-negotiable invariants

- The player remains the decision-maker. The system must not submit moves to Lichess, Maia, or another platform during ordinary analysis.
- The player should first provide their own assessment, plan, and one or more candidate moves whenever practical.
- A `ScenarioLine` is a modeled teaching line, not automatically an engine principal variation.
- LeelaAlien and Boris-Trapsky are external Lichess bots. They can supply only an actually observed first move (`CandidateSeed`) from a bounded probe. Never call a whole line a LeelaAlien or Boris-Trapsky line unless every move was actually played by that bot in one game.
- Maia is used to model likely human opponent responses. Do not silently replace Maia's modeled response with Stockfish's best defense in the default human-path scenario.
- Stockfish 19 NNUE provides strong continuations for the player's side after a Maia response. It is a calculation assistant and safety check, not the default decision-maker.
- Every move in every generated line must have `MoveProvenance`: source, model/engine identity, version, configuration, request ID, and timestamp when available.
- Never invent a bot move, a model response, an engine evaluation, or a game result.

## Architecture rules

- Use TypeScript and a data-oriented, anemic domain model.
- Model behavior through pure functions, discriminated unions, and explicit data. Prefer functional dispatch to inheritance hierarchies.
- Keep unstable vendors and protocols behind anti-corruption layers (ACLs): UCI engines, Maia runtime, external bot probes, and game-platform integrations.
- Dependency direction: `adapters -> application -> domain`. The domain may not import UCI, child-process, HTTP, database, Lichess, or vendor-specific code.
- Do not introduce a dependency for a trivial local abstraction.

## Specification-driven delivery

- For a new capability, behavior change, architecture change, safety change, external integration, or ambiguous request, create an OpenSpec change before implementation.
- Do not invent unspecified product behavior. If the specification is insufficient, identify the gap and ask one focused question.
- Update specs and tests whenever observable behavior changes.
- Do not edit accepted ADRs. Add a superseding ADR when a durable decision changes.

## Side effects, secrets, and safety

- Never commit API tokens, private keys, credentials, `.env` files, model secrets, or raw authorization headers.
- Normal analysis is read-only with respect to external chess platforms.
- External probes are opt-in, rate-limited, recorded, and may not recursively branch game trees.
- Validate FEN, move legality, UCI/SAN, and engine output before use.

## Completion

Before claiming completion, run the repository's configured typecheck, tests, lint, and build. Report commands that could not run, their reason, and the remaining verification gap.
