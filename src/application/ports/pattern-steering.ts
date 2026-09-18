import type { CandidateSeed } from "../../domain/scenario-lines/scenario-line";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { ScenarioLine } from "../../domain/scenario-lines/scenario-line";
import type { HumanPathProviders } from "./providers";
import type { ScenarioHorizon } from "../../domain/chess/value-objects";
import type { ChessRulesPort } from "./chess-rules";
import type { DomainError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";

export type CandidateGeneratorRequest = Readonly<{
  position: PositionSnapshot;
  lineId: string;
  limit: number;
}>;

export type CandidateGenerator = (request: CandidateGeneratorRequest) => Promise<Result<readonly CandidateSeed[], DomainError>>;

export type SteeredRollout = (request: Readonly<{
  chess: ChessRulesPort;
  start: PositionSnapshot;
  decision: import("../use-cases/pattern-steering").PatternSteeringDecision;
  providers: HumanPathProviders;
  lineId: string;
  horizon: ScenarioHorizon;
}>) => Promise<Result<ScenarioLine, DomainError>>;
