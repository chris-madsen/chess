import type { CandidateGenerator } from "../ports/pattern-steering";
import type { MoveProvider } from "../ports/providers";
import type { ChessRulesPort } from "../ports/chess-rules";
import { domainError } from "../../domain/shared/errors";
import { err, isErr, ok } from "../../domain/shared/result";

/**
 * Builds a legal, provenance-preserving candidate pool from existing engines.
 * Providers are queried once per position and duplicate UCI moves are removed.
 */
export const candidateGeneratorFromProviders = (
  chess: ChessRulesPort,
  providers: readonly MoveProvider[]
): CandidateGenerator => async request => {
  if (request.limit < 1) {
    return err(domainError("INVALID_HORIZON", "patternSteering.limit", "Candidate limit must be positive"));
  }
  const seen = new Set<string>();
  const candidates = [];
  for (const provider of providers.slice(0, request.limit)) {
    const provided = await provider({ position: request.position, lineId: request.lineId, ply: 1 });
    if (isErr(provided)) return err(provided.error);
    const legal = chess.parseLegalMove(request.position, provided.value.move.uci);
    if (isErr(legal)) return err(domainError("PROVIDER_ILLEGAL_MOVE", "patternSteering.candidatePool", "Candidate provider returned an illegal move", { uci: provided.value.move.uci, cause: legal.error }));
    const uci = String(legal.value.uci);
    if (!seen.has(uci)) {
      seen.add(uci);
      candidates.push({ tag: "CandidateSeed" as const, move: legal.value, provenance: provided.value.provenance });
    }
  }
  return ok(candidates);
};
