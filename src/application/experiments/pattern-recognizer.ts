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
  bySplit: Readonly<Record<PatternExperimentCase["split"], Readonly<{
    total: number;
    top1Accuracy: number;
    topKRecall: number;
    hardNegativeRejectionRate: number;
    familyMetrics: Readonly<Record<string, RecognitionMetric>>;
  }>>>;
}>;

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
  return ok({
    caseId: experimentCase.caseId,
    datasetVersion: experimentCase.datasetVersion,
    split: experimentCase.split,
    exampleKind: experimentCase.exampleKind,
    family: experimentCase.family,
    target,
    candidates,
    ...(top1 === undefined ? {} : { top1Family: top1.family }),
    topKHit: candidates.some(candidate => candidate.family === experimentCase.family)
  });
};

const rate = (numerator: number, denominator: number): number => denominator === 0 ? 0 : numerator / denominator;

const familyMetric = (results: readonly PatternRecognitionCaseResult[], family: string): RecognitionMetric => {
  const positives = results.filter(result => result.exampleKind === "positive" && result.family === family);
  const negatives = results.filter(result => result.exampleKind !== "positive" && result.family === family);
  const truePositives = positives.filter(result => result.target.similarity >= 0.65).length;
  const falseNegatives = positives.length - truePositives;
  const falsePositives = negatives.filter(result => result.target.similarity >= 0.65).length;
  const precision = rate(truePositives, truePositives + falsePositives);
  const recall = rate(truePositives, truePositives + falseNegatives);
  return { truePositives, falsePositives, falseNegatives, precision, recall, f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall), total: positives.length + negatives.length };
};

const summarizeSplit = (results: readonly PatternRecognitionCaseResult[]) => {
  const positives = results.filter(result => result.exampleKind === "positive");
  const negatives = results.filter(result => result.exampleKind !== "positive");
  const top1Accuracy = rate(positives.filter(result => result.top1Family === result.family).length, positives.length);
  const topKRecall = rate(positives.filter(result => result.topKHit).length, positives.length);
  const hardNegativeRejectionRate = rate(negatives.filter(result => result.target.similarity < 0.65).length, negatives.length);
  const families = [...new Set(results.map(result => result.family))].sort();
  return { total: results.length, top1Accuracy, topKRecall, hardNegativeRejectionRate, familyMetrics: Object.fromEntries(families.map(family => [family, familyMetric(results, family)])) };
};

export const summarizePatternRecognition = (datasetVersion: string, results: readonly PatternRecognitionCaseResult[]): PatternRecognitionReport => ({
  datasetVersion,
  total: results.length,
  bySplit: {
    calibration: summarizeSplit(results.filter(result => result.split === "calibration")),
    evaluation: summarizeSplit(results.filter(result => result.split === "evaluation"))
  }
});
