import type { SteeredRollout } from "../ports/pattern-steering";
import { generateHumanPath } from "./human-path";
import { err } from "../../domain/shared/result";
import { domainError } from "../../domain/shared/errors";

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
