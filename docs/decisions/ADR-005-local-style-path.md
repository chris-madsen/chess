# ADR-005: Local StylePath engines for first CLI increment

## Status

Accepted

## Context

Public Lichess bots are not reliable as default analysis providers because their owners and bot policies decide whether challenges are accepted. The trainer needs reproducible local idea generation while preserving Maia as the human-like opponent model.

## Decision

The first CLI analysis mode uses local self-hosted UCI style engines for the Player side and Maia 1900 for the Opponent side:

```text
LocalStyleEngine -> Maia 1900 -> LocalStyleEngine -> Maia 1900 -> ...
```

The CLI produces independent `StylePath` lines for Patricia, Jackal, and Seer. Stockfish 19 and Lichess external probes are not used by this mode. CSTal variants are deferred until a supported Wine or Linux runtime is configured.

## Consequences

- Local StylePath analysis is reproducible and read-only with respect to external chess platforms.
- Every move still requires provenance and legality validation.
- HumanPath with player CandidateSeed remains a separate domain concept, but the first CLI focuses on engine-seeded StylePath analysis.
