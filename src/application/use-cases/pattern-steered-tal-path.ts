import type { ChessRulesPort } from "../ports/chess-rules";
import type { CandidateGenerator, CandidateTacticalGate } from "../ports/pattern-steering";
import type { MoveProvider } from "../ports/providers";
import type { ScenarioHorizon } from "../../domain/chess/value-objects";
import { makePlyIndex } from "../../domain/chess/value-objects";
import type { ScenarioLine, ScenarioPly } from "../../domain/scenario-lines/scenario-line";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";
import { evaluatePatternSteeringCandidates } from "./pattern-steering";
import type { PatternSteeringDecisionTrace } from "./pattern-steering";
import type { AnalysisCachePort } from "../ports/analysis-cache";
import type { PatternFamilyId } from "../../domain/patterns/pattern";
import { repetitionKey } from "../../domain/chess/repetition-key";
import { patternTargetTriggerFor } from "../../domain/patterns/thresholds";

export type PatternSteeredTalPathRequest = Readonly<{
  chess: ChessRulesPort;
  start: import("../../domain/chess/position").PositionSnapshot;
  attackerSide: import("../../domain/chess/value-objects").Side;
  generator: CandidateGenerator;
  tacticalGate?: CandidateTacticalGate | undefined;
  maia: MoveProvider;
  lineId: string;
  horizon: ScenarioHorizon;
  candidateLimit?: number;
  cache?: AnalysisCachePort;
  onProgress?: (line: ScenarioLine) => void;
  targetFamily?: PatternFamilyId;
  onTargetAffinity?: (event: Readonly<{
    targetFamily: PatternFamilyId;
    affinity: number;
    position: import("../../domain/chess/position").PositionSnapshot;
    prefixPlies: readonly ScenarioPly[];
  }>) => void;
}>;

const terminalLine = (request: PatternSteeredTalPathRequest, plies: readonly ScenarioPly[], status: ScenarioLine["status"], error?: DomainError): ScenarioLine => ({
  tag: "ScenarioLine",
  mode: "HumanPath",
  label: "PatternSteeredTalPath",
  start: request.start,
  horizon: request.horizon,
  plies,
  status,
  ...(error === undefined ? {} : { error }),
  ...(request.targetFamily === undefined ? {} : { targetFamily: request.targetFamily })
});

const progressLine = (request: PatternSteeredTalPathRequest, plies: readonly ScenarioPly[], decisionTraces: readonly PatternSteeringDecisionTrace[], status: ScenarioLine["status"] = "Incomplete"): ScenarioLine => ({
  ...terminalLine(request, plies, status),
  ...(decisionTraces.length === 0 ? {} : { decisionTraces })
});

export const generatePatternSteeredTalPath = async (
  request: PatternSteeredTalPathRequest
): Promise<Result<ScenarioLine, DomainError>> => {
  const maxPlies = Number(request.horizon);
  let current = request.start;
  const plies: ScenarioPly[] = [];
  const decisionTraces: PatternSteeringDecisionTrace[] = [];
  let attackerStallCount = 0;
  let previousTargetFamily: PatternFamilyId | undefined = request.targetFamily;
  const positionVisits = new Map<string, number>([[repetitionKey(current), 1]]);
  const emitTargetAffinities = (selected: import("./pattern-steering").PatternSteeringCandidate, position: import("../../domain/chess/position").PositionSnapshot, prefixPlies: readonly ScenarioPly[]): void => {
    if (request.targetFamily !== undefined) return;
    selected.postResponseFamilies
      .filter(assessment => assessment.similarity >= patternTargetTriggerFor(assessment.family))
      .forEach(assessment => request.onTargetAffinity?.({ targetFamily: assessment.family, affinity: assessment.similarity, position, prefixPlies }));
  };
  let plyNumber = 1;
  while (plyNumber <= maxPlies) {
    const facts = request.chess.computeFacts(current);
    if (isErr(facts)) return err(facts.error);
    if (facts.value.isTerminal) return ok(terminalLine(request, plies, "Terminal"));
    if (current.sideToMove === request.attackerSide) {
      const hasResponsePly = plyNumber + 1 <= maxPlies;
      const decision = await evaluatePatternSteeringCandidates(request.chess, current, request.generator, request.tacticalGate, request.maia, request.lineId, request.candidateLimit ?? 8, hasResponsePly, request.cache, request.targetFamily, {
        stallCount: attackerStallCount,
        repeatedPosition: (positionVisits.get(repetitionKey(current)) ?? 0) > 1,
        recentPositionKeys: [...positionVisits.keys()],
        ...(previousTargetFamily === undefined ? {} : { previousTargetFamily })
      });
      if (isErr(decision)) return ok(terminalLine(request, plies, "Incomplete", decision.error));
      decisionTraces.push(decision.value.trace);
      const selected = decision.value.selected;
      previousTargetFamily = selected.targetFamily;
      plies.push({ tag: "ScenarioPly", index: makePlyIndex(plyNumber), move: selected.seed.move, provenance: selected.seed.provenance });
      request.onProgress?.(progressLine(request, plies, decisionTraces, selected.terminalAfterCandidate === true ? "Terminal" : "Incomplete"));
      plyNumber += 1;
      const committedFacts = request.chess.computeFacts(selected.afterPosition);
      if (isErr(committedFacts)) return err(committedFacts.error);
      if (committedFacts.value.isTerminal || selected.terminalAfterCandidate === true) {
        emitTargetAffinities(selected, selected.afterPosition, [...plies]);
        return ok({ ...terminalLine(request, plies, "Terminal"), decisionTraces });
      }
      if (plyNumber > maxPlies) break;
      if (selected.responseMove === undefined || selected.responseProvenance === undefined || selected.postResponsePosition === undefined) break;
      const responseFacts = request.chess.computeFacts(selected.afterPosition);
      if (isErr(responseFacts)) return err(responseFacts.error);
      if (responseFacts.value.isTerminal) return ok({ ...terminalLine(request, plies, "Terminal"), decisionTraces });
      plies.push({ tag: "ScenarioPly", index: makePlyIndex(plyNumber), move: selected.responseMove, provenance: selected.responseProvenance });
      request.onProgress?.(progressLine(request, plies, decisionTraces));
      current = selected.postResponsePosition;
      if (selected.calibratedProgress <= 0.02) attackerStallCount += 1;
      else attackerStallCount = 0;
      const positionKey = repetitionKey(current);
      const visits = (positionVisits.get(positionKey) ?? 0) + 1;
      positionVisits.set(positionKey, visits);
      if (visits > 1) attackerStallCount = Math.max(attackerStallCount, 2);
      emitTargetAffinities(selected, current, [...plies]);
      plyNumber += 1;
      continue;
    }
    const response = await request.maia({ position: current, lineId: request.lineId, ply: plyNumber });
    if (isErr(response)) return ok(terminalLine(request, plies, "Incomplete", response.error));
    if (response.value.provenance.source !== "MAIA") return ok(terminalLine(request, plies, "Incomplete", domainError("SOURCE_SEQUENCE_VIOLATION", `patternSteeredTalPath.${plyNumber}.provenance.source`, "Defender ply must come from Maia", { source: response.value.provenance.source })));
    const legal = request.chess.parseLegalMove(current, response.value.move.uci);
    if (isErr(legal)) return ok(terminalLine(request, plies, "Incomplete", legal.error));
    const next = request.chess.applyMove(current, legal.value);
    if (isErr(next)) return err(next.error);
    plies.push({ tag: "ScenarioPly", index: makePlyIndex(plyNumber), move: legal.value, provenance: response.value.provenance });
    request.onProgress?.(progressLine(request, plies, decisionTraces));
    current = next.value;
    plyNumber += 1;
  }
  return ok({ ...terminalLine(request, plies, "Complete"), ...(decisionTraces.length === 0 ? {} : { decisionTraces }) });
};
