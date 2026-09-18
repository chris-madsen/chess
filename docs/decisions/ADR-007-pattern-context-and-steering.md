# ADR-007: Contextual Pattern Recognition and Bounded Steering

## Status

Accepted — supersedes the runtime/cache scope of ADR-006.

## Decision

Pattern analysis starts from immutable attacker context and shares a relevance-aware relational/canonical context between matchers and Pattern cache keys. Runtime steering discovers families and evaluates legal candidate moves before rollout commitment. Patricia MultiPV is a root-candidate source, not a CSTal line, and Maia response semantics plus independent forced-mate verification remain separate.

Recognition, trajectory proximity, engine outcome, and forced-mate proof are separate facts. Batch execution is bounded and sibling jobs are isolated; ordinary StylePath cancellation semantics remain unchanged.
