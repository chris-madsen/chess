# Design

## Pattern context

`PatternAnalysisContext` fixes the attacker and defender sides for one analysis. `PatternPositionContext` is the single king-centric source of truth for escape squares, relevant pieces, and attack/defense/blocking relations. Canonicalization, family retrieval, matchers, and Pattern cache keys consume this context.

## Recognition and steering

Known-family scoring remains available only for labeled offline evaluation. Runtime retrieval returns ranked family candidates without a supplied family. Steering evaluates legal candidate moves before commitment, queries Maia for the modeled response, and reranks by post-response Pattern progress. Pattern similarity never becomes a forced-mate proof.

## Benchmark execution

The recognizer runs locally over all dataset entries without CSTal, Maia, or forced-mate verification. The expensive steering benchmark uses `/v1/pattern-experiments/batches` with a bounded Windows worker pool. The existing `/v1/style-lines/jobs` endpoint remains a single-latest interactive job endpoint.

## Dataset and metrics

Dataset entries preserve solution moves, puzzle trajectories, and expected terminal metadata. Calibration and evaluation are reported separately. Recognition, proximity, and steering metrics are separate result families and cannot be collapsed into BeautifulForcedCombination.
