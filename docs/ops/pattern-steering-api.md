# Pattern steering API

Pattern steering is an opt-in benchmark mode. It does not change the live
`/v1/style-lines/jobs` endpoint.

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
attacker plies and Maia defender plies. Omitted mode or `posthoc` keeps the
legacy ABSURD/EXTREME batch contract.

## CLI

```bash
npm run pattern:experiment -- \
  --dataset datasets/pattern-mvp-lichess.jsonl \
  --provider remote --subset 100 --maia3-elo 1800
```

The old line-selection benchmark is explicit:

```bash
npm run pattern:legacy-posthoc -- --dataset datasets/pattern-mvp-lichess.jsonl
```

Before a remote run, update and restart the Windows server. A batch POST must
return `202`, not `404`; `404` means the tunnel reaches an old server build.
