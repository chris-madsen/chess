import type { ChessRulesPort } from "../ports/chess-rules";
import type { ForcedMateProofProvider, ForcedMateVerifier, ForcedMateVerifierRequest } from "../ports/forced-mate";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";
import type { ForcedMateVerification } from "../../domain/patterns/outcomes";

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

const malformedProof = (message: string, details: Readonly<Record<string, unknown>>): Result<ForcedMateVerification, DomainError> => (
  err(domainError("PROVIDER_MALFORMED_OUTPUT", "forcedMate.proof", message, details))
);

/**
 * ACL for an independent forced-mate provider. The provider owns search and
 * proof generation; this adapter only validates the proof boundary and keeps
 * terminal-mate facts separate from forced-mate verification.
 */
export const createForcedMateVerifier = (
  chess: ChessRulesPort,
  provider: ForcedMateProofProvider
): ForcedMateVerifier => async (request: ForcedMateVerifierRequest): Promise<Result<ForcedMateVerification, DomainError>> => {
  const facts = chess.computeFacts(request.terminalPosition);
  if (isErr(facts)) return err(facts.error);
  if (!facts.value.isCheckmate) {
    return ok({ status: "NOT_VERIFIED", provider: "terminal-guard", reason: "terminal position is not checkmate" });
  }

  const proof = await provider(request);
  if (isErr(proof)) return err(proof.error);
  const value = proof.value;
  if (value.provider.length === 0 || !isRecord(value.limits) || value.terminalPositionHash.length === 0) {
    return malformedProof("forced-mate proof is missing provider, limits, or terminal hash", { provider: value.provider });
  }
  if (value.terminalPositionHash !== String(request.terminalPosition.hash)) {
    return malformedProof("forced-mate proof terminal hash does not match the requested position", {
      expected: String(request.terminalPosition.hash),
      received: value.terminalPositionHash
    });
  }
  return ok({
    status: value.status,
    provider: value.provider,
    limits: value.limits,
    ...(value.proofReference === undefined ? {} : { reason: value.proofReference })
  });
};
