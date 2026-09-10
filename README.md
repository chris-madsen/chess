# Chess Trainer

Chess Trainer is a human-in-the-loop chess training and analysis system. It helps a player improve practical decision-making against human-like opponents by forcing a disciplined loop:

1. freeze the current position;
2. make the player state an assessment, plan, threats, and candidate moves;
3. generate legal, explicitly sourced scenario lines;
4. explain what the lines teach;
5. let the player make the final decision.

The product is a coach and analysis companion. It is not an autoplayer, cheating tool, or replacement for the player's judgement.

## Why this exists

A language model can know chess principles and still hallucinate a board state, forget a pawn, miss a forcing move, or attribute a line to the wrong source. Chess Trainer is designed as a reliability harness around coaching:

- chess state is stored as validated data, not memory;
- every move is checked for legality before use;
- every generated move carries provenance;
- Maia is used for likely human replies;
- Stockfish 19 NNUE is used for strong calculation and safety checks;
- external bots such as LeelaAlien or Boris-Trapsky can only contribute observed first-move ideas.

The target is practical training value, not engine supremacy.

## Default workflow

For a position where the player is to move:

1. **Position intake**
   - accept FEN, PGN position, or imported game reference;
   - validate side to move, castling rights, en-passant square, and legal move set;
   - create an immutable `PositionSnapshot`.
2. **Player-first reasoning**
   - record the player's material count, king safety view, pawn-structure notes, threats, plan, and candidate moves;
   - preserve the original wording for later coaching.
3. **Candidate seeds**
   - use one or more legal moves proposed by the player;
   - optionally add one observed first move from LeelaAlien or Boris-Trapsky through a bounded external probe;
   - reject illegal or unprovenanced seeds.
4. **HumanPath scenario generation**
   - start with a `CandidateSeed`;
   - ask Maia for the opponent's likely human reply;
   - ask Stockfish 19 NNUE for the player's strong continuation;
   - alternate Maia and Stockfish until horizon or game end.
5. **Coaching review**
   - explain strategic meaning, tactical risks, human practicality, and uncertainty;
   - compare scenario lines to the player's original plan;
   - clearly separate facts, model outputs, engine outputs, and LLM interpretation.
6. **Decision recording**
   - the player may record a chosen move;
   - the system does not submit the move to Lichess or any external platform during ordinary analysis.

## HumanPath is not a principal variation

A `ScenarioLine` is a modeled teaching line. It is not automatically a Stockfish PV, Maia PV, LeelaAlien line, or Boris-Trapsky line.

Default source sequence:

```text
CandidateSeed -> Maia -> Stockfish 19 NNUE -> Maia -> Stockfish 19 NNUE -> ...
```

Examples:

- If LeelaAlien actually plays `Nge2` in a bounded probe, only the first ply may be attributed to LeelaAlien.
- If Maia then predicts `...Nc6`, that ply is a Maia modeled reply.
- If Stockfish then suggests `f4`, that ply is a Stockfish continuation.
- The whole line is labelled `HumanPath ScenarioLine`, not `LeelaAlien PV`.

## Core safety boundaries

- The player remains the decision-maker.
- Ordinary analysis is read-only with respect to external chess platforms.
- External bot probing is opt-in, bounded, rate-limited, recorded, and never recursive tree search.
- No bot move, engine evaluation, model response, or game result may be invented.
- Maia replies must not be silently replaced by Stockfish defenses in default HumanPath mode.
- Every scenario-line move must include `MoveProvenance`.
- Secrets, tokens, raw authorization headers, engine credentials, and `.env` files must not be committed.

## Repository map

```text
AGENTS.md                         Coding-agent instructions and invariants
openspec/project.md               Product context and source-of-truth rules
openspec/specs/*/spec.md          Accepted behavioral specifications
docs/glossary.md                  Ubiquitous language and domain vocabulary
docs/context-map.md               DDD bounded contexts and relationships
docs/architecture.md              Components, data flow, ports, and boundaries
docs/threat-model.md              Safety, security, and abuse model
docs/testing.md                   Test strategy mapped to requirements
docs/decisions/                  Accepted ADRs; do not rewrite accepted history
```

## Implementation style

The intended implementation language is TypeScript. The domain should be data-oriented and functional:

- immutable records and discriminated unions;
- pure functions for validation, sequencing, and policy;
- application services as orchestration shells;
- adapters for UCI, Maia runtime, Lichess, persistence, and LLM calls;
- no vendor-specific types inside the domain.

Dependency direction:

```text
adapters -> application -> domain
```

## Read before building

Read these files in order:

1. `AGENTS.md`
2. `openspec/AGENTS.md`
3. `openspec/project.md`
4. `docs/glossary.md`
5. `docs/architecture.md`
6. `docs/decisions/INDEX.md` and relevant ADRs
7. relevant specs under `openspec/specs/`

