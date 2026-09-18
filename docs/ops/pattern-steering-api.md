# Pattern steering API

Pattern steering is an opt-in benchmark mode. It does not change the live
`/v1/style-lines/jobs` endpoint.

The current catalog has 19 steerable approximate attractors and 15
catalog-only families. The latter are retained for dataset/provenance labels
but are not silently used by production steering.

CSTal ABSURD is the explicit unified tactical safety judge for the current MVP;
EXTREME and Patricia candidates must pass its relative-to-best Tal safety gate.

## Remote batch

```json
POST /v1/pattern-experiments/batches
{
  "datasetVersion": "pattern-mvp-lichess-2026",
  "mode": "steering",
  "concurrency": 2,
  "cstalOpponent": "maia3",
  "maia3Elo": 1800,
  "maxFullMoves": 8,
  "cases": [{"caseId":"case-1", "fen":"..."}]
}
```

Read `GET /v1/pattern-experiments/batches/{batchId}/events` until the
`complete` event. Steering results contain `steeringLine` with Tal-gated
attacker plies, Maia defender plies, and `decisionTraces` with per-candidate
Tal scores and PatternAffinity values. Omitted mode or `posthoc` keeps the
legacy ABSURD/EXTREME batch contract.

## CLI

```bash
npm run pattern:experiment -- \
  --dataset datasets/pattern-mvp-lichess.jsonl \
  --provider remote --subset 100 --maia3-elo 1800
```

The CLI prints each completed steering line as SAN while the batch is running,
then writes the same structured lines to the JSONL artifact. Dataset cases are
FEN-based benchmark positions, so their output starts at the case position. A
raw PGN input keeps its full SAN prefix in `PositionSnapshot` and appends the
generated continuation; the Maia UCI history remains in the position command.

To steer the current game from a raw PGN/SAN file, use:

```bash
npm run pattern:experiment -- \
  --raw-file game.txt --provider remote --maia3-elo 1800
```

Raw-game steering defaults to an 80-full-move continuation so that a line can
reach mate instead of stopping at the short dataset horizon. Use
`--horizon-full-moves` to set a smaller or larger bounded guard explicitly.
Dataset benchmark cases retain the default 8-full-move horizon.

The old line-selection benchmark is explicit:

```bash
npm run pattern:legacy-posthoc -- --dataset datasets/pattern-mvp-lichess.jsonl
```

Before a remote run, update and restart the Windows server. A batch POST must
return `202`, not `404`; `404` means the tunnel reaches an old server build.
