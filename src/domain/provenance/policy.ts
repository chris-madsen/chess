import { domainError, type DomainError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { MoveProvenance } from "./provenance";

export const requireProvenance = (
  provenance: MoveProvenance | null | undefined,
  path: string
): Result<MoveProvenance, DomainError> => (
  provenance === null || provenance === undefined
    ? err(domainError("MISSING_PROVENANCE", path, "Move provenance is required"))
    : ok(provenance)
);
