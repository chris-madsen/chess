import type { CandidateSeed } from "../../domain/scenario-lines/scenario-line";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { DomainError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";

export type CandidateGeneratorRequest = Readonly<{
  position: PositionSnapshot;
  lineId: string;
  limit: number;
}>;

export type CandidateGenerator = (request: CandidateGeneratorRequest) => Promise<Result<readonly CandidateSeed[], DomainError>>;
