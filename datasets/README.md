# Pattern MVP dataset

The experiment runner consumes versioned JSONL. Dataset entries are source data, not generated artifacts, and must include provenance/licensing metadata.

Each line has this shape:

```json
{
  "caseId": "anastasia-0001",
  "split": "evaluation",
  "fen": "<canonical FEN>",
  "family": "ANASTASIA",
  "source": {
    "kind": "licensed-dataset",
    "reference": "source identifier or URL",
    "license": "license identifier"
  },
  "expected": {
    "terminalMate": true,
    "mateLength": 5
  }
}
```

The MVP Lichess core catalog contains these 19 families: `ANASTASIA`, `ARABIAN`, `BACK_RANK`, `BALESTRA`, `BLIND_SWINE`, `BODEN`, `CORNER`, `DOUBLE_BISHOP`, `DOVETAIL`, `EPAULETTE`, `HOOK`, `KILL_BOX`, `PILLSBURY`, `MORPHYS`, `OPERA`, `SMOTHERED`, `SWALLOWTAIL`, `TRIANGLE`, and `VUKOVIC`. Their generic canonical definitions are owned by the domain catalog; source keys and direct training links are application-boundary metadata.

The repository does not include copied `deadly` or puzzle data until its license and redistribution terms are verified. Catalog metadata is not evidence that a family has positive seeds or a completed benchmark corpus; those remain explicit dataset work.

The acceptance benchmark requires at least 300 independent cases with separate `calibration` and `evaluation` splits. Do not treat the runner's result as a positive MVP finding while the report is `INCONCLUSIVE` or forced-mate verification is unavailable.
