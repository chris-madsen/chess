import type { ChessRulesPort } from "../ports/chess-rules";
import type { HumanPathProviders, MoveProvider, ProvidedMove } from "../ports/providers";
import { makePlyIndex, type ScenarioHorizon } from "../../domain/chess/value-objects";
import type { CandidateSeed, ScenarioLine, ScenarioPly } from "../../domain/scenario-lines/scenario-line";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { MoveSource } from "../../domain/provenance/provenance";

export type GenerateHumanPathRequest = Readonly<{
  lineId: string;
  start: PositionSnapshot;
  seed: CandidateSeed;
  horizon: ScenarioHorizon;
}>;

type ProviderStep = Readonly<{
  source: MoveSource;
  provider: MoveProvider;
}>;

const expectedProviderForPly = (
  plyNumber: number,
  providers: HumanPathProviders
): ProviderStep => (
  plyNumber % 2 === 0
    ? { source: "MAIA", provider: providers.maia }
    : { source: "STOCKFISH", provider: providers.stockfish }
);

const rejectSourceMismatch = (
  expected: MoveSource,
  provided: ProvidedMove,
  path: string
): Result<ProvidedMove, DomainError> => (
  provided.provenance.source === expected
    ? ok(provided)
    : err(domainError("SOURCE_SEQUENCE_VIOLATION", path, "Provider returned a move with an unexpected source", {
      expected,
      actual: provided.provenance.source
    }))
);

export const generateHumanPath = async (
  chess: ChessRulesPort,
  providers: HumanPathProviders,
  request: GenerateHumanPathRequest
): Promise<Result<ScenarioLine, DomainError>> => {
  const horizon = Number(request.horizon);
  const seedValidation = chess.parseLegalMove(request.start, request.seed.move.uci);
  if (isErr(seedValidation)) {
    return err(seedValidation.error);
  }
  if (request.seed.provenance === undefined || request.seed.provenance === null) {
    return err(domainError("MISSING_PROVENANCE", "scenario.seed.provenance", "CandidateSeed provenance is required"));
  }

  const seedPly: ScenarioPly = {
    tag: "ScenarioPly",
    index: makePlyIndex(1),
    move: seedValidation.value,
    provenance: request.seed.provenance
  };

  let currentPositionResult = chess.applyMove(request.start, seedValidation.value);
  if (isErr(currentPositionResult)) {
    return err(currentPositionResult.error);
  }

  let currentPosition = currentPositionResult.value;
  const plies: ScenarioPly[] = [seedPly];

  for (let plyNumber = 2; plyNumber <= horizon; plyNumber += 1) {
    const factsResult = chess.computeFacts(currentPosition);
    if (isErr(factsResult)) {
      return err(factsResult.error);
    }
    if (factsResult.value.isTerminal) {
      return ok({
        tag: "ScenarioLine",
        mode: "HumanPath",
        label: "HumanPath ScenarioLine",
        start: request.start,
        horizon: request.horizon,
        plies,
        status: "Terminal"
      });
    }

    const step = expectedProviderForPly(plyNumber, providers);
    const providedResult = await step.provider({ position: currentPosition, lineId: request.lineId, ply: plyNumber });
    if (isErr(providedResult)) {
      return ok({
        tag: "ScenarioLine",
        mode: "HumanPath",
        label: "HumanPath ScenarioLine",
        start: request.start,
        horizon: request.horizon,
        plies,
        status: "Incomplete",
        error: providedResult.error
      });
    }

    const sourceChecked = rejectSourceMismatch(step.source, providedResult.value, `scenario.plies.${plyNumber}.provenance.source`);
    if (isErr(sourceChecked)) {
      return ok({
        tag: "ScenarioLine",
        mode: "HumanPath",
        label: "HumanPath ScenarioLine",
        start: request.start,
        horizon: request.horizon,
        plies,
        status: "Incomplete",
        error: sourceChecked.error
      });
    }

    const legalMove = chess.parseLegalMove(currentPosition, providedResult.value.move.uci);
    if (isErr(legalMove)) {
      return ok({
        tag: "ScenarioLine",
        mode: "HumanPath",
        label: "HumanPath ScenarioLine",
        start: request.start,
        horizon: request.horizon,
        plies,
        status: "Incomplete",
        error: domainError("PROVIDER_ILLEGAL_MOVE", `scenario.plies.${plyNumber}.move`, "Provider returned an illegal move", {
          provider: providedResult.value.provenance.provider.name,
          move: String(providedResult.value.move.uci)
        })
      });
    }

    plies.push({
      tag: "ScenarioPly",
      index: makePlyIndex(plyNumber),
      move: legalMove.value,
      provenance: providedResult.value.provenance
    });

    currentPositionResult = chess.applyMove(currentPosition, legalMove.value);
    if (isErr(currentPositionResult)) {
      return err(currentPositionResult.error);
    }
    currentPosition = currentPositionResult.value;
  }

  return ok({
    tag: "ScenarioLine",
    mode: "HumanPath",
    label: "HumanPath ScenarioLine",
    start: request.start,
    horizon: request.horizon,
    plies,
    status: "Complete"
  });
};

export const ensureDecisionIsNotPlatformCommand = (decisionTag: string): Result<true, DomainError> => (
  decisionTag === "PlatformCommand"
    ? err(domainError("EXTERNAL_WRITE_FORBIDDEN", "decision", "Decision must not become a platform command"))
    : ok(true)
);
