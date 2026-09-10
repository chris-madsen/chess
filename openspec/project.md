# Project Context: Chess Trainer

## Product purpose

Chess Trainer is an interactive chess coach for a player who wants to improve practical chess strength against human-like opponents. The product focuses on the thinking process after an opponent move: the player should articulate an assessment, plan, candidate moves, and uncertainty before receiving generated lines.

The system then builds explicitly sourced `ScenarioLine` objects and coaching explanations. It must improve the player's ability to evaluate positions, choose plans, calculate forcing moves, and convert advantages against people. It must not become an autonomous chess-playing system.

## Core problem

A plain LLM chess conversation is unreliable because it may:

- lose track of the board state;
- forget which pieces remain;
- suggest illegal moves;
- miss checks, captures, and immediate tactical refutations;
- treat a human-like Maia reply as if it were best defense;
- call a mixed-source teaching line a bot or engine line;
- overstate certainty or invent provenance.

Chess Trainer solves this by making chess state, move legality, source ordering, and provenance explicit data. The LLM coach explains and compares; it is not trusted as the source of legal moves or factual engine output.

## Target user outcome

The player should learn to answer practical questions such as:

- What changed after the opponent's move?
- What is my assessment of material, king safety, pawn structure, activity, and threats?
- What candidate moves fit my plan?
- Which candidate is tactically unsafe?
- How might a human opponent around the target rating respond?
- What continuation keeps my idea coherent?
- When should I simplify into an endgame instead of continuing an attack?

The product should make the player's reasoning visible enough to coach it.

## Domain model in plain language

### Player

The human using the trainer. The Player owns strategic intent and final decisions. A recorded `Decision` is an analysis artifact, not a command to play on a platform.

### LeelaAlien

LeelaAlien is a public Lichess bot commonly described as playing unexpected or low-human-expectation moves. In this project it is not treated as an analysis API and not treated as a source of principal variations.

If the system obtains one actual move from LeelaAlien in a bounded external probe from the same `PositionSnapshot`, that move may become one `CandidateSeed` with `LEELA_ALIEN_PROBE` provenance. Later plies are not attributed to LeelaAlien unless they were actually played by LeelaAlien in the same observed game record.

### Boris-Trapsky

Boris-Trapsky is a public Lichess bot commonly described as choosing interesting, tricky, practical moves after estimating the opponent. In this project it is an optional idea source, not a trusted full-line generator.

If a bounded probe observes one legal Boris-Trapsky move from the same position, that move may become a `CandidateSeed` with `BORIS_TRAPSKY_PROBE` provenance.

### Maia

Maia is a human-like chess model intended to predict likely human moves at a target strength. In default HumanPath mode, Maia supplies the opponent plies. A Maia move means "a modeled likely human response", not "objectively best defense".

The Maia adapter must record model identity, rating target, weights/configuration, request ID, timestamp when available, and selection policy.

### Stockfish 19 NNUE

Stockfish 19 NNUE is the strong calculation engine used to continue the player's side and to check tactical safety. In default HumanPath mode it should help answer: "If the opponent responds like Maia, how can the player continue strongly?"

Stockfish can also be used in a separately labelled `AdversarialCheck` mode to search for refutations or strongest defenses. That mode must not overwrite HumanPath output.

### LLM coach

The LLM coach turns structured data into useful explanations. It may compare candidate lines, point out patterns, ask coaching questions, and summarize risks. It must not invent moves, evaluations, request IDs, engine settings, or external observations.

## Default scenario protocol

For a position in which the player is to move:

```text
CandidateSeed -> Maia response -> Stockfish continuation -> Maia response -> Stockfish continuation -> ...
```

The seed may come from:

- `PLAYER_IDEA` — the player proposed the move;
- `LEELA_ALIEN_PROBE` — an actual LeelaAlien move was observed;
- `BORIS_TRAPSKY_PROBE` — an actual Boris-Trapsky move was observed;
- `IMPORTED` — an explicitly identified external record;
- `PUZZLE_TARGET` — a known puzzle solution source when operating in puzzle mode.

The line stops at horizon, checkmate, stalemate, draw by rule, provider error, or explicit user stop.

## Source-of-truth hierarchy

When documents or behavior conflict, use this order:

1. Accepted canonical specs in `openspec/specs/`.
2. Accepted ADRs in `docs/decisions/`.
3. Tests explicitly mapped to accepted scenarios.
4. Current implementation.
5. README and examples.
6. Historical chat logs such as `/home/ilja/Music/chess.md`.

Historical chat logs provide context and intent, but they are not canonical requirements until distilled into specs, ADRs, or documentation.

## Technology preferences

- TypeScript on Node.js 22+.
- Data-oriented, anemic domain model.
- Pure functions for domain policy.
- Discriminated unions for variants and errors.
- Reader-style dependency injection through ports.
- Anti-corruption layers around engines, model runtimes, Lichess, storage, and LLM providers.
- Tests focused on deterministic domain behavior; live engines and public bots only in opt-in integration suites.

## Design principles

- Validate and freeze all external input at boundaries.
- Treat expected failures as data (`Result`-style), not hidden exceptions.
- Do not call time, UUID, network, filesystem, child processes, or engines from the domain core.
- Keep event/log records append-only and structured.
- Store provenance with the move, not only in prose.
- Fail closed when legality, provenance, engine readiness, or safety checks fail.

## Out of scope for default operation

- Autoplay or silent move submission.
- High-volume public bot probing.
- Recursive online tree search through disposable games.
- Claiming external bots produce lines unless a complete observed game record supports it.
- Training a new chess neural network as part of the basic trainer.
- Treating Stockfish as the default model of human opponent behavior.
