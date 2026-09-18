import type { ChessRulesPort } from "../ports/chess-rules";
import type { CandidateGenerator, CandidateTacticalGate } from "../ports/pattern-steering";
import type { MoveProvider } from "../ports/providers";
import type { ScenarioHorizon } from "../../domain/chess/value-objects";
import { makePlyIndex } from "../../domain/chess/value-objects";
import type { ScenarioLine, ScenarioPly } from "../../domain/scenario-lines/scenario-line";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";
import { evaluatePatternSteeringCandidates } from "./pattern-steering";

export type PatternSteeredTalPathRequest = Readonly<{
  chess: ChessRulesPort;
  start: import("../../domain/chess/position").PositionSnapshot;
  attackerSide: import("../../domain/chess/value-objects").Side;
  generator: CandidateGenerator;
  tacticalGate: CandidateTacticalGate;
  maia: MoveProvider;
  lineId: string;
  horizon: ScenarioHorizon;
  candidateLimit?: number;
}>;

const terminalLine = (request: PatternSteeredTalPathRequest, plies: readonly ScenarioPly[], status: ScenarioLine["status"], error?: DomainError): ScenarioLine => ({
  tag: "ScenarioLine",
  mode: "HumanPath",
  label: "PatternSteeredTalPath",
  start: request.start,
  horizon: request.horizon,
  plies,
  status,
  ...(error === undefined ? {} : { error })
});

export const generatePatternSteeredTalPath = async (
  request: PatternSteeredTalPathRequest
): Promise<Result<ScenarioLine, DomainError>> => {
  const maxPlies = Number(request.horizon);
  let current = request.start;
  const plies: ScenarioPly[] = [];
  let plyNumber = 1;
  while (plyNumber <= maxPlies) {
    const facts = request.chess.computeFacts(current);
    if (isErr(facts)) return err(facts.error);
    if (facts.value.isTerminal) return ok(terminalLine(request, plies, "Terminal"));
    if (current.sideToMove === request.attackerSide) {
      const hasResponsePly = plyNumber + 1 <= maxPlies;
      const decision = await evaluatePatternSteeringCandidates(request.chess, current, request.generator, request.tacticalGate, request.maia, request.lineId, request.candidateLimit ?? 8, hasResponsePly);
      if (isErr(decision)) return ok(terminalLine(request, plies, "Incomplete", decision.error));
      const selected = decision.value.selected;
      plies.push({ tag: "ScenarioPly", index: makePlyIndex(plyNumber), move: selected.seed.move, provenance: selected.seed.provenance });
      plyNumber += 1;
      if (plyNumber > maxPlies) break;
      if (selected.responseMove === undefined || selected.responseProvenance === undefined || selected.postResponsePosition === undefined) break;
      const responseFacts = request.chess.computeFacts(selected.afterPosition);
      if (isErr(responseFacts)) return err(responseFacts.error);
      if (responseFacts.value.isTerminal) return ok(terminalLine(request, plies, "Terminal"));
      plies.push({ tag: "ScenarioPly", index: makePlyIndex(plyNumber), move: selected.responseMove, provenance: selected.responseProvenance });
      current = selected.postResponsePosition;
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
    current = next.value;
    plyNumber += 1;
  }
  return ok(terminalLine(request, plies, "Complete"));
};
