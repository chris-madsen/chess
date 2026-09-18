# ADR-006: Canonical state cache for Pattern Layer

## Status

Accepted

## Context

Pattern-guided CSTal × Maia analysis will revisit positions through different candidate histories. The existing SHA-256 FEN hash is useful for compatibility and audit, but a reusable analysis cache needs explicit transposition identity and must not lose rule or Maia history context.

## Decision

The Pattern Layer uses a deterministic Zobrist position key for piece placement, side to move, castling rights, and en-passant state. Halfmove and history context remain separate fields. Cache access is exposed through an application port; domain code does not depend on filesystem, Redis, database, HTTP, or engine processes.

Cache namespaces distinguish position evaluation, Maia responses, pattern assessments, and complete rollout suffixes. Provider/model/policy configuration is part of the cache key. Exact and partial reuse are separate policies.

The initial adapter is bounded in-memory storage. Durable local and shared storage may be added behind the same port after benchmark evidence identifies the required deployment shape.

## Consequences

- Transpositions can be reused without treating different castling or en-passant states as equal.
- History-aware Maia results cannot be silently reused for a different input history.
- The current `PositionHash` remains stable for existing API/provenance consumers.
- Cache storage can evolve without importing storage dependencies into the domain.
