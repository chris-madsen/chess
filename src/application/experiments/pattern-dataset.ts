import type { ChessRulesPort } from "../ports/chess-rules";
import type { PatternExperimentCase } from "../use-cases/pattern-experiment";
import { isPatternFamilyId, type PatternFamilyId } from "../../domain/patterns/pattern";
import { makeScenarioHorizon } from "../../domain/chess/value-objects";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";

export type PatternDatasetEntry = Readonly<{
  caseId: string;
  datasetVersion: string;
  split: "calibration" | "evaluation";
  exampleKind: "positive" | "hard_negative" | "control";
  fen: string;
  family: PatternFamilyId;
  sourcePositionHash: string;
  source: Readonly<{ kind: string; reference: string; license?: string }>;
  solutionMoves?: readonly string[];
  trajectory?: readonly PatternTrajectoryState[];
  expected?: PatternGroundTruth;
  sourceCaseId?: string;
  perturbation?: Readonly<{ type: string; square: string; piece: string }>;
  /** Explicit attacker identity; inferred from trajectory ply 1 for legacy Lichess rows. */
  attackerSide?: "white" | "black";
  trajectoryStartPly?: number;
}>;

export type PatternTrajectoryState = Readonly<{
  ply: number;
  fen: string;
  distanceToTerminal: number;
}>;

export type PatternGroundTruth = Readonly<{
  terminalMate?: boolean;
  mateLength?: number;
  terminalFamily?: PatternFamilyId;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export const ingestPatternDatasetEntry = (raw: unknown, path = "dataset.entry"): Result<PatternDatasetEntry, DomainError> => {
  if (!isRecord(raw)) return err(domainError("INVALID_RAW_GAME", path, "Dataset entry must be an object"));
  const source = raw.source;
  const expected = raw.expected;
  if (typeof raw.caseId !== "string" || raw.caseId.length === 0) return err(domainError("INVALID_RAW_GAME", `${path}.caseId`, "caseId is required"));
  if (typeof raw.datasetVersion !== "string" || raw.datasetVersion.length === 0) return err(domainError("INVALID_RAW_GAME", `${path}.datasetVersion`, "datasetVersion is required"));
  if (raw.split !== "calibration" && raw.split !== "evaluation") return err(domainError("INVALID_RAW_GAME", `${path}.split`, "split must be calibration or evaluation"));
  if (raw.exampleKind !== "positive" && raw.exampleKind !== "hard_negative" && raw.exampleKind !== "control") return err(domainError("INVALID_RAW_GAME", `${path}.exampleKind`, "exampleKind must be positive, hard_negative, or control"));
  if (typeof raw.fen !== "string" || raw.fen.length === 0) return err(domainError("INVALID_FEN", `${path}.fen`, "fen is required"));
  if (raw.attackerSide !== undefined && raw.attackerSide !== "white" && raw.attackerSide !== "black") return err(domainError("INVALID_RAW_GAME", `${path}.attackerSide`, "attackerSide must be white or black"));
  if (typeof raw.family !== "string" || !isPatternFamilyId(raw.family)) return err(domainError("INVALID_RAW_GAME", `${path}.family`, "unsupported PatternFamily"));
  if (typeof raw.sourcePositionHash !== "string" || raw.sourcePositionHash.length === 0) return err(domainError("INVALID_RAW_GAME", `${path}.sourcePositionHash`, "sourcePositionHash is required"));
  if (!isRecord(source) || typeof source.kind !== "string" || typeof source.reference !== "string") return err(domainError("INVALID_RAW_GAME", `${path}.source`, "source.kind and source.reference are required"));
  if (expected !== undefined && !isRecord(expected)) return err(domainError("INVALID_RAW_GAME", `${path}.expected`, "expected must be an object"));
  const normalizedSolutionMoves = Array.isArray(raw.solutionMoves)
    ? raw.solutionMoves
    : typeof raw.solutionMoves === "string" ? raw.solutionMoves.split(/\s+/u).filter(Boolean) : undefined;
  if (normalizedSolutionMoves !== undefined && normalizedSolutionMoves.some(move => typeof move !== "string" || move.length === 0)) return err(domainError("INVALID_RAW_GAME", `${path}.solutionMoves`, "solutionMoves must contain non-empty strings"));
  if (raw.trajectory !== undefined && (!Array.isArray(raw.trajectory) || raw.trajectory.some(state => !isRecord(state) || typeof state.ply !== "number" || typeof state.fen !== "string" || typeof state.distanceToTerminal !== "number"))) return err(domainError("INVALID_RAW_GAME", `${path}.trajectory`, "trajectory must contain ply, fen, and distanceToTerminal"));
  const expectedRecord = isRecord(expected) ? expected : undefined;
  const terminalFamily = expectedRecord?.terminalFamily;
  if (terminalFamily !== undefined && (typeof terminalFamily !== "string" || !isPatternFamilyId(terminalFamily))) return err(domainError("INVALID_RAW_GAME", `${path}.expected.terminalFamily`, "unsupported terminal family"));
  const perturbation = raw.perturbation;
  if (perturbation !== undefined && (!isRecord(perturbation) || typeof perturbation.type !== "string" || typeof perturbation.square !== "string" || typeof perturbation.piece !== "string")) return err(domainError("INVALID_RAW_GAME", `${path}.perturbation`, "perturbation must contain type, square, and piece"));
  const trajectory = Array.isArray(raw.trajectory) ? raw.trajectory.map(state => {
    const record = state as Record<string, unknown>;
    return { ply: record.ply as number, fen: record.fen as string, distanceToTerminal: record.distanceToTerminal as number };
  }) : undefined;
  const trajectoryStartPly = typeof raw.trajectoryStartPly === "number" ? raw.trajectoryStartPly : trajectory?.some(state => state.ply === 1) === true ? 1 : 0;
  const inferredSide = typeof raw.attackerSide === "string" ? raw.attackerSide : undefined;
  return ok({
    caseId: raw.caseId,
    datasetVersion: raw.datasetVersion,
    split: raw.split,
    exampleKind: raw.exampleKind,
    fen: raw.fen,
    family: raw.family as PatternFamilyId,
    sourcePositionHash: raw.sourcePositionHash,
    source: {
      kind: source.kind,
      reference: source.reference,
      ...(typeof source.license === "string" ? { license: source.license } : {})
    },
    ...(normalizedSolutionMoves === undefined ? {} : { solutionMoves: normalizedSolutionMoves as string[] }),
    ...(trajectory === undefined ? {} : { trajectory }),
    ...(expectedRecord ? {
      expected: {
        ...(typeof expectedRecord.terminalMate === "boolean" ? { terminalMate: expectedRecord.terminalMate } : {}),
        ...(typeof expectedRecord.mateLength === "number" ? { mateLength: expectedRecord.mateLength } : {}),
        ...(typeof terminalFamily === "string" ? { terminalFamily: terminalFamily as PatternFamilyId } : {})
      }
    } : {}),
    ...(typeof raw.sourceCaseId === "string" ? { sourceCaseId: raw.sourceCaseId } : {}),
    ...(isRecord(perturbation) ? { perturbation: { type: perturbation.type as string, square: perturbation.square as string, piece: perturbation.piece as string } } : {}),
    ...(inferredSide === undefined ? {} : { attackerSide: inferredSide as "white" | "black" }),
    trajectoryStartPly
  });
};

export const parsePatternDataset = (
  chess: ChessRulesPort,
  text: string,
  horizonFullMoves: number,
  prefixPlies: number
): Result<readonly PatternExperimentCase[], DomainError> => {
  const cases: PatternExperimentCase[] = [];
  const horizon = makeScenarioHorizon(horizonFullMoves * 2);
  if (isErr(horizon)) return err(horizon.error);
  const lines = text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      return err(domainError("INVALID_RAW_GAME", `dataset.line.${index + 1}`, "Dataset line is not valid JSON"));
    }
    const entry = ingestPatternDatasetEntry(raw, `dataset.line.${index + 1}`);
    if (isErr(entry)) {
      return err(entry.error);
    }
    const position = chess.ingestPosition(entry.value.fen);
    if (isErr(position)) {
      return err(position.error);
    }
    if (String(position.value.hash) !== entry.value.sourcePositionHash) {
      return err(domainError("INVALID_RAW_GAME", `dataset.line.${index + 1}.sourcePositionHash`, "sourcePositionHash does not match the ingested FEN", {
        expected: String(position.value.hash),
        received: entry.value.sourcePositionHash
      }));
    }
    const actualStartFen = entry.value.trajectory?.find(state => state.ply === 1)?.fen;
    const actualStart = actualStartFen === undefined ? ok(position.value) : chess.ingestPosition(actualStartFen);
    if (isErr(actualStart)) return err(domainError("INVALID_RAW_GAME", `dataset.line.${index + 1}.trajectory`, "trajectory actual start is not a valid FEN", { cause: actualStart.error }));
    cases.push({
      caseId: entry.value.caseId,
      datasetVersion: entry.value.datasetVersion,
      split: entry.value.split,
      exampleKind: entry.value.exampleKind,
      family: entry.value.family,
      sourcePositionHash: entry.value.sourcePositionHash,
      source: entry.value.source,
      ...(entry.value.solutionMoves === undefined ? {} : { solutionMoves: entry.value.solutionMoves }),
      ...(entry.value.trajectory === undefined ? {} : { trajectory: entry.value.trajectory }),
      ...(entry.value.expected === undefined ? {} : { expected: entry.value.expected }),
      ...(entry.value.sourceCaseId === undefined ? {} : { sourceCaseId: entry.value.sourceCaseId }),
      ...(entry.value.perturbation === undefined ? {} : { perturbation: entry.value.perturbation }),
      // Lichess stores the pre-puzzle position; ply 1 is the actual puzzle start.
      position: actualStart.value,
      horizon: horizon.value,
      prefixPlies
    });
  }
  return ok(cases);
};
