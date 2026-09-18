# Change: Pattern-guided StylePath with state cache

## Summary

Add a Pattern Layer above the existing CSTal and Maia StylePath pipeline. The first experiment tests whether an external selector can improve the rate of recognizable, terminal, and independently verified mating combinations without changing CSTal, Maia, or using MultiPV.

## Motivation

The current Windows StylePath API produces provenance-bearing CSTal and Maia lines, but it has no shared vocabulary for pattern families, pattern progress, human reachability, forced-mate precedence, or reusable analysis state. Recomputing the same state across candidate rollouts would also waste engine and Maia capacity.

## Scope

- Define Pattern Intelligence, PatternSelectionExperiment, and Analysis Cache concepts.
- Define canonical position identity using Zobrist state plus separate rule/history context.
- Add a cache port and a bounded in-memory adapter.
- Score the 19 Lichess mate-theme families with deterministic symbolic features.
- Keep mate-family taxonomy metadata separate from tactical motifs and future extended families.
- Compare existing CSTal ABSURD and CSTal EXTREME trajectories using a prefix-only selector.
- Produce paired metrics and an explicit SUCCESS/FAILURE/INCONCLUSIVE report.
- Preserve existing StylePath and HumanPath behavior.
- Define the later candidate-pool, rollout, suffix-reuse, and forced-mate integration contract.

## Out of scope

- Modifying CSTal source or binaries.
- Fine-tuning Maia 79M.
- A Redis/PostgreSQL deployment adapter.
- MultiPV or a large candidate pool.
- A positive experimental conclusion before independent forced-mate verification and the required corpus exist.
- Automatic external platform writes.
- Claiming a pattern result without structured evidence.
