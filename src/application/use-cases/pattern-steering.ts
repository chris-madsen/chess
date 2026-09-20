import type { ChessRulesPort } from "../ports/chess-rules";
import type { MoveProvider } from "../ports/providers";
import type { CandidateGenerator, CandidateTacticalGate, TacticalCandidateAssessment } from "../ports/pattern-steering";
import type { CandidateSeed, ScenarioDecisionTrace } from "../../domain/scenario-lines/scenario-line";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { PatternAssessment, PatternFamilyId } from "../../domain/patterns/pattern";
import { extractPatternPositionContext, makePatternAnalysisContext } from "../../domain/patterns/context";
import { retrieveSteerablePatternFamilies } from "../../domain/patterns/matchers";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";
import type { AnalysisCachePort } from "../ports/analysis-cache";
import { analysisCacheKey, makeCacheEntry } from "../../domain/cache/state-cache";
import { PATTERN_MODEL_VERSION } from "../../domain/patterns/pattern";
import { calibratedAttractorScore } from "../../domain/patterns/thresholds";
import type { ProvidedMove } from "../ports/providers";

export type PatternSteeringCandidate = Readonly<{
  seed: CandidateSeed;
  tactical: TacticalCandidateAssessment;
  afterPosition: PositionSnapshot;
  responseMove?: import("../../domain/chess/moves").LegalMove;
  responseProvenance?: import("../../domain/provenance/provenance").MoveProvenance;
  postResponsePosition?: PositionSnapshot;
  beforeFamilies: readonly PatternAssessment[];
  afterFamilies: readonly PatternAssessment[];
  postResponseFamilies: readonly PatternAssessment[];
  targetFamily: PatternFamilyId;
  beforeScore: number;
  afterCandidateScore: number;
  afterResponseScore: number;
  patternDelta: number;
  calibratedBeforeScore: number;
  calibratedAfterResponseScore: number;
  calibratedProgress: number;
  progress: number;
  terminalAfterCandidate?: boolean;
  immediateMate?: boolean;
  mateClass?: boolean;
  mateDistance?: number;
}>;

export type PatternSteeringDecisionTrace = ScenarioDecisionTrace;

export type PatternSteeringDecision = Readonly<{
  attackerSide: "white" | "black";
  selected: PatternSteeringCandidate;
  candidates: readonly PatternSteeringCandidate[];
  trace: PatternSteeringDecisionTrace;
}>;

export type PatternSelectionContext = Readonly<{
  stallCount?: number;
  repeatedPosition?: boolean;
  previousTalOrigin?: string;
  previousTargetFamily?: PatternFamilyId;
  recentPositionKeys?: readonly string[];
  /** @deprecated Use recentPositionKeys. */
  recentPositionHashes?: readonly string[];
}>;

const scoreFor = (assessments: readonly PatternAssessment[], family: PatternFamilyId): number => assessments.find(assessment => assessment.family === family)?.similarity ?? 0;
const familyProgress = (before: readonly PatternAssessment[], after: readonly PatternAssessment[], postResponse: readonly PatternAssessment[], requestedFamily?: PatternFamilyId, previousTargetFamily?: PatternFamilyId, selectionContext: PatternSelectionContext = {}): Readonly<{ targetFamily: PatternFamilyId; beforeScore: number; afterCandidateScore: number; afterResponseScore: number; delta: number; calibratedBefore: number; calibratedAfter: number }> => {
  if (requestedFamily !== undefined) {
    const metric = (family: PatternFamilyId) => {
      const beforeScore = scoreFor(before, family);
      const afterCandidateScore = scoreFor(after, family);
      const afterResponseScore = scoreFor(postResponse, family);
      return { targetFamily: family, beforeScore, afterCandidateScore, afterResponseScore, delta: afterResponseScore - beforeScore, calibratedBefore: calibratedAttractorScore(beforeScore, family), calibratedAfter: calibratedAttractorScore(afterResponseScore, family) };
    };
    const preferred = metric(requestedFamily);
    const strongestAlternative = [...new Set(postResponse.map(item => item.family))]
      .filter(family => family !== requestedFamily)
      .map(family => metric(family))
      .sort((first, second) => second.calibratedAfter - first.calibratedAfter || first.targetFamily.localeCompare(second.targetFamily))[0];
    const stalled = (selectionContext.stallCount ?? 0) >= 2 || selectionContext.repeatedPosition === true;
    const materiallyStronger = strongestAlternative !== undefined && strongestAlternative.calibratedAfter >= preferred.calibratedAfter + 0.2;
    return strongestAlternative !== undefined && (stalled || materiallyStronger) ? strongestAlternative : preferred;
  }
  const families = [...new Set([...before, ...after, ...postResponse].map(assessment => assessment.family))];
  const ranked = families.map(family => ({ family, beforeScore: scoreFor(before, family), afterCandidateScore: scoreFor(after, family), afterResponseScore: scoreFor(postResponse, family) }))
    .map(candidate => ({ targetFamily: candidate.family, beforeScore: candidate.beforeScore, afterCandidateScore: candidate.afterCandidateScore, afterResponseScore: candidate.afterResponseScore, delta: candidate.afterResponseScore - candidate.beforeScore }))
    .map(candidate => ({ ...candidate, calibratedBefore: calibratedAttractorScore(candidate.beforeScore, candidate.targetFamily), calibratedAfter: calibratedAttractorScore(candidate.afterResponseScore, candidate.targetFamily) }))
    .sort((first, second) => second.calibratedAfter - first.calibratedAfter || (second.calibratedAfter - second.calibratedBefore) - (first.calibratedAfter - first.calibratedBefore) || String(first.targetFamily).localeCompare(String(second.targetFamily)));
  const best = ranked[0];
  const previous = previousTargetFamily === undefined ? undefined : ranked.find(candidate => candidate.targetFamily === previousTargetFamily);
  const chosen = previous !== undefined && best !== undefined && best.targetFamily !== previous.targetFamily && best.calibratedAfter < previous.calibratedAfter + 0.05 ? previous : best;
  return chosen === undefined
    ? { targetFamily: "ANASTASIA", beforeScore: 0, afterCandidateScore: 0, afterResponseScore: 0, delta: 0, calibratedBefore: 0, calibratedAfter: 0 }
    : { targetFamily: chosen.targetFamily, beforeScore: chosen.beforeScore, afterCandidateScore: chosen.afterCandidateScore, afterResponseScore: chosen.afterResponseScore, delta: chosen.delta, calibratedBefore: chosen.calibratedBefore, calibratedAfter: chosen.calibratedAfter };
};

const familiesFor = async (position: PositionSnapshot, context: import("../../domain/patterns/context").PatternPositionContext, cache?: AnalysisCachePort): Promise<readonly PatternAssessment[]> => {
  if (cache === undefined) return retrieveSteerablePatternFamilies(context, 19);
  const key = analysisCacheKey({ namespace: "PATTERN_ASSESSMENT", position, configuration: { modelVersion: `${PATTERN_MODEL_VERSION}-relational-v1`, retrieval: "steerable-19", attackerSide: context.analysis.attackerSide } });
  const hit = await cache.get(key);
  if (!isErr(hit)) {
    const cached = hit.value?.value.assessments;
    if (Array.isArray(cached)) return cached as readonly PatternAssessment[];
  }
  const assessments = retrieveSteerablePatternFamilies(context, 19);
  await cache.put(makeCacheEntry({ key, schemaVersion: 1, createdAtIso: new Date().toISOString(), value: { assessments } }));
  return assessments;
};

const maiaResponseFor = async (position: PositionSnapshot, maia: MoveProvider, lineId: string): Promise<Result<ProvidedMove, DomainError>> => (
  maia({ position, lineId, ply: 2 })
);

const provenancesFor = (seed: CandidateSeed): readonly import("../../domain/provenance/provenance").MoveProvenance[] => seed.proposedBy ?? [seed.provenance];

const isTrustedTalCandidate = (seed: CandidateSeed): boolean => provenancesFor(seed).some(provenance => (
  provenance.source === "LOCAL_STYLE_ENGINE"
  && ["cstal-absurd", "cstal-extreme"].includes(provenance.provider.name.toLowerCase())
));

const talOriginFor = (seed: CandidateSeed): string | undefined => {
  const names = provenancesFor(seed).filter(provenance => provenance.source === "LOCAL_STYLE_ENGINE").map(provenance => provenance.provider.name.toLowerCase()).filter(name => name.includes("cstal"));
  return names.length === 0 ? undefined : [...new Set(names)].sort().join(",");
};

const mateScoreFor = (seed: CandidateSeed, tactical: TacticalCandidateAssessment): Readonly<{ isMate: boolean; distance?: number }> => {
  const score = tactical.talScore ?? seed.engineScore;
  return score?.kind === "mate" && score.value > 0 ? { isMate: true, distance: score.value } : { isMate: false };
};

export const selectPatternSteeringCandidate = (
  candidates: readonly PatternSteeringCandidate[],
  context: PatternSelectionContext = {}
): Result<PatternSteeringCandidate, DomainError> => {
  const order = (first: PatternSteeringCandidate, second: PatternSteeringCandidate): number => (
    Number(second.immediateMate === true) - Number(first.immediateMate === true)
    || Number(second.mateClass === true) - Number(first.mateClass === true)
    || (first.mateClass === true && second.mateClass === true ? (first.mateDistance ?? Number.POSITIVE_INFINITY) - (second.mateDistance ?? Number.POSITIVE_INFINITY) : 0)
    || (second.calibratedAfterResponseScore ?? second.afterResponseScore) - (first.calibratedAfterResponseScore ?? first.afterResponseScore)
    || (second.calibratedProgress ?? second.patternDelta) - (first.calibratedProgress ?? first.patternDelta)
    || String(first.seed.move.uci).localeCompare(String(second.seed.move.uci))
  );
  const immediate = candidates.filter(candidate => candidate.immediateMate === true);
  const mateClass = candidates.filter(candidate => candidate.mateClass === true);
  const pool = immediate.length > 0 ? immediate : mateClass.length > 0 ? mateClass : candidates;
  const recentPositionKeys = context.recentPositionKeys ?? context.recentPositionHashes;
  const nonRepeating = recentPositionKeys === undefined ? pool : pool.filter(candidate => candidate.postResponsePosition === undefined || !recentPositionKeys.includes(String(candidate.postResponsePosition.fen).split(/\s+/u).slice(0, 4).join(" ")));
  const effectivePool = nonRepeating.length > 0 ? nonRepeating : pool;
  const trusted = effectivePool.filter(candidate => isTrustedTalCandidate(candidate.seed));
  const external = effectivePool.filter(candidate => !isTrustedTalCandidate(candidate.seed));
  const bestTal = [...trusted].sort(order)[0];
  const bestExternal = [...external].sort(order)[0];
  const shortestTrustedMate = [...trusted]
    .filter(candidate => candidate.mateClass === true)
    .sort((first, second) => (first.mateDistance ?? Number.POSITIVE_INFINITY) - (second.mateDistance ?? Number.POSITIVE_INFINITY) || order(first, second))[0];
  const stallFallback = (context.stallCount ?? 0) >= 2 || context.repeatedPosition === true;
  const selected = bestTal === undefined
    ? bestExternal
    : bestExternal !== undefined && bestExternal.calibratedAfterResponseScore >= bestTal.calibratedAfterResponseScore + 0.08 && bestExternal.calibratedProgress > 0.02
      ? bestExternal
      : bestTal;
  const fallback = stallFallback && bestTal !== undefined
    ? (immediate.length > 0 ? bestTal : shortestTrustedMate ?? bestTal)
    : selected ?? [...effectivePool].sort(order)[0];
  return fallback === undefined ? err(domainError("PROVIDER_UNAVAILABLE", "patternSteering.candidates", "No legal candidate survived Pattern steering evaluation")) : ok(fallback);
};

export const evaluatePatternSteeringCandidates = async (
  chess: ChessRulesPort,
  position: Parameters<CandidateGenerator>[0]["position"],
  generator: CandidateGenerator,
  tacticalGate: CandidateTacticalGate | undefined,
  maia: MoveProvider,
  lineId: string,
  limit = 8,
  includeMaiaResponse = true,
  cache?: AnalysisCachePort,
  targetFamily?: PatternFamilyId,
  selectionContext: PatternSelectionContext = {}
): Promise<Result<PatternSteeringDecision, DomainError>> => {
  const facts = chess.computeFacts(position);
  if (isErr(facts)) return err(facts.error);
  const analysis = makePatternAnalysisContext(position.sideToMove);
  const beforeContext = extractPatternPositionContext(position, facts.value, analysis);
  const beforeFamilies = await familiesFor(position, beforeContext, cache);
  const generated = await generator({ position, lineId, limit });
  if (isErr(generated)) return err(generated.error);
  const legalSeeds: CandidateSeed[] = [];
  for (const seed of generated.value) {
    const legal = chess.parseLegalMove(position, seed.move.uci);
    if (isErr(legal)) return err(domainError("PROVIDER_ILLEGAL_MOVE", "patternSteering.candidate", "Candidate generator returned an illegal move", { uci: seed.move.uci, cause: legal.error }));
    if (seed.provenance === undefined || seed.provenance.inputPositionHash !== position.hash) return err(domainError("MISSING_PROVENANCE", "patternSteering.candidate.provenance", "Candidate provenance must refer to the input position"));
    legalSeeds.push({ ...seed, move: legal.value });
  }
  const trustedTal = legalSeeds.filter(isTrustedTalCandidate);
  const externalCandidates = legalSeeds.filter(seed => !isTrustedTalCandidate(seed));
  const trustedAssessments = trustedTal.map(seed => ({ seed, accepted: true, reason: "TRUSTED_TAL_CANDIDATE" }));
  const externalAssessment = externalCandidates.length === 0
    ? ok<readonly TacticalCandidateAssessment[]>([])
    : tacticalGate === undefined
      ? ok<readonly TacticalCandidateAssessment[]>(externalCandidates.map(seed => ({ seed, accepted: true, reason: "TAL_GATE_DISABLED" })))
      : await tacticalGate({ position, attackerSide: analysis.attackerSide, candidates: externalCandidates, lineId });
  const tactical = isErr(externalAssessment)
    ? externalAssessment
    : ok<readonly TacticalCandidateAssessment[]>([...trustedAssessments, ...externalAssessment.value]);
  if (isErr(tactical)) return err(tactical.error);
  const tacticalByMove = new Map(tactical.value.map(assessment => [String(assessment.seed.move.uci), assessment]));
  const evaluated: PatternSteeringCandidate[] = [];
  for (const seed of legalSeeds) {
    const tacticalAssessment = tacticalByMove.get(String(seed.move.uci));
    if (tacticalAssessment === undefined) return err(domainError("PROVIDER_MALFORMED_OUTPUT", "patternSteering.tacticalGate", "Tal gate did not assess every legal candidate", { move: String(seed.move.uci) }));
    const mateScore = mateScoreFor(seed, tacticalAssessment);
    if (!tacticalAssessment.accepted) continue;
    const after = chess.applyMove(position, seed.move);
    if (isErr(after)) return err(after.error);
    const afterFacts = chess.computeFacts(after.value);
    if (isErr(afterFacts)) return err(afterFacts.error);
    const afterContext = extractPatternPositionContext(after.value, afterFacts.value, analysis);
    const afterFamilies = await familiesFor(after.value, afterContext, cache);
    if (afterFacts.value.isTerminal) {
      const progress = familyProgress(beforeFamilies, afterFamilies, afterFamilies, targetFamily, selectionContext.previousTargetFamily, selectionContext);
      evaluated.push({ seed, tactical: tacticalAssessment, afterPosition: after.value, beforeFamilies, afterFamilies, postResponseFamilies: afterFamilies, targetFamily: progress.targetFamily, beforeScore: progress.beforeScore, afterCandidateScore: progress.afterCandidateScore, afterResponseScore: progress.afterResponseScore, patternDelta: progress.delta, calibratedBeforeScore: progress.calibratedBefore, calibratedAfterResponseScore: progress.calibratedAfter, calibratedProgress: progress.calibratedAfter - progress.calibratedBefore, progress: progress.delta, terminalAfterCandidate: true, immediateMate: afterFacts.value.isCheckmate, mateClass: mateScore.isMate, ...(mateScore.distance === undefined ? {} : { mateDistance: mateScore.distance }) });
      continue;
    }
    if (!includeMaiaResponse) {
      const progress = familyProgress(beforeFamilies, afterFamilies, afterFamilies, targetFamily, selectionContext.previousTargetFamily, selectionContext);
      evaluated.push({ seed, tactical: tacticalAssessment, afterPosition: after.value, beforeFamilies, afterFamilies, postResponseFamilies: afterFamilies, targetFamily: progress.targetFamily, beforeScore: progress.beforeScore, afterCandidateScore: progress.afterCandidateScore, afterResponseScore: progress.afterResponseScore, patternDelta: progress.delta, calibratedBeforeScore: progress.calibratedBefore, calibratedAfterResponseScore: progress.calibratedAfter, calibratedProgress: progress.calibratedAfter - progress.calibratedBefore, progress: progress.delta, mateClass: mateScore.isMate, ...(mateScore.distance === undefined ? {} : { mateDistance: mateScore.distance }) });
      continue;
    }
    const response = await maiaResponseFor(after.value, maia, lineId);
    if (isErr(response)) return err(response.error);
    if (response.value.provenance.source !== "MAIA") return err(domainError("SOURCE_SEQUENCE_VIOLATION", "patternSteering.maia.source", "Steering response must come from Maia", { source: response.value.provenance.source }));
    const responseMove = chess.parseLegalMove(after.value, response.value.move.uci);
    if (isErr(responseMove)) return err(domainError("PROVIDER_ILLEGAL_MOVE", "patternSteering.maia.move", "Maia returned an illegal response", { uci: response.value.move.uci, cause: responseMove.error }));
    const postResponse = chess.applyMove(after.value, responseMove.value);
    if (isErr(postResponse)) return err(postResponse.error);
    const responseFacts = chess.computeFacts(postResponse.value);
    if (isErr(responseFacts)) return err(responseFacts.error);
    const postResponseContext = extractPatternPositionContext(postResponse.value, responseFacts.value, analysis);
    const postResponseFamilies = await familiesFor(postResponse.value, postResponseContext, cache);
    const progress = familyProgress(beforeFamilies, afterFamilies, postResponseFamilies, targetFamily, selectionContext.previousTargetFamily, selectionContext);
    evaluated.push({ seed, tactical: tacticalAssessment, afterPosition: after.value, responseMove: responseMove.value, responseProvenance: response.value.provenance, postResponsePosition: postResponse.value, beforeFamilies, afterFamilies, postResponseFamilies, targetFamily: progress.targetFamily, beforeScore: progress.beforeScore, afterCandidateScore: progress.afterCandidateScore, afterResponseScore: progress.afterResponseScore, patternDelta: progress.delta, calibratedBeforeScore: progress.calibratedBefore, calibratedAfterResponseScore: progress.calibratedAfter, calibratedProgress: progress.calibratedAfter - progress.calibratedBefore, progress: progress.delta, mateClass: mateScore.isMate, ...(mateScore.distance === undefined ? {} : { mateDistance: mateScore.distance }) });
  }
  const selected = selectPatternSteeringCandidate(evaluated, selectionContext);
  if (isErr(selected)) return err(selected.error);
  const evaluatedByMove = new Map(evaluated.map(candidate => [String(candidate.seed.move.uci), candidate]));
  return ok({
    attackerSide: analysis.attackerSide,
    selected: selected.value,
    candidates: evaluated,
    trace: {
      positionHash: String(position.hash),
      candidates: legalSeeds.map(seed => {
        const candidate = evaluatedByMove.get(String(seed.move.uci));
        const tacticalAssessment = tacticalByMove.get(String(seed.move.uci))!;
        const trustedTalOrigin = talOriginFor(seed);
        const candidateClass = candidate?.immediateMate === true ? "IMMEDIATE_MATE" : candidate?.mateClass === true ? "MATE_CLASS" : trustedTalOrigin !== undefined ? "TAL_ANCHOR" : "EXTERNAL";
        return {
          uci: String(seed.move.uci),
          source: seed.provenance.source,
          proposedBy: provenancesFor(seed).map(provenance => provenance.provider.name),
          talRequired: !isTrustedTalCandidate(seed),
          talAccepted: tacticalAssessment.accepted,
          ...(trustedTalOrigin === undefined ? {} : { trustedTalOrigin }),
          candidateClass,
          ...(tacticalAssessment.reason === undefined ? {} : { talReason: tacticalAssessment.reason }),
          ...(tacticalAssessment.talScore === undefined && seed.engineScore === undefined ? {} : { talScore: tacticalAssessment.talScore ?? seed.engineScore }),
          ...(candidate === undefined
            ? { targetFamily: targetFamily ?? beforeFamilies[0]?.family ?? "ANASTASIA", beforeAffinity: 0, afterCandidateAffinity: 0, afterMaiaAffinity: 0, patternDelta: 0, calibratedBefore: 0, calibratedAfterMaia: 0, calibratedProgress: 0, selected: false }
            : {
              targetFamily: candidate.targetFamily,
              beforeAffinity: candidate.beforeScore,
              afterCandidateAffinity: candidate.afterCandidateScore,
              afterMaiaAffinity: candidate.afterResponseScore,
              patternDelta: candidate.patternDelta,
              calibratedBefore: candidate.calibratedBeforeScore,
              calibratedAfterMaia: candidate.calibratedAfterResponseScore,
              calibratedProgress: candidate.calibratedProgress,
              selected: String(candidate.seed.move.uci) === String(selected.value.seed.move.uci),
              ...(String(candidate.seed.move.uci) === String(selected.value.seed.move.uci) ? { selectedReason: (selectionContext.stallCount ?? 0) >= 2 || selectionContext.repeatedPosition === true ? "PATTERN_STALL_FALLBACK_TO_TAL" : candidate.immediateMate === true ? "IMMEDIATE_CHECKMATE" : candidate.mateClass === true ? "FORCED_MATE_CLASS" : trustedTalOrigin !== undefined ? "BEST_TAL_ANCHOR" : "PATTERN_OVERRIDE_EXTERNAL" } : {}),
              ...(candidate.responseMove === undefined ? {} : { maiaReply: String(candidate.responseMove.uci) })
            })
        };
      }),
      selectedUci: String(selected.value.seed.move.uci),
      selectedReason: (selectionContext.stallCount ?? 0) >= 2 || selectionContext.repeatedPosition === true ? "PATTERN_STALL_FALLBACK_TO_TAL" : selected.value.immediateMate === true ? "IMMEDIATE_CHECKMATE" : selected.value.mateClass === true ? "FORCED_MATE_CLASS" : isTrustedTalCandidate(selected.value.seed) ? "BEST_TAL_ANCHOR" : "PATTERN_OVERRIDE_EXTERNAL",
      ...(selected.value.responseMove === undefined ? {} : { maiaReply: String(selected.value.responseMove.uci) })
    }
  });
};
