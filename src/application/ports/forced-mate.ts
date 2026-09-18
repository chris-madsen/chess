import type { ScenarioLine } from "../../domain/scenario-lines/scenario-line";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { DomainError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";
import type { ForcedMateVerification } from "../../domain/patterns/outcomes";

export type ForcedMateVerifierRequest = Readonly<{
  start: PositionSnapshot;
  line: ScenarioLine;
  terminalPosition: PositionSnapshot;
}>;

export type ForcedMateVerifier = (request: ForcedMateVerifierRequest) => Promise<Result<ForcedMateVerification, DomainError>>;
