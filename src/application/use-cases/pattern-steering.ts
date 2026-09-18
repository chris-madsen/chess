import type { ChessRulesPort } from "../ports/chess-rules";
import type { MoveProvider } from "../ports/providers";
import type { CandidateGenerator } from "../ports/pattern-steering";
import type { CandidateSeed } from "../../domain/scenario-lines/scenario-line";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { PatternAssessment } from "../../domain/patterns/pattern";
import { extractPatternPositionContext, makePatternAnalysisContext } from "../../domain/patterns/context";
import { retrievePatternFamilies } from "../../domain/patterns/matchers";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";

export type PatternSteeringCandidate = Readonly<{
  seed: CandidateSeed;
  afterPosition: PositionSnapshot;
  beforeFamilies: readonly PatternAssessment[];
  afterFamilies: readonly PatternAssessment[];
  postResponseFamilies: readonly PatternAssessment[];
  progress: number;
}>;

export type PatternSteeringDecision = Readonly<{
  attackerSide: "white" | "black";
  selected: PatternSteeringCandidate;
  candidates: readonly PatternSteeringCandidate[];
}>;

const topScore = (assessments: readonly PatternAssessment[]): number => assessments[0]?.similarity ?? 0;

export const selectPatternSteeringCandidate = (
  candidates: readonly PatternSteeringCandidate[]
): Result<PatternSteeringCandidate, DomainError> => {
  const selected = [...candidates].sort((first, second) => second.progress - first.progress || topScore(second.postResponseFamilies) - topScore(first.postResponseFamilies) || String(first.seed.move.uci).localeCompare(String(second.seed.move.uci)))[0];
  return selected === undefined ? err(domainError("PROVIDER_UNAVAILABLE", "patternSteering.candidates", "No legal candidate survived Pattern steering evaluation")) : ok(selected);
};

export const evaluatePatternSteeringCandidates = async (
  chess: ChessRulesPort,
  position: Parameters<CandidateGenerator>[0]["position"],
  generator: CandidateGenerator,
  maia: MoveProvider,
  lineId: string,
  limit = 8
): Promise<Result<PatternSteeringDecision, DomainError>> => {
  const facts = chess.computeFacts(position);
  if (isErr(facts)) return err(facts.error);
  const analysis = makePatternAnalysisContext(position.sideToMove);
  const beforeContext = extractPatternPositionContext(position, facts.value, analysis);
  const beforeFamilies = retrievePatternFamilies(beforeContext, limit);
  const generated = await generator({ position, lineId, limit });
  if (isErr(generated)) return err(generated.error);
  const evaluated: PatternSteeringCandidate[] = [];
  for (const seed of generated.value) {
    const legal = chess.parseLegalMove(position, seed.move.uci);
    if (isErr(legal)) return err(domainError("PROVIDER_ILLEGAL_MOVE", "patternSteering.candidate", "Candidate generator returned an illegal move", { uci: seed.move.uci, cause: legal.error }));
    if (seed.provenance === undefined || seed.provenance.inputPositionHash !== position.hash) return err(domainError("MISSING_PROVENANCE", "patternSteering.candidate.provenance", "Candidate provenance must refer to the input position"));
    const after = chess.applyMove(position, legal.value);
    if (isErr(after)) return err(after.error);
    const afterFacts = chess.computeFacts(after.value);
    if (isErr(afterFacts)) return err(afterFacts.error);
    const afterContext = extractPatternPositionContext(after.value, afterFacts.value, analysis);
    const afterFamilies = retrievePatternFamilies(afterContext, limit);
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
    const postResponseFamilies = retrievePatternFamilies(postResponseContext, limit);
    evaluated.push({ seed, afterPosition: after.value, beforeFamilies, afterFamilies, postResponseFamilies, progress: topScore(postResponseFamilies) - topScore(beforeFamilies) });
  }
  const selected = selectPatternSteeringCandidate(evaluated);
  if (isErr(selected)) return err(selected.error);
  return ok({ attackerSide: analysis.attackerSide, selected: selected.value, candidates: evaluated });
};
