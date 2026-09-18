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

The MVP core catalog contains 19 families: `ANASTASIA`, `ARABIAN`, `BACK_RANK`, `BALESTRA`, `BLIND_SWINE`, `BODEN`, `CORNER`, `DOUBLE_BISHOP`, `DOVETAIL`, `EPAULETTE`, `HOOK`, `KILL_BOX`, `PILLSBURY`, `MORPHYS`, `OPERA`, `SMOTHERED`, `SWALLOWTAIL`, `TRIANGLE`, and `VUKOVIC`. The extended catalog adds 15 named families: `DAMIANO`, `GRECO`, `LOLLI`, `LEGAL`, `BLACKBURNE`, `ANDERSSEN`, `MAYET`, `RETI`, `MAX_LANGE`, `SUFFOCATION`, `LAWNMOWER`, `DAVID_GOLIATH`, `TWO_KNIGHTS`, `H_FILE`, and `DIAGONAL_CORRIDOR`. Their generic canonical definitions are owned by the domain catalog; source keys and direct training links are application-boundary metadata.

The separate tactical motif catalog contains 15 mechanisms, including attraction, clearance, deflection, discovered attack/check, double check, interference, pin, sacrifice, skewer, x-ray attack, capturing defender, exposed king, kingside attack, and attacking f2/f7. Motifs are not `PatternFamily` values.

The repository does not include copied `deadly` or puzzle data until its license and redistribution terms are verified. Catalog metadata is not evidence that a family has positive seeds or a completed benchmark corpus; those remain explicit dataset work.

The acceptance benchmark requires at least 300 independent cases with separate `calibration` and `evaluation` splits. Do not treat the runner's result as a positive MVP finding while the report is `INCONCLUSIVE` or forced-mate verification is unavailable.
