import type { CandidateSeed } from "../../domain/scenario-lines/scenario-line";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { ScenarioLine } from "../../domain/scenario-lines/scenario-line";
import type { HumanPathProviders } from "./providers";
import type { ScenarioHorizon } from "../../domain/chess/value-objects";
import type { ChessRulesPort } from "./chess-rules";
import type { DomainError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";
import type { LegalMove } from "../../domain/chess/moves";

export type CandidateGeneratorRequest = Readonly<{
  position: PositionSnapshot;
  lineId: string;
  limit: number;
}>;

export type CandidateGenerator = ((request: CandidateGeneratorRequest) => Promise<Result<readonly CandidateSeed[], DomainError>>) & Readonly<{ dispose?: () => void }>;

export type EngineScore = Readonly<{
  kind: "centipawns" | "mate";
  value: number;
  bound?: "exact" | "lower" | "upper";
}>;

export type TacticalCandidateAssessment = Readonly<{
  seed: CandidateSeed;
  accepted: boolean;
  talScore?: EngineScore;
  talMate?: number;
  talPv?: readonly LegalMove[];
  reason?: string;
}>;

export type CandidateTacticalGate = ((request: Readonly<{
  position: PositionSnapshot;
  candidates: readonly CandidateSeed[];
  lineId: string;
}>) => Promise<Result<readonly TacticalCandidateAssessment[], DomainError>>) & Readonly<{ dispose?: () => void }>;

export type SteeredRollout = (request: Readonly<{
  chess: ChessRulesPort;
  start: PositionSnapshot;
  decision: import("../use-cases/pattern-steering").PatternSteeringDecision;
  providers: HumanPathProviders;
  lineId: string;
  horizon: ScenarioHorizon;
}>) => Promise<Result<ScenarioLine, DomainError>>;
