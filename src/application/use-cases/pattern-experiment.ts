import type { ChessRulesPort } from "../ports/chess-rules";
import type { ForcedMateVerifier } from "../ports/forced-mate";
import type { AnalysisCachePort } from "../ports/analysis-cache";
import type { StylePathProviders } from "../ports/providers";
import { generateStylePaths, type StylePathLineResult } from "./style-path";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { PatternAssessment, PatternFamilyId } from "../../domain/patterns/pattern";
import { assessPattern, analysisCacheKey, isPatternAssessment, makeCacheEntry, makePatternModelVersion, PATTERN_MATCH_THRESHOLD, PATTERN_MODEL_VERSION } from "../../domain/index";
import { makePatternLineOutcome, type ForcedMateVerification, type PatternLineOutcome } from "../../domain/patterns/outcomes";
import type { ScenarioLine } from "../../domain/scenario-lines/scenario-line";
import type { ScenarioHorizon } from "../../domain/chess/value-objects";
import { domainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";

export type PatternLineTrace = Readonly<{
  engineKey: string;
  line: ScenarioLine;
  prefixAssessments: readonly PatternAssessment[];
  fullAssessments: readonly PatternAssessment[];
  terminalPosition: PositionSnapshot;
  cache?: Readonly<{ hits: number; misses: number }>;
}>;

export type PatternSelection = Readonly<{
  selectedEngineKey: string;
  baselineEngineKey: string;
  prefixPlies: number;
  baselineScore: number;
  alternativeScore: number;
  controlEngineKey: string;
  selectionReason: "PATTERN_SCORE" | "TIE_BASELINE";
}>;

export type PatternExperimentComparison = Readonly<{
  baseline: PatternLineOutcome;
  treatment: PatternLineOutcome;
  control: PatternLineOutcome;
  selection: PatternSelection;
}>;

export type PatternExperimentCase = Readonly<{
  caseId: string;
  datasetVersion: string;
  split: "calibration" | "evaluation";
  exampleKind: "positive" | "hard_negative" | "control";
  family: PatternFamilyId;
  sourcePositionHash: string;
  source: Readonly<{ kind: string; reference: string; license?: string }>;
  position: PositionSnapshot;
  horizon: ScenarioHorizon;
  prefixPlies: number;
}>;

export type PatternExperimentResult = Readonly<{
  caseId: string;
  datasetVersion: string;
  split: PatternExperimentCase["split"];
  exampleKind: PatternExperimentCase["exampleKind"];
  family: PatternFamilyId;
  sourcePositionHash: string;
  source: PatternExperimentCase["source"];
  baseline: StylePathLineResult;
  alternative: StylePathLineResult;
  comparison: PatternExperimentComparison;
  cache: Readonly<{ hits: number; misses: number }>;
}>;

export const tracePatternLine = (
  chess: ChessRulesPort,
  engineKey: string,
  line: ScenarioLine,
  family: PatternFamilyId,
  prefixPlies: number
): Result<PatternLineTrace, ReturnType<typeof domainError>> => {
  let current = line.start;
  let previousSimilarity = 0;
  const fullAssessments: PatternAssessment[] = [];
  const prefixAssessments: PatternAssessment[] = [];
  for (let plyIndex = 0; plyIndex <= line.plies.length; plyIndex += 1) {
    const facts = chess.computeFacts(current);
    if (isErr(facts)) {
      return err(facts.error);
    }
    const assessment = assessPattern(current, facts.value, family, previousSimilarity);
    previousSimilarity = assessment.similarity;
    fullAssessments.push(assessment);
    if (plyIndex <= prefixPlies) {
      prefixAssessments.push(assessment);
    }
    const ply = line.plies[plyIndex];
    if (ply === undefined) {
      break;
    }
    const next = chess.applyMove(current, ply.move);
    if (isErr(next)) {
      return err(next.error);
    }
    current = next.value;
  }
  return ok({ engineKey, line, prefixAssessments, fullAssessments, terminalPosition: current });
};

export const tracePatternLineWithCache = async (
  chess: ChessRulesPort,
  engineKey: string,
  line: ScenarioLine,
  family: PatternFamilyId,
  prefixPlies: number,
  cache: AnalysisCachePort,
  nowIso: string
): Promise<Result<PatternLineTrace, ReturnType<typeof domainError>>> => {
  let current = line.start;
  let previousSimilarity = 0;
  let hits = 0;
  let misses = 0;
  const fullAssessments: PatternAssessment[] = [];
  const prefixAssessments: PatternAssessment[] = [];
  for (let plyIndex = 0; plyIndex <= line.plies.length; plyIndex += 1) {
    const facts = chess.computeFacts(current);
    if (isErr(facts)) return err(facts.error);
    const key = analysisCacheKey({
      namespace: "PATTERN_ASSESSMENT",
      position: current,
      configuration: { family },
      modelVersion: makePatternModelVersion(PATTERN_MODEL_VERSION)
    });
    const cached = await cache.get(key);
    if (isErr(cached)) return err(cached.error);
    let assessment: PatternAssessment;
    if (cached.value !== undefined && isPatternAssessment(cached.value.value)) {
      assessment = { ...cached.value.value, progress: cached.value.value.similarity - previousSimilarity };
      hits += 1;
    } else {
      assessment = assessPattern(current, facts.value, family, previousSimilarity);
      misses += 1;
      const stored = await cache.put(makeCacheEntry({ key, schemaVersion: 1, createdAtIso: nowIso, value: assessment }));
      if (isErr(stored)) return err(stored.error);
    }
    previousSimilarity = assessment.similarity;
    fullAssessments.push(assessment);
    if (plyIndex <= prefixPlies) prefixAssessments.push(assessment);
    const ply = line.plies[plyIndex];
    if (ply === undefined) break;
    const next = chess.applyMove(current, ply.move);
    if (isErr(next)) return err(next.error);
    current = next.value;
  }
  return ok({ engineKey, line, prefixAssessments, fullAssessments, terminalPosition: current, cache: { hits, misses } });
};

const maxScore = (assessments: readonly PatternAssessment[]): number => assessments.reduce((best, assessment) => Math.max(best, assessment.similarity), 0);

export const selectPatternLine = (input: Readonly<{
  baseline: PatternLineTrace;
  alternative: PatternLineTrace;
  prefixPlies: number;
  controlEngineKey?: string;
}>): PatternSelection => {
  const baselineScore = maxScore(input.baseline.prefixAssessments);
  const alternativeScore = maxScore(input.alternative.prefixAssessments);
  const alternativeWins = alternativeScore > baselineScore;
  return {
    selectedEngineKey: alternativeWins ? input.alternative.engineKey : input.baseline.engineKey,
    baselineEngineKey: input.baseline.engineKey,
    prefixPlies: input.prefixPlies,
    baselineScore,
    alternativeScore,
    controlEngineKey: input.controlEngineKey ?? input.baseline.engineKey,
    selectionReason: alternativeWins ? "PATTERN_SCORE" : "TIE_BASELINE"
  };
};

const unavailableVerification: ForcedMateVerification = {
  status: "UNAVAILABLE",
  reason: "No independent forced-mate verifier was configured"
};

export const evaluatePatternTrace = async (
  chess: ChessRulesPort,
  trace: PatternLineTrace,
  verifier?: ForcedMateVerifier
): Promise<Result<PatternLineOutcome, ReturnType<typeof domainError>>> => {
  const facts = chess.computeFacts(trace.terminalPosition);
  if (isErr(facts)) {
    return err(facts.error);
  }
  const verification = verifier === undefined
    ? ok(unavailableVerification)
    : await verifier({ start: trace.line.start, line: trace.line, terminalPosition: trace.terminalPosition });
  if (isErr(verification)) {
    return err(verification.error);
  }
  return ok(makePatternLineOutcome({
    assessments: trace.fullAssessments.filter(assessment => assessment.similarity >= PATTERN_MATCH_THRESHOLD),
    terminalMate: facts.value.isCheckmate,
    forcedMate: verification.value
  }));
};

export const comparePatternTraces = async (
  chess: ChessRulesPort,
  baseline: PatternLineTrace,
  alternative: PatternLineTrace,
  prefixPlies: number,
  verifier?: ForcedMateVerifier,
  controlEngineKey?: string
): Promise<Result<PatternExperimentComparison, ReturnType<typeof domainError>>> => {
  const selection = controlEngineKey === undefined
    ? selectPatternLine({ baseline, alternative, prefixPlies })
    : selectPatternLine({ baseline, alternative, prefixPlies, controlEngineKey });
  const control = selection.controlEngineKey === alternative.engineKey ? alternative : baseline;
  const baselineOutcome = await evaluatePatternTrace(chess, baseline, verifier);
  const treatmentOutcome = await evaluatePatternTrace(chess, selection.selectedEngineKey === baseline.engineKey ? baseline : alternative, verifier);
  const controlOutcome = await evaluatePatternTrace(chess, control, verifier);
  if (isErr(baselineOutcome)) return err(baselineOutcome.error);
  if (isErr(treatmentOutcome)) return err(treatmentOutcome.error);
  if (isErr(controlOutcome)) return err(controlOutcome.error);
  return ok({
    baseline: baselineOutcome.value,
    treatment: treatmentOutcome.value,
    control: controlOutcome.value,
    selection
  });
};

const engineLine = (lines: readonly StylePathLineResult[], keyPart: string): Result<StylePathLineResult, ReturnType<typeof domainError>> => {
  const found = lines.find(result => result.engineKey.includes(keyPart));
  return found === undefined
    ? err(domainError("PROVIDER_UNAVAILABLE", `experiment.${keyPart}`, "Required CSTal line was not produced"))
    : ok(found);
};

const deterministicControlEngine = (caseId: string, baselineKey: string, alternativeKey: string): string => {
  const checksum = [...caseId].reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0);
  return checksum % 2 === 0 ? baselineKey : alternativeKey;
};

export const runPatternSelectionExperiment = async (
  chess: ChessRulesPort,
  providers: StylePathProviders,
  experimentCase: PatternExperimentCase,
  verifier?: ForcedMateVerifier,
  cache?: AnalysisCachePort,
  nowIso = new Date().toISOString()
): Promise<Result<PatternExperimentResult, ReturnType<typeof domainError>>> => {
  const lines = await generateStylePaths(chess, providers, {
    lineId: `pattern-experiment-${experimentCase.caseId}`,
    start: experimentCase.position,
    horizon: experimentCase.horizon
  });
  if (isErr(lines)) return err(lines.error);
  const baseline = engineLine(lines.value, "cstal-absurd");
  const alternative = engineLine(lines.value, "cstal-extreme");
  if (isErr(baseline)) return err(baseline.error);
  if (isErr(alternative)) return err(alternative.error);
  const baselineTrace = cache === undefined
    ? tracePatternLine(chess, baseline.value.engineKey, baseline.value.line, experimentCase.family, experimentCase.prefixPlies)
    : await tracePatternLineWithCache(chess, baseline.value.engineKey, baseline.value.line, experimentCase.family, experimentCase.prefixPlies, cache, nowIso);
  const alternativeTrace = cache === undefined
    ? tracePatternLine(chess, alternative.value.engineKey, alternative.value.line, experimentCase.family, experimentCase.prefixPlies)
    : await tracePatternLineWithCache(chess, alternative.value.engineKey, alternative.value.line, experimentCase.family, experimentCase.prefixPlies, cache, nowIso);
  if (isErr(baselineTrace)) return err(baselineTrace.error);
  if (isErr(alternativeTrace)) return err(alternativeTrace.error);
  const comparison = await comparePatternTraces(
    chess,
    baselineTrace.value,
    alternativeTrace.value,
    experimentCase.prefixPlies,
    verifier,
    deterministicControlEngine(experimentCase.caseId, baseline.value.engineKey, alternative.value.engineKey)
  );
  if (isErr(comparison)) return err(comparison.error);
  return ok({
    caseId: experimentCase.caseId,
    datasetVersion: experimentCase.datasetVersion,
    split: experimentCase.split,
    exampleKind: experimentCase.exampleKind,
    family: experimentCase.family,
    sourcePositionHash: experimentCase.sourcePositionHash,
    source: experimentCase.source,
    baseline: baseline.value,
    alternative: alternative.value,
    comparison: comparison.value,
    cache: {
      hits: (baselineTrace.value.cache?.hits ?? 0) + (alternativeTrace.value.cache?.hits ?? 0),
      misses: (baselineTrace.value.cache?.misses ?? 0) + (alternativeTrace.value.cache?.misses ?? 0)
    }
  });
};
