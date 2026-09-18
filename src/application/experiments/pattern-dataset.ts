import type { ChessRulesPort } from "../ports/chess-rules";
import type { PatternExperimentCase } from "../use-cases/pattern-experiment";
import { isPatternFamilyId, type PatternFamilyId } from "../../domain/patterns/pattern";
import { makeScenarioHorizon } from "../../domain/chess/value-objects";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";

export type PatternDatasetEntry = Readonly<{
  caseId: string;
  split: "calibration" | "evaluation";
  fen: string;
  family: PatternFamilyId;
  source: Readonly<{ kind: string; reference: string; license?: string }>;
  expected?: Readonly<{ terminalMate?: boolean; mateLength?: number }>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export const ingestPatternDatasetEntry = (raw: unknown, path = "dataset.entry"): Result<PatternDatasetEntry, DomainError> => {
  if (!isRecord(raw)) return err(domainError("INVALID_RAW_GAME", path, "Dataset entry must be an object"));
  const source = raw.source;
  const expected = raw.expected;
  if (typeof raw.caseId !== "string" || raw.caseId.length === 0) return err(domainError("INVALID_RAW_GAME", `${path}.caseId`, "caseId is required"));
  if (raw.split !== "calibration" && raw.split !== "evaluation") return err(domainError("INVALID_RAW_GAME", `${path}.split`, "split must be calibration or evaluation"));
  if (typeof raw.fen !== "string" || raw.fen.length === 0) return err(domainError("INVALID_FEN", `${path}.fen`, "fen is required"));
  if (typeof raw.family !== "string" || !isPatternFamilyId(raw.family)) return err(domainError("INVALID_RAW_GAME", `${path}.family`, "unsupported PatternFamily"));
  if (!isRecord(source) || typeof source.kind !== "string" || typeof source.reference !== "string") return err(domainError("INVALID_RAW_GAME", `${path}.source`, "source.kind and source.reference are required"));
  if (expected !== undefined && !isRecord(expected)) return err(domainError("INVALID_RAW_GAME", `${path}.expected`, "expected must be an object"));
  return ok({
    caseId: raw.caseId,
    split: raw.split,
    fen: raw.fen,
    family: raw.family as PatternFamilyId,
    source: {
      kind: source.kind,
      reference: source.reference,
      ...(typeof source.license === "string" ? { license: source.license } : {})
    },
    ...(isRecord(expected) ? {
      expected: {
        ...(typeof expected.terminalMate === "boolean" ? { terminalMate: expected.terminalMate } : {}),
        ...(typeof expected.mateLength === "number" ? { mateLength: expected.mateLength } : {})
      }
    } : {})
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
    cases.push({
      caseId: entry.value.caseId,
      split: entry.value.split,
      family: entry.value.family,
      source: entry.value.source,
      position: position.value,
      horizon: horizon.value,
      prefixPlies
    });
  }
  return ok(cases);
};
