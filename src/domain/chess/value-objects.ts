import { brandNumber, brandString, type Brand } from "../shared/branded";
import { domainError, type DomainError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export type Fen = Brand<string, "Fen">;
export type Pgn = Brand<string, "Pgn">;
export type SanMove = Brand<string, "SanMove">;
export type UciMove = Brand<string, "UciMove">;
export type PositionHash = Brand<string, "PositionHash">;
export type ScenarioHorizon = Brand<number, "ScenarioHorizon">;
export type PlyIndex = Brand<number, "PlyIndex">;
export type RunId = Brand<string, "RunId">;
export type RequestId = Brand<string, "RequestId">;

export type Side = "white" | "black";

export const makeFen = (value: string): Fen => brandString<"Fen">(value);
export const makePgn = (value: string): Pgn => brandString<"Pgn">(value);
export const makeSanMove = (value: string): SanMove => brandString<"SanMove">(value);
export const makeUciMove = (value: string): UciMove => brandString<"UciMove">(value);
export const makePositionHash = (value: string): PositionHash => brandString<"PositionHash">(value);
export const makeRunId = (value: string): RunId => brandString<"RunId">(value);
export const makeRequestId = (value: string): RequestId => brandString<"RequestId">(value);
export const makePlyIndex = (value: number): PlyIndex => brandNumber<"PlyIndex">(value);

export const makeScenarioHorizon = (value: number): Result<ScenarioHorizon, DomainError> => (
  Number.isInteger(value) && value > 0
    ? ok(brandNumber<"ScenarioHorizon">(value))
    : err(domainError("INVALID_HORIZON", "scenario.horizon", "Scenario horizon must be a positive integer", { value }))
);
