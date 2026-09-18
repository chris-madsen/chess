import { summarizePatternRecognition } from "../src/application/experiments/pattern-recognizer.ts";

const result = (caseId, split, family, top1Family, trajectory) => ({
  caseId,
  datasetVersion: "metrics-v1",
  split,
  exampleKind: "positive",
  family,
  target: { tag: "PatternAssessment", family, similarity: 0.8, progress: 0, state: "near", evidence: [], modelVersion: "test" },
  candidates: [],
  top1Family,
  topKHit: top1Family === family,
  trajectory
});

test("recognizer report keeps split metrics, confusion, and proximity separate", () => {
  const report = summarizePatternRecognition("metrics-v1", [
    result("calibration-1", "calibration", "ANASTASIA", "ANASTASIA", [
      { ply: 1, distanceToTerminal: 2, similarity: 0.2, state: "promising" },
      { ply: 2, distanceToTerminal: 1, similarity: 0.8, state: "near" }
    ]),
    result("evaluation-1", "evaluation", "ANASTASIA", "BACK_RANK", [
      { ply: 1, distanceToTerminal: 2, similarity: 0.1, state: "far" },
      { ply: 2, distanceToTerminal: 1, similarity: 0.7, state: "near" }
    ])
  ]);
  expect(report.bySplit.calibration.total).toBe(1);
  expect(report.bySplit.evaluation.total).toBe(1);
  expect(report.bySplit.evaluation.confusionMatrix.ANASTASIA.BACK_RANK).toBe(1);
  expect(report.bySplit.evaluation.proximity.sampleCount).toBe(2);
  expect(report.bySplit.evaluation.proximity.spearmanCorrelation).toBeGreaterThan(0);
});
