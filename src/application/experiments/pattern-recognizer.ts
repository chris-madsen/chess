import type { ChessRulesPort } from "../ports/chess-rules";
import type { PatternExperimentCase } from "../use-cases/pattern-experiment";
import { extractPatternPositionContext, makePatternAnalysisContext } from "../../domain/patterns/context";
import { retrievePatternFamilies } from "../../domain/patterns/matchers";
import type { PatternAssessment } from "../../domain/patterns/pattern";
import { err, isErr, ok, type Result } from "../../domain/shared/result";
import { domainError, type DomainError } from "../../domain/shared/errors";

export type PatternRecognitionCaseResult = Readonly<{
  caseId: string;
  datasetVersion: string;
  split: PatternExperimentCase["split"];
  exampleKind: PatternExperimentCase["exampleKind"];
  family: PatternExperimentCase["family"];
  target: PatternAssessment;
  candidates: readonly PatternAssessment[];
  top1Family?: PatternAssessment["family"];
  topKHit: boolean;
  trajectory?: readonly PatternTrajectoryPoint[];
}>;

export type PatternTrajectoryPoint = Readonly<{
  ply: number;
  distanceToTerminal: number;
  similarity: number;
  state: PatternAssessment["state"];
}>;

export type RecognitionMetric = Readonly<{
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  total: number;
}>;

export type PatternRecognitionReport = Readonly<{
  datasetVersion: string;
  total: number;
  calibrationThreshold: number;
  bySplit: Readonly<Record<PatternExperimentCase["split"], Readonly<{
    total: number;
    top1Accuracy: number;
    topKRecall: number;
    hardNegativeRejectionRate: number;
    controlFalsePositiveRate: number;
    familyMetrics: Readonly<Record<string, RecognitionMetric>>;
    confusionMatrix: Readonly<Record<string, Readonly<Record<string, number>>>>;
    proximity: ProximityMetrics;
  }>>>;
}>;

export type ProximityMetrics = Readonly<{
  sampleCount: number;
  meanSimilarityByDistance: Readonly<Record<string, number>>;
  medianSimilarityByDistance: Readonly<Record<string, number>>;
  spearmanCorrelation: number;
  monotonicityRate: number;
  scoreDeltaPerPly: number;
}>;

const trajectoryFor = (chess: ChessRulesPort, experimentCase: PatternExperimentCase): readonly PatternTrajectoryPoint[] | undefined => {
  if (experimentCase.trajectory === undefined || experimentCase.trajectory.length === 0) return undefined;
  const analysis = makePatternAnalysisContext(experimentCase.position.sideToMove);
  return experimentCase.trajectory
    .filter(state => state.ply >= 1)
    .map(state => {
      const position = chess.ingestPosition(state.fen);
      if (isErr(position)) return undefined;
      const facts = chess.computeFacts(position.value);
      if (isErr(facts)) return undefined;
      const context = extractPatternPositionContext(position.value, facts.value, analysis);
      const assessment = retrievePatternFamilies(context, 34).find(candidate => candidate.family === experimentCase.family);
      return assessment === undefined ? undefined : { ply: state.ply, distanceToTerminal: state.distanceToTerminal, similarity: assessment.similarity, state: assessment.state };
    })
    .filter((point): point is PatternTrajectoryPoint => point !== undefined);
};

export const recognizePatternCase = (
  chess: ChessRulesPort,
  experimentCase: PatternExperimentCase,
  limit = 8
): Result<PatternRecognitionCaseResult, DomainError> => {
  const facts = chess.computeFacts(experimentCase.position);
  if (isErr(facts)) return err(facts.error);
  const context = extractPatternPositionContext(experimentCase.position, facts.value, makePatternAnalysisContext(experimentCase.position.sideToMove));
  const candidates = retrievePatternFamilies(context, limit);
  const target = candidates.find(candidate => candidate.family === experimentCase.family)
    ?? retrievePatternFamilies(context, 34).find(candidate => candidate.family === experimentCase.family);
  if (target === undefined) return err(domainError("PROVIDER_UNAVAILABLE", "patternRecognizer.target", "Target family assessment was not produced"));
  const top1 = candidates[0];
  const trajectory = trajectoryFor(chess, experimentCase);
  return ok({
    caseId: experimentCase.caseId,
    datasetVersion: experimentCase.datasetVersion,
    split: experimentCase.split,
    exampleKind: experimentCase.exampleKind,
    family: experimentCase.family,
    target,
    candidates,
    ...(top1 === undefined ? {} : { top1Family: top1.family }),
    topKHit: candidates.some(candidate => candidate.family === experimentCase.family),
    ...(trajectory === undefined ? {} : { trajectory })
  });
};

const rate = (numerator: number, denominator: number): number => denominator === 0 ? 0 : numerator / denominator;

const familyMetric = (results: readonly PatternRecognitionCaseResult[], family: string, threshold: number): RecognitionMetric => {
  const positives = results.filter(result => result.exampleKind === "positive" && result.family === family);
  const negatives = results.filter(result => result.exampleKind === "hard_negative" && result.family === family);
  const truePositives = positives.filter(result => result.target.similarity >= threshold).length;
  const falseNegatives = positives.length - truePositives;
  const falsePositives = negatives.filter(result => result.target.similarity >= threshold).length;
  const precision = rate(truePositives, truePositives + falsePositives);
  const recall = rate(truePositives, truePositives + falseNegatives);
  return { truePositives, falsePositives, falseNegatives, precision, recall, f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall), total: positives.length + negatives.length };
};

const rank = (values: readonly number[]): readonly number[] => {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = Array.from({ length: values.length }, () => 0);
  let index = 0;
  while (index < sorted.length) {
    let end = index + 1;
    while (end < sorted.length && sorted[end]?.value === sorted[index]?.value) end += 1;
    const average = (index + 1 + end) / 2;
    sorted.slice(index, end).forEach(item => { ranks[item.index] = average; });
    index = end;
  }
  return ranks;
};

const spearman = (xs: readonly number[], ys: readonly number[]): number => {
  if (xs.length < 2 || xs.length !== ys.length) return 0;
  const rx = rank(xs); const ry = rank(ys);
  const meanX = rx.reduce((sum, value) => sum + value, 0) / rx.length;
  const meanY = ry.reduce((sum, value) => sum + value, 0) / ry.length;
  const numerator = rx.reduce((sum, value, index) => sum + (value - meanX) * ((ry[index] ?? 0) - meanY), 0);
  const denominator = Math.sqrt(rx.reduce((sum, value) => sum + (value - meanX) ** 2, 0) * ry.reduce((sum, value) => sum + (value - meanY) ** 2, 0));
  return denominator === 0 ? 0 : numerator / denominator;
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + upper) / 2 : upper;
};

const proximity = (results: readonly PatternRecognitionCaseResult[]): ProximityMetrics => {
  const points = results.flatMap(result => result.trajectory ?? []);
  const groups = new Map<number, number[]>();
  points.forEach(point => groups.set(point.distanceToTerminal, [...(groups.get(point.distanceToTerminal) ?? []), point.similarity]));
  const distances = [...groups.keys()].sort((a, b) => a - b);
  const means = Object.fromEntries(distances.map(distance => {
    const values = groups.get(distance) ?? [];
    return [String(distance), values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)];
  }));
  const medians = Object.fromEntries(distances.map(distance => [String(distance), median(groups.get(distance) ?? [])]));
  const trajectories = results.map(result => [...(result.trajectory ?? [])].sort((a, b) => b.distanceToTerminal - a.distanceToTerminal || a.ply - b.ply));
  const monotonePairs = trajectories.flatMap(trajectory => trajectory.slice(1).map((point, index) => point.similarity >= (trajectory[index]?.similarity ?? 0))).filter(Boolean).length;
  const monotoneTotal = trajectories.reduce((sum, trajectory) => sum + Math.max(0, trajectory.length - 1), 0);
  const deltas = results.flatMap(result => {
    const trajectory = [...(result.trajectory ?? [])].sort((a, b) => a.ply - b.ply);
    return trajectory.slice(1).map((point, index) => point.similarity - (trajectory[index]?.similarity ?? 0));
  });
  return {
    sampleCount: points.length,
    meanSimilarityByDistance: means,
    medianSimilarityByDistance: medians,
    spearmanCorrelation: spearman(points.map(point => -point.distanceToTerminal), points.map(point => point.similarity)),
    monotonicityRate: monotoneTotal === 0 ? 0 : monotonePairs / monotoneTotal,
    scoreDeltaPerPly: deltas.length === 0 ? 0 : deltas.reduce((sum, value) => sum + value, 0) / deltas.length
  };
};

const confusionMatrix = (results: readonly PatternRecognitionCaseResult[]): Readonly<Record<string, Readonly<Record<string, number>>>> => {
  const matrix: Record<string, Record<string, number>> = {};
  results.filter(result => result.exampleKind === "positive").forEach(result => {
    const predicted = result.top1Family ?? "UNRECOGNIZED";
    matrix[result.family] ??= {};
    const row = matrix[result.family] ?? {};
    row[predicted] = (row[predicted] ?? 0) + 1;
    matrix[result.family] = row;
  });
  return matrix;
};

const summarizeSplit = (results: readonly PatternRecognitionCaseResult[], threshold: number) => {
  const positives = results.filter(result => result.exampleKind === "positive");
  const hardNegatives = results.filter(result => result.exampleKind === "hard_negative");
  const controls = results.filter(result => result.exampleKind === "control");
  const top1Accuracy = rate(positives.filter(result => result.top1Family === result.family).length, positives.length);
  const topKRecall = rate(positives.filter(result => result.topKHit).length, positives.length);
  const hardNegativeRejectionRate = rate(hardNegatives.filter(result => result.target.similarity < threshold).length, hardNegatives.length);
  const controlFalsePositiveRate = rate(controls.filter(result => result.target.similarity >= threshold).length, controls.length);
  const families = [...new Set(results.map(result => result.family))].sort();
  return { total: results.length, top1Accuracy, topKRecall, hardNegativeRejectionRate, controlFalsePositiveRate, familyMetrics: Object.fromEntries(families.map(family => [family, familyMetric(results, family, threshold)])), confusionMatrix: confusionMatrix(results), proximity: proximity(results) };
};

const calibratedThreshold = (results: readonly PatternRecognitionCaseResult[]): number => {
  const calibration = results.filter(result => result.split === "calibration" && result.exampleKind !== "control");
  const thresholds = [...new Set([0.65, ...calibration.map(result => result.target.similarity)])].sort((a, b) => a - b);
  let best = 0.65;
  let bestF1 = -1;
  thresholds.forEach(threshold => {
    const positives = calibration.filter(result => result.exampleKind === "positive");
    const negatives = calibration.filter(result => result.exampleKind === "hard_negative");
    const tp = positives.filter(result => result.target.similarity >= threshold).length;
    const fp = negatives.filter(result => result.target.similarity >= threshold).length;
    const fn = positives.length - tp;
    const precision = rate(tp, tp + fp);
    const recall = rate(tp, tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    if (f1 > bestF1) { bestF1 = f1; best = threshold; }
  });
  return best;
};

export const summarizePatternRecognition = (datasetVersion: string, results: readonly PatternRecognitionCaseResult[]): PatternRecognitionReport => {
  const threshold = calibratedThreshold(results);
  return { datasetVersion, total: results.length, calibrationThreshold: threshold, bySplit: { calibration: summarizeSplit(results.filter(result => result.split === "calibration"), threshold), evaluation: summarizeSplit(results.filter(result => result.split === "evaluation"), threshold) } };
};
