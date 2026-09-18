import type { SteeredRollout } from "../ports/pattern-steering";
import type { ForcedMateVerifier } from "../ports/forced-mate";
import { generateHumanPath } from "./human-path";
import { err } from "../../domain/shared/result";
import { domainError } from "../../domain/shared/errors";

export type SteeredRolloutArtifact = Readonly<{
  decision: Parameters<SteeredRollout>[0]["decision"];
  line: import("../../domain/scenario-lines/scenario-line").ScenarioLine;
  forcedMate?: import("../../domain/patterns/outcomes").ForcedMateVerification;
}>;

export const runSteeredRollout: SteeredRollout = async request => {
  const selected = request.decision.selected;
  if (selected.seed.provenance.inputPositionHash !== request.start.hash) {
    return err(domainError("MISSING_PROVENANCE", "patternSteering.rollout", "Selected candidate provenance does not match rollout start"));
  }
  // The decision is made before this call; HumanPath owns subsequent Maia/Stockfish effects.
  return generateHumanPath(request.chess, request.providers, {
    lineId: request.lineId,
    start: request.start,
    seed: selected.seed,
    horizon: request.horizon
  });
};

export const runSteeredRolloutArtifact = async (
  request: Parameters<SteeredRollout>[0],
  verifier?: ForcedMateVerifier
): Promise<import("../../domain/shared/result").Result<SteeredRolloutArtifact, import("../../domain/shared/errors").DomainError>> => {
  const line = await runSteeredRollout(request);
  if (line.tag === "Err") return line;
  if (verifier === undefined) return { tag: "Ok", value: { decision: request.decision, line: line.value } };
  let terminalPosition = request.start;
  for (const ply of line.value.plies) {
    const next = request.chess.applyMove(terminalPosition, ply.move);
    if (next.tag === "Err") return next;
    terminalPosition = next.value;
  }
  const proof = await verifier({ start: request.start, line: line.value, terminalPosition });
  if (proof.tag === "Err") return proof;
  return { tag: "Ok", value: { decision: request.decision, line: line.value, forcedMate: proof.value } };
};
