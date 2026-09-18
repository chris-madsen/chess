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

Required families for the first benchmark are `ANASTASIA`, `BODEN`, `PILLSBURY`, `ARABIAN`, `SMOTHERED`, and `BACK_RANK`. The repository does not include copied `deadly` or puzzle data until its license and redistribution terms are verified.

The acceptance benchmark requires at least 300 independent cases with separate `calibration` and `evaluation` splits. Do not treat the runner's result as a positive MVP finding while the report is `INCONCLUSIVE` or forced-mate verification is unavailable.
