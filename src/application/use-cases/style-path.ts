import type { ChessRulesPort } from "../ports/chess-rules";
import type { LocalStyleEngineProvider, MoveProvider, ProvidedMove, StylePathProviders } from "../ports/providers";
import { makePlyIndex, type ScenarioHorizon } from "../../domain/chess/value-objects";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { ScenarioLine, ScenarioPly } from "../../domain/scenario-lines/scenario-line";
import type { MoveSource } from "../../domain/provenance/provenance";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";

export type GenerateStylePathRequest = Readonly<{
  lineId: string;
  start: PositionSnapshot;
  horizon: ScenarioHorizon;
  styleDepth?: number;
  onProgress?: (line: ScenarioLine, engineKey?: string, styleDepth?: number) => void;
}>;

export type StylePathLineResult = Readonly<{
  engineKey: string;
  line: ScenarioLine;
  styleDepth?: number;
}>;

export type GenerateStylePathsRequest = GenerateStylePathRequest;

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

const incompleteLine = (
  start: PositionSnapshot,
  horizon: ScenarioHorizon,
  label: string,
  plies: readonly ScenarioPly[],
  error: DomainError
): ScenarioLine => ({
  tag: "ScenarioLine",
  mode: "StylePath",
  label,
  start,
  horizon,
  plies,
  status: "Incomplete",
  error
});

const completeLine = (
  start: PositionSnapshot,
  horizon: ScenarioHorizon,
  label: string,
  plies: readonly ScenarioPly[],
  status: "Complete" | "Terminal"
): ScenarioLine => ({
  tag: "ScenarioLine",
  mode: "StylePath",
  label,
  start,
  horizon,
  plies,
  status
});

const progressLine = (
  start: PositionSnapshot,
  horizon: ScenarioHorizon,
  label: string,
  plies: readonly ScenarioPly[]
): ScenarioLine => ({
  tag: "ScenarioLine",
  mode: "StylePath",
  label,
  start,
  horizon,
  plies,
  status: "Incomplete"
});


const numberConfigValue = (value: unknown): number | undefined => (
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
);

const styleDepthForEngine = (
  styleEngine: LocalStyleEngineProvider,
  requestedDepth: number | undefined
): number | undefined => (
  numberConfigValue(styleEngine.configuration.styleDepth) ?? requestedDepth
);

const providerForPly = (
  plyNumber: number,
  styleEngine: LocalStyleEngineProvider,
  maia: MoveProvider
): Readonly<{ source: MoveSource; provider: MoveProvider }> => (
  plyNumber % 2 === 1
    ? { source: "LOCAL_STYLE_ENGINE", provider: styleEngine.provideMove }
    : { source: "MAIA", provider: styleEngine.opponent ?? maia }
);

export const generateStylePath = async (
  chess: ChessRulesPort,
  providers: Pick<StylePathProviders, "maia">,
  styleEngine: LocalStyleEngineProvider,
  request: GenerateStylePathRequest
): Promise<Result<ScenarioLine, DomainError>> => {
  const horizon = Number(request.horizon);
  const styleDepth = styleDepthForEngine(styleEngine, request.styleDepth);
  let currentPosition = request.start;
  const plies: ScenarioPly[] = [];
  const label = styleEngine.label ?? `${styleEngine.identity.displayName} StylePath`;

  for (let plyNumber = 1; plyNumber <= horizon; plyNumber += 1) {
    const factsResult = chess.computeFacts(currentPosition);
    if (isErr(factsResult)) {
      return err(factsResult.error);
    }
    if (factsResult.value.isTerminal) {
      return ok(completeLine(request.start, request.horizon, label, plies, "Terminal"));
    }

    const step = providerForPly(plyNumber, styleEngine, providers.maia);
    const providerRequest = step.source === "LOCAL_STYLE_ENGINE" && styleDepth !== undefined
      ? {
        position: currentPosition,
        lineId: request.lineId,
        ply: plyNumber,
        searchLimit: { tag: "Depth" as const, depth: styleDepth }
      }
      : {
        position: currentPosition,
        lineId: request.lineId,
        ply: plyNumber
      };
    const providedResult = await step.provider(providerRequest);
    if (isErr(providedResult)) {
      return ok(incompleteLine(request.start, request.horizon, label, plies, providedResult.error));
    }

    const sourceChecked = rejectSourceMismatch(step.source, providedResult.value, `scenario.plies.${plyNumber}.provenance.source`);
    if (isErr(sourceChecked)) {
      return ok(incompleteLine(request.start, request.horizon, label, plies, sourceChecked.error));
    }

    const legalMove = chess.parseLegalMove(currentPosition, providedResult.value.move.uci);
    if (isErr(legalMove)) {
      return ok(incompleteLine(request.start, request.horizon, label, plies, domainError(
        "PROVIDER_ILLEGAL_MOVE",
        `scenario.plies.${plyNumber}.move`,
        "Provider returned an illegal move",
        {
          provider: providedResult.value.provenance.provider.name,
          move: String(providedResult.value.move.uci)
        }
      )));
    }

    plies.push({
      tag: "ScenarioPly",
      index: makePlyIndex(plyNumber),
      move: legalMove.value,
      provenance: providedResult.value.provenance
    });
    request.onProgress?.(progressLine(request.start, request.horizon, label, [...plies]), styleEngine.key, styleDepth);

    const nextPosition = chess.applyMove(currentPosition, legalMove.value);
    if (isErr(nextPosition)) {
      return err(nextPosition.error);
    }
    currentPosition = nextPosition.value;
  }

  const completed = completeLine(request.start, request.horizon, label, plies, "Complete");
  request.onProgress?.(completed, styleEngine.key, styleDepth);
  return ok(completed);
};

export const generateStylePaths = async (
  chess: ChessRulesPort,
  providers: StylePathProviders,
  request: GenerateStylePathsRequest
): Promise<Result<readonly StylePathLineResult[], DomainError>> => {
  const lines = await Promise.all(providers.styleEngines.map(async styleEngine => {
    const lineResult = await generateStylePath(chess, { maia: providers.maia }, styleEngine, {
      ...request,
      lineId: `${request.lineId}-${styleEngine.key}`,
      onProgress: (line, engineKey, progressStyleDepth) => request.onProgress?.(line, engineKey ?? styleEngine.key, progressStyleDepth)
    });
    if (isErr(lineResult)) {
      return lineResult;
    }
    const styleDepth = styleDepthForEngine(styleEngine, request.styleDepth);
    return ok({
      engineKey: styleEngine.key,
      line: lineResult.value,
      ...(styleDepth !== undefined ? { styleDepth } : {})
    });
  }));

  const values: StylePathLineResult[] = [];
  for (const line of lines) {
    if (isErr(line)) {
      return err(line.error);
    }
    values.push(line.value);
  }
  return ok(values);
};
