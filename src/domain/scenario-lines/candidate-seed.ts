import type { LegalMove } from "../chess/moves";
import { requireProvenance } from "../provenance/policy";
import type { MoveProvenance } from "../provenance/provenance";
import type { DomainError } from "../shared/errors";
import { isErr, ok, type Result } from "../shared/result";
import type { CandidateSeed } from "./scenario-line";

export const makeCandidateSeed = (
  move: LegalMove,
  provenance: MoveProvenance | null | undefined
): Result<CandidateSeed, DomainError> => {
  const provenanceResult = requireProvenance(provenance, "candidateSeed.provenance");
  return isErr(provenanceResult)
    ? provenanceResult
    : ok({ tag: "CandidateSeed", move, provenance: provenanceResult.value });
};
