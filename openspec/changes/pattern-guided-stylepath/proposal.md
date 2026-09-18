# Change: Pattern-guided StylePath with state cache

## Summary

Add a Pattern Layer above the existing CSTal and Maia StylePath pipeline. The first increment introduces the domain contract for pattern analysis and a canonical Zobrist/state cache identity so repeated and transposed states can be reused safely.

## Motivation

The current Windows StylePath API produces provenance-bearing CSTal and Maia lines, but it has no shared vocabulary for pattern families, pattern progress, human reachability, forced-mate precedence, or reusable analysis state. Recomputing the same state across candidate rollouts would also waste engine and Maia capacity.

## Scope

- Define Pattern Intelligence and Analysis Cache concepts.
- Define canonical position identity using Zobrist state plus separate rule/history context.
- Add a cache port and a bounded in-memory adapter.
- Preserve existing StylePath and HumanPath behavior.
- Define the later candidate-pool, rollout, suffix-reuse, and forced-mate integration contract.

## Out of scope

- Modifying CSTal source or binaries.
- Fine-tuning Maia 79M.
- A Redis/PostgreSQL deployment adapter.
- Automatic external platform writes.
- Claiming a pattern result without structured evidence.
