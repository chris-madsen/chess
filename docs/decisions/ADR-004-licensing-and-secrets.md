# ADR-004: Isolate Engines, Track Licenses, and Protect Secrets

## Status

Accepted

## Context

Chess engines and neural-network weights have independent licenses and operational requirements. External bot/platform access can require tokens that must never enter repository history or user-facing logs.

## Decision

Use anti-corruption layers around engines and platforms. Prefer isolated engine processes communicating through documented protocols such as UCI. Maintain a manifest of binary/version, model weight identity, source URL or registry reference, hash when available, and license/terms. Store credentials outside the repository and redact them from logs.

## Consequences

- Domain code remains independent of engine implementation and license-specific operational details.
- Releases require a license review for bundled binaries, weights, containers, and network-service obligations.
- Tests use fixtures and environment-variable names, never real credentials.
