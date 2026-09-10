# Threat Model and Safety Boundaries

## Scope

This document covers product safety, platform integrity, provenance integrity, secret handling, and abuse risks for Chess Trainer. It is not a complete infrastructure security review, but it defines the safety invariants implementation must preserve.

## Assets to protect

- Player agency and the distinction between coaching and automated play.
- Accurate move provenance and reproducible analysis.
- The integrity of external platforms such as Lichess.
- Public bots from abusive probing or game spam.
- Lichess and other external-platform credentials.
- Local engine/model binaries and model weights.
- License records and compliance evidence.
- Player game history, private notes, and training data.
- Trust in coaching explanations.

## Trust boundaries

| Boundary | Untrusted input | Required control |
|---|---|---|
| Player input -> domain | FEN, PGN, SAN/UCI moves, prose | Parse, validate, freeze, reject invalid shapes |
| Engine process -> application | UCI output, logs, bestmove text | Parse, legality-check, require provenance |
| Maia runtime -> application | model output/probabilities | Validate legal move, record model config |
| External platform -> application | API responses, game records | Treat as data, validate, redact secrets |
| LLM -> user | coaching prose | Ground in structured facts, mark interpretation |
| Secrets -> logs/tests | tokens, headers, env vars | Redact and never commit |

## Primary threats and controls

| Threat | Control |
|---|---|
| The system silently plays or submits a move | Default integrations are read-only; move submission requires a future separate explicit command with confirmation and audit record |
| A generated line is falsely presented as a LeelaAlien or Boris-Trapsky PV | CandidateSeed provenance is limited to observed moves; each later ply stores actual source; rendering labels mixed lines as HumanPath |
| Maia response is silently replaced with Stockfish's best defense | HumanPath source order is validated; AdversarialCheck is separate and labelled |
| Engine produces malformed or illegal output | Validate FEN, side to move, UCI/SAN parsing, legal move membership, and provenance before accepting output |
| External probes create high-volume disposable games | Explicit opt-in, hard quotas, serialized requests, audit logs, and no recursive online tree search |
| Token or credential leaks | Environment variables/secret store, log redaction, no secrets in fixtures or repository |
| Model/version drift makes advice irreproducible | Persist engine version, binary hash when available, model/weight identity, settings, input hash, request ID, and timestamp |
| LLM invents factual engine/bot behavior | Coach instructions require grounding in product data; missing data is reported as unknown |
| GPL/AGPL or weight-license confusion | Maintain a model/license manifest and review distribution/network-service obligations before releases |
| User overtrusts engine-like advice | UI/prose states source, uncertainty, and that Player decides |
| Live-game cheating misuse | No ordinary external move submission; prompts and UI emphasize training, review, and human decision-making |

## Abuse cases

### Autoplay conversion

A future contributor might try to connect `Decision` directly to a Lichess move endpoint. This violates the product boundary. Any platform write must be a new named capability, disabled by default, with explicit confirmation and tests proving ordinary analysis cannot reach it.

### Fake bot-line attribution

A tempting shortcut is to ask LeelaAlien for one move and then call the Stockfish/Maia continuation a LeelaAlien line. This is forbidden. Only actually observed moves can be attributed to external bots.

### Silent provider substitution

If Maia is unavailable, falling back to Stockfish for opponent plies would change the training objective. The system must fail closed or clearly ask for a different analysis mode.

### Probe spam

Branching every candidate through public bots can create many games and harm external services. External probes must be opt-in, quota-limited, serialized, and non-recursive.

### Prompt injection through PGN/comments

Imported game comments or user text may contain instructions. Treat them as data, not system instructions. LLM prompts must separate quoted game/user content from operational instructions.

## Secret handling rules

- Do not commit `.env` files, tokens, private keys, cookies, or raw authorization headers.
- Do not print secrets in test failures or structured events.
- Redact token-like values before persistence unless stored in a dedicated secret store.
- Use fake values in fixtures and examples.
- Prefer environment variable names in docs, not real values.

## Safety acceptance checks

Before claiming a feature is complete, verify:

- ordinary analysis cannot call a write-capable platform adapter;
- every ScenarioLine move has source-specific provenance;
- HumanPath source order is test-covered;
- provider illegal output is rejected;
- Maia unavailable does not silently become Stockfish;
- external probes obey quota and do not recurse;
- logs and fixtures contain no secrets.
