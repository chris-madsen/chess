import type { ChessRulesPort } from "../ports/chess-rules";
import type { MoveProvider } from "../ports/providers";
import type { CandidateGenerator, CandidateTacticalGate, TacticalCandidateAssessment } from "../ports/pattern-steering";
import type { CandidateSeed } from "../../domain/scenario-lines/scenario-line";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { PatternAssessment, PatternFamilyId } from "../../domain/patterns/pattern";
import { extractPatternPositionContext, makePatternAnalysisContext } from "../../domain/patterns/context";
import { retrievePatternFamilies } from "../../domain/patterns/matchers";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";

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
  progress: number;
}>;

export type PatternSteeringDecision = Readonly<{
  attackerSide: "white" | "black";
  selected: PatternSteeringCandidate;
  candidates: readonly PatternSteeringCandidate[];
}>;

const topScore = (assessments: readonly PatternAssessment[]): number => assessments[0]?.similarity ?? 0;
const scoreFor = (assessments: readonly PatternAssessment[], family: PatternFamilyId): number => assessments.find(assessment => assessment.family === family)?.similarity ?? 0;
const familyProgress = (before: readonly PatternAssessment[], after: readonly PatternAssessment[], postResponse: readonly PatternAssessment[]): Readonly<{ targetFamily: PatternFamilyId; beforeScore: number; afterCandidateScore: number; afterResponseScore: number; delta: number }> => {
  const families = [...new Set([...before, ...after, ...postResponse].map(assessment => assessment.family))];
  const best = families.map(family => ({ family, beforeScore: scoreFor(before, family), afterCandidateScore: scoreFor(after, family), afterResponseScore: scoreFor(postResponse, family) }))
    .map(candidate => ({ targetFamily: candidate.family, beforeScore: candidate.beforeScore, afterCandidateScore: candidate.afterCandidateScore, afterResponseScore: candidate.afterResponseScore, delta: candidate.afterResponseScore - candidate.beforeScore }))
    .sort((first, second) => second.delta - first.delta || String(first.targetFamily).localeCompare(String(second.targetFamily)))[0];
  return best ?? { targetFamily: "ANASTASIA", beforeScore: 0, afterCandidateScore: 0, afterResponseScore: 0, delta: 0 };
};

export const selectPatternSteeringCandidate = (
  candidates: readonly PatternSteeringCandidate[]
): Result<PatternSteeringCandidate, DomainError> => {
  const selected = [...candidates].sort((first, second) => second.patternDelta - first.patternDelta || topScore(second.postResponseFamilies) - topScore(first.postResponseFamilies) || String(first.seed.move.uci).localeCompare(String(second.seed.move.uci)))[0];
  return selected === undefined ? err(domainError("PROVIDER_UNAVAILABLE", "patternSteering.candidates", "No legal candidate survived Pattern steering evaluation")) : ok(selected);
};

export const evaluatePatternSteeringCandidates = async (
  chess: ChessRulesPort,
  position: Parameters<CandidateGenerator>[0]["position"],
  generator: CandidateGenerator,
  tacticalGate: CandidateTacticalGate,
  maia: MoveProvider,
  lineId: string,
  limit = 8,
  includeMaiaResponse = true
): Promise<Result<PatternSteeringDecision, DomainError>> => {
  const facts = chess.computeFacts(position);
  if (isErr(facts)) return err(facts.error);
  const analysis = makePatternAnalysisContext(position.sideToMove);
  const beforeContext = extractPatternPositionContext(position, facts.value, analysis);
  const beforeFamilies = retrievePatternFamilies(beforeContext, 34);
  const generated = await generator({ position, lineId, limit });
  if (isErr(generated)) return err(generated.error);
  const legalSeeds: CandidateSeed[] = [];
  for (const seed of generated.value) {
    const legal = chess.parseLegalMove(position, seed.move.uci);
    if (isErr(legal)) return err(domainError("PROVIDER_ILLEGAL_MOVE", "patternSteering.candidate", "Candidate generator returned an illegal move", { uci: seed.move.uci, cause: legal.error }));
    if (seed.provenance === undefined || seed.provenance.inputPositionHash !== position.hash) return err(domainError("MISSING_PROVENANCE", "patternSteering.candidate.provenance", "Candidate provenance must refer to the input position"));
    legalSeeds.push({ ...seed, move: legal.value });
  }
  const tactical = await tacticalGate({ position, candidates: legalSeeds, lineId });
  if (isErr(tactical)) return err(tactical.error);
  const tacticalByMove = new Map(tactical.value.map(assessment => [String(assessment.seed.move.uci), assessment]));
  const evaluated: PatternSteeringCandidate[] = [];
  for (const seed of legalSeeds) {
    const tacticalAssessment = tacticalByMove.get(String(seed.move.uci));
    if (tacticalAssessment === undefined) return err(domainError("PROVIDER_MALFORMED_OUTPUT", "patternSteering.tacticalGate", "Tal gate did not assess every legal candidate", { move: String(seed.move.uci) }));
    if (!tacticalAssessment.accepted) continue;
    const after = chess.applyMove(position, seed.move);
    if (isErr(after)) return err(after.error);
    const afterFacts = chess.computeFacts(after.value);
    if (isErr(afterFacts)) return err(afterFacts.error);
    const afterContext = extractPatternPositionContext(after.value, afterFacts.value, analysis);
    const afterFamilies = retrievePatternFamilies(afterContext, 34);
    if (!includeMaiaResponse) {
      const progress = familyProgress(beforeFamilies, afterFamilies, afterFamilies);
      evaluated.push({ seed, tactical: tacticalAssessment, afterPosition: after.value, beforeFamilies, afterFamilies, postResponseFamilies: afterFamilies, targetFamily: progress.targetFamily, beforeScore: progress.beforeScore, afterCandidateScore: progress.afterCandidateScore, afterResponseScore: progress.afterResponseScore, patternDelta: progress.delta, progress: progress.delta });
      continue;
    }
    const response = await maia({ position: after.value, lineId, ply: 2 });
    if (isErr(response)) return err(response.error);
    if (response.value.provenance.source !== "MAIA") return err(domainError("SOURCE_SEQUENCE_VIOLATION", "patternSteering.maia.source", "Steering response must come from Maia", { source: response.value.provenance.source }));
    const responseMove = chess.parseLegalMove(after.value, response.value.move.uci);
    if (isErr(responseMove)) return err(domainError("PROVIDER_ILLEGAL_MOVE", "patternSteering.maia.move", "Maia returned an illegal response", { uci: response.value.move.uci, cause: responseMove.error }));
    const postResponse = chess.applyMove(after.value, responseMove.value);
    if (isErr(postResponse)) return err(postResponse.error);
    const responseFacts = chess.computeFacts(postResponse.value);
    if (isErr(responseFacts)) return err(responseFacts.error);
    const postResponseContext = extractPatternPositionContext(postResponse.value, responseFacts.value, analysis);
    const postResponseFamilies = retrievePatternFamilies(postResponseContext, 34);
    const progress = familyProgress(beforeFamilies, afterFamilies, postResponseFamilies);
    evaluated.push({ seed, tactical: tacticalAssessment, afterPosition: after.value, responseMove: responseMove.value, responseProvenance: response.value.provenance, postResponsePosition: postResponse.value, beforeFamilies, afterFamilies, postResponseFamilies, targetFamily: progress.targetFamily, beforeScore: progress.beforeScore, afterCandidateScore: progress.afterCandidateScore, afterResponseScore: progress.afterResponseScore, patternDelta: progress.delta, progress: progress.delta });
  }
  const selected = selectPatternSteeringCandidate(evaluated);
  if (isErr(selected)) return err(selected.error);
  return ok({ attackerSide: analysis.attackerSide, selected: selected.value, candidates: evaluated });
};
