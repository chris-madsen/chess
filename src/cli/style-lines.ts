#!/usr/bin/env node
import { readFileSync, watch } from "node:fs";
import { basename } from "node:path";
import { setInterval, clearInterval, setTimeout } from "node:timers";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import type { ChessRulesPort } from "../application/ports/chess-rules";
import type { StylePathProviders } from "../application/ports/providers";
import { generateStylePaths, type StylePathLineResult } from "../application/use-cases/style-path";
import { makePlyIndex, makeScenarioHorizon, type ScenarioHorizon } from "../domain/chess/value-objects";
import type { PositionSnapshot } from "../domain/chess/position";
import type { ScenarioLine, ScenarioPly } from "../domain/scenario-lines/scenario-line";
import type { DomainError } from "../domain/shared/errors";
import { isErr, type Result } from "../domain/shared/result";
import { createLocalStylePathProviders, createWindowsCstalStylePathProviders, type WindowsCstalOpponent } from "../wiring/local-style-engines";

export type CliInput =
  | Readonly<{ tag: "Fen"; value: string }>
  | Readonly<{ tag: "RawFile"; path: string }>;

export type CliOptions = Readonly<{
  input: CliInput;
  watchMode: boolean;
  refreshMs: number;
  engineSuite: "local-style" | "cstal-windows";
  cstalOpponent: WindowsCstalOpponent;
  maia3Elo: number;
}>;

export type AnalysisSettings = Readonly<{
  horizonMoves: number;
  styleDepth: number;
}>;

export type AdaptiveAnalysisState = Readonly<{
  settings: AnalysisSettings;
  lastLineSignature?: string;
  stableSinceMs: number;
  depthLastIncreasedAtMs: number;
  horizonLastIncreasedAtMs: number;
}>;

export const INITIAL_ANALYSIS_SETTINGS: AnalysisSettings = { horizonMoves: 8, styleDepth: 13 };
export const DEPTH_STABLE_MS = 5000;
export const HORIZON_STABLE_MS = 10000;
export const DEPTH_STEP = 2;
export const HORIZON_STEP = 2;

export type CliPorts = Readonly<{
  chess: ChessRulesPort;
  providers: StylePathProviders;
  readTextFile: (path: string) => string;
  write: (text: string) => void;
  writeError: (text: string) => void;
}>;

export const WATCH_CLEAR_TO_END = "\x1b[J";

const terminalColumns = (): number => {
  const fromStdout = process.stdout.columns;
  if (Number.isInteger(fromStdout) && fromStdout > 0) {
    return fromStdout;
  }
  const fromEnv = Number(process.env.COLUMNS);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 80;
};

const renderedLineCount = (text: string, columns = terminalColumns()): number => {
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (normalized.length === 0) {
    return 0;
  }
  return normalized.split("\n").reduce((count, line) => (
    count + Math.max(1, Math.ceil(line.length / Math.max(1, columns)))
  ), 0);
};

const renderWatchUpdateFrame = (text: string, previousLineCount: number): string => (
  previousLineCount <= 0
    ? text
    : `\x1b[${previousLineCount}F${WATCH_CLEAR_TO_END}${text}`
);

const usage = `Usage:\n  npm run style:lines -- --fen "<fen>" [--watch]\n  npm run style:lines -- --raw-file game.txt [--watch]\n  npm run style:lines:cstal -- --fen "<fen>" [--watch]\n\nOptions:\n  --fen <fen>                 Analyze a FEN position.\n  --raw-file <path>          Read RAW SAN game notation from a text file.\n  --engine-suite <id>        Engine suite: local-style or cstal-windows. Default local-style.\n  --cstal-opponent <id>      CSTal opponent: maia3 or maia1900. Default maia3.\n  --maia3-elo <rating>       Maia3 Elo conditioning, integer 1..4000. Default 1900.\n  --watch                    Re-read changed input and refresh output every 2 seconds.\n  --refresh-ms <ms>          Watch render interval, default 2000.\n\nAdaptive watch starts at depth 13 and horizon 8 full moves. Stable lines increase depth every 5 seconds and horizon every 10 seconds while the process is running.\n`;

const valueAfter = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

export const parseCliOptions = (args: readonly string[]): Result<CliOptions, DomainError> => {
  const fen = valueAfter(args, "--fen");
  const rawFile = valueAfter(args, "--raw-file");
  const engineSuiteRaw = valueAfter(args, "--engine-suite") ?? "local-style";
  const cstalOpponentRaw = valueAfter(args, "--cstal-opponent") ?? "maia3";
  const maia3EloRaw = valueAfter(args, "--maia3-elo") ?? "1900";
  if ((fen === undefined && rawFile === undefined) || (fen !== undefined && rawFile !== undefined)) {
    return {
      tag: "Err",
      error: {
        code: "INVALID_MOVE_NOTATION",
        path: "cli.input",
        message: "Provide exactly one of --fen or --raw-file"
      }
    };
  }
  if (args.includes("--horizon")) {
    return {
      tag: "Err",
      error: {
        code: "INVALID_HORIZON",
        path: "cli.horizon",
        message: "--horizon was removed from the user CLI; watch mode increases horizon adaptively"
      }
    };
  }
  const refreshRaw = valueAfter(args, "--refresh-ms") ?? "2000";
  const refreshMs = Number(refreshRaw);
  if (!Number.isInteger(refreshMs) || refreshMs < 250) {
    return {
      tag: "Err",
      error: {
        code: "INVALID_MOVE_NOTATION",
        path: "cli.refreshMs",
        message: "--refresh-ms must be an integer >= 250",
        details: { value: refreshRaw }
      }
    };
  }
  if (engineSuiteRaw !== "local-style" && engineSuiteRaw !== "cstal-windows") {
    return {
      tag: "Err",
      error: {
        code: "INVALID_MOVE_NOTATION",
        path: "cli.engineSuite",
        message: "--engine-suite must be local-style or cstal-windows",
        details: { value: engineSuiteRaw }
      }
    };
  }
  if (cstalOpponentRaw !== "maia3" && cstalOpponentRaw !== "maia1900") {
    return {
      tag: "Err",
      error: {
        code: "INVALID_MOVE_NOTATION",
        path: "cli.cstalOpponent",
        message: "--cstal-opponent must be maia3 or maia1900",
        details: { value: cstalOpponentRaw }
      }
    };
  }
  const maia3Elo = Number(maia3EloRaw);
  if (!Number.isInteger(maia3Elo) || maia3Elo < 1 || maia3Elo > 4000) {
    return {
      tag: "Err",
      error: {
        code: "INVALID_MOVE_NOTATION",
        path: "cli.maia3Elo",
        message: "--maia3-elo must be an integer between 1 and 4000",
        details: { value: maia3EloRaw }
      }
    };
  }
  return {
    tag: "Ok",
    value: {
      input: fen === undefined ? { tag: "RawFile", path: rawFile as string } : { tag: "Fen", value: fen },
      watchMode: args.includes("--watch"),
      refreshMs,
      engineSuite: engineSuiteRaw,
      cstalOpponent: cstalOpponentRaw,
      maia3Elo
    }
  };
};

export type IngestedCliInput = Readonly<{
  position: PositionSnapshot;
  baseSanMoves: readonly string[];
  lineStartFullmove: number;
  lineStartSide: "white" | "black";
}>;

const stripRawGameNoise = (rawGame: string): string => rawGame
  .replace(/\{[^}]*\}/g, " ")
  .replace(/;[^\n\r]*/g, " ")
  .replace(/\([^)]*\)/g, " ")
  .replace(/\$\d+/g, " ")
  .replace(/\b\d+\.(\.\.)?/g, " ")
  .replace(/\b(?:1-0|0-1|1\/2-1\/2|\*)\b/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const rawSanTokens = (rawGame: string): readonly string[] => {
  const cleaned = stripRawGameNoise(rawGame);
  return cleaned.length === 0 ? [] : cleaned.split(" ").filter(Boolean);
};

const sideFromFenTurn = (turn: string): "white" | "black" => turn === "b" ? "black" : "white";

const fullmoveFromFen = (fen: string): number => {
  const fields = fen.trim().split(/\s+/);
  const fullmove = Number(fields[5] ?? "1");
  return Number.isInteger(fullmove) && fullmove > 0 ? fullmove : 1;
};

const sideToMoveFromFen = (fen: string): "white" | "black" => sideFromFenTurn(fen.trim().split(/\s+/)[1] ?? "w");

const ingestInput = (options: CliOptions, ports: Pick<CliPorts, "chess" | "readTextFile">): Result<IngestedCliInput, DomainError> => {
  if (options.input.tag === "Fen") {
    const position = ports.chess.ingestPosition(options.input.value);
    if (isErr(position)) {
      return position;
    }
    return {
      tag: "Ok",
      value: {
        position: position.value,
        baseSanMoves: [],
        lineStartFullmove: fullmoveFromFen(String(position.value.fen)),
        lineStartSide: sideToMoveFromFen(String(position.value.fen))
      }
    };
  }

  const rawGame = ports.readTextFile(options.input.path);
  const position = ports.chess.ingestRawGame(rawGame);
  if (isErr(position)) {
    return position;
  }
  return {
    tag: "Ok",
    value: {
      position: position.value,
      baseSanMoves: rawSanTokens(rawGame),
      lineStartFullmove: 1,
      lineStartSide: "white"
    }
  };
};

const wrapMovetext = (text: string, width = 72): string => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line.length === 0 ? word : `${line} ${word}`;
    if (next.length > width && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join("\n");
};

const formatSanMovetext = (
  sanMoves: readonly string[],
  startFullmove: number,
  startSide: "white" | "black"
): string => {
  const chunks: string[] = [];
  let fullmove = startFullmove;
  let side = startSide;
  for (const san of sanMoves) {
    if (side === "white") {
      chunks.push(`${fullmove}. ${san}`);
      side = "black";
    } else {
      if (chunks.length === 0) {
        chunks.push(`${fullmove}... ${san}`);
      } else {
        chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${san}`;
      }
      fullmove += 1;
      side = "white";
    }
  }
  return wrapMovetext(chunks.join(" "));
};

export const renderStylePathResults = (
  ingested: IngestedCliInput,
  results: readonly StylePathLineResult[],
  generatedAtIso: string,
  settings: AnalysisSettings
): string => {
  const lines: string[] = [];
  results.forEach(result => {
    const line = result.line;
    const continuation = line.plies.map(ply => String(ply.move.san));
    const movetext = formatSanMovetext(
      [...ingested.baseSanMoves, ...continuation],
      ingested.lineStartFullmove,
      ingested.lineStartSide
    );
    lines.push(`## ${line.label} depth ${result.styleDepth ?? settings.styleDepth} horizon ${settings.horizonMoves}`);
    if (movetext.length > 0) {
      lines.push(movetext);
    } else {
      lines.push("(no moves)");
    }
    if (line.status !== "Complete" && (line.status !== "Incomplete" || line.error !== undefined)) {
      lines.push(`status: ${line.status}`);
    }
    if (line.error !== undefined) {
      lines.push(renderErrorLine(line.error));
    }
    lines.push("");
  });
  lines.push(
    `StylePath analysis @ ${generatedAtIso}`,
    `Position: ${String(ingested.position.fen)}`,
    `Player side inferred from turn: ${ingested.position.sideToMove}`,
    `Adaptive settings: style depth ${settings.styleDepth}, horizon ${settings.horizonMoves} full moves`
  );
  return `${lines.join("\n").trimEnd()}\n`;
};

const numberConfigValue = (value: unknown): number | undefined => (
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
);

const styleDepthForCliEngine = (
  engine: StylePathProviders["styleEngines"][number],
  fallbackDepth: number
): number => numberConfigValue(engine.configuration.styleDepth) ?? fallbackDepth;

type WatchProgress = Readonly<{
  startedAtMs: number;
  ingested: IngestedCliInput;
  settings: AnalysisSettings;
  partialResults: ReadonlyMap<string, StylePathLineResult>;
}>;

const renderWatchProgress = (
  progress: WatchProgress,
  providers: StylePathProviders,
  nowMs: number
): string => {
  const lines: string[] = [];
  providers.styleEngines.forEach(engine => {
    const result = progress.partialResults.get(engine.key);
    if (result !== undefined) {
      const rendered = renderStylePathResults(progress.ingested, [result], new Date(nowMs).toISOString(), progress.settings)
        .split("\n")
        .filter(line => !line.startsWith("StylePath analysis @") && !line.startsWith("Position:") && !line.startsWith("Player side inferred") && !line.startsWith("Adaptive settings:"))
        .join("\n")
        .trimEnd();
      lines.push(rendered, "");
      return;
    }
    lines.push(
      `## ${engine.label ?? `${engine.identity.displayName} StylePath`} depth ${styleDepthForCliEngine(engine, progress.settings.styleDepth)} horizon ${progress.settings.horizonMoves}`,
      "status: Analyzing",
      ""
    );
  });
  lines.push(
    `StylePath analysis @ ${new Date(nowMs).toISOString()}`,
    `Position: ${String(progress.ingested.position.fen)}`,
    `Player side inferred from turn: ${progress.ingested.position.sideToMove}`,
    `Adaptive settings: style depth ${progress.settings.styleDepth}, horizon ${progress.settings.horizonMoves} full moves`
  );
  return `${lines.join("\n").trimEnd()}\n`;
};

export type StylePathRenderedSnapshot = Readonly<{
  text: string;
  lineSignature: string;
}>;

const lineSignature = (results: readonly StylePathLineResult[]): string => (
  results.map(result => [
    result.engineKey,
    result.line.status,
    result.line.plies.map(ply => String(ply.move.uci)).join(","),
    result.line.error?.code ?? ""
  ].join(":"))
    .join("|")
);

export const nextAdaptiveAnalysisState = (
  state: AdaptiveAnalysisState,
  lineSignatureValue: string,
  nowMs: number
): AdaptiveAnalysisState => {
  if (state.lastLineSignature !== lineSignatureValue) {
    return {
      settings: state.settings,
      lastLineSignature: lineSignatureValue,
      stableSinceMs: nowMs,
      depthLastIncreasedAtMs: nowMs,
      horizonLastIncreasedAtMs: nowMs
    };
  }

  const shouldIncreaseDepth = nowMs - state.depthLastIncreasedAtMs >= DEPTH_STABLE_MS;
  const shouldIncreaseHorizon = nowMs - state.horizonLastIncreasedAtMs >= HORIZON_STABLE_MS;
  return {
    settings: {
      styleDepth: shouldIncreaseDepth ? state.settings.styleDepth + DEPTH_STEP : state.settings.styleDepth,
      horizonMoves: shouldIncreaseHorizon ? state.settings.horizonMoves + HORIZON_STEP : state.settings.horizonMoves
    },
    lastLineSignature: lineSignatureValue,
    stableSinceMs: state.stableSinceMs,
    depthLastIncreasedAtMs: shouldIncreaseDepth ? nowMs : state.depthLastIncreasedAtMs,
    horizonLastIncreasedAtMs: shouldIncreaseHorizon ? nowMs : state.horizonLastIncreasedAtMs
  };
};

export const analyzeStylePathSnapshot = async (
  options: CliOptions,
  ports: CliPorts,
  settings: AnalysisSettings = INITIAL_ANALYSIS_SETTINGS
): Promise<Result<StylePathRenderedSnapshot, DomainError>> => {
  const inputResult = ingestInput(options, ports);
  if (isErr(inputResult)) {
    return inputResult;
  }
  const horizonResult = makeScenarioHorizon(settings.horizonMoves * 2);
  if (isErr(horizonResult)) {
    return horizonResult;
  }
  const linesResult = await generateStylePaths(ports.chess, ports.providers, {
    lineId: `style-${inputResult.value.position.hash}`,
    start: inputResult.value.position,
    horizon: horizonResult.value,
    styleDepth: settings.styleDepth
  });
  if (isErr(linesResult)) {
    return linesResult;
  }
  return {
    tag: "Ok",
    value: {
      text: renderStylePathResults(inputResult.value, linesResult.value, new Date().toISOString(), settings),
      lineSignature: lineSignature(linesResult.value)
    }
  };
};

export const analyzeStylePathsOnce = async (
  options: CliOptions,
  ports: CliPorts,
  settings: AnalysisSettings = INITIAL_ANALYSIS_SETTINGS
): Promise<Result<string, DomainError>> => {
  const snapshot = await analyzeStylePathSnapshot(options, ports, settings);
  return isErr(snapshot) ? snapshot : { tag: "Ok", value: snapshot.value.text };
};

const sleep = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));

const runOneShotStreaming = async (
  options: CliOptions,
  ports: CliPorts,
  settings: AnalysisSettings = INITIAL_ANALYSIS_SETTINGS
): Promise<number> => {
  const inputResult = ingestInput(options, ports);
  if (isErr(inputResult)) {
    ports.writeError(`${inputResult.error.code}: ${inputResult.error.message}\n`);
    return 1;
  }
  const horizonResult = makeScenarioHorizon(settings.horizonMoves * 2);
  if (isErr(horizonResult)) {
    ports.writeError(`${horizonResult.error.code}: ${horizonResult.error.message}\n`);
    return 1;
  }

  const ingested = inputResult.value;
  const partialResults = new Map<string, StylePathLineResult>();
  let lastRenderedLineCount = 0;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let lastProgressRenderAtMs = 0;
  const progressRenderIntervalMs = Math.min(Math.max(options.refreshMs, 100), 500);
  const render = (): void => {
    const text = renderWatchProgress({
      startedAtMs: Date.now(),
      ingested,
      settings,
      partialResults
    }, ports.providers, Date.now());
    ports.write(renderWatchUpdateFrame(text, lastRenderedLineCount));
    lastRenderedLineCount = renderedLineCount(text);
    lastProgressRenderAtMs = Date.now();
  };
  const scheduleProgressRender = (): void => {
    if (renderTimer !== undefined) {
      return;
    }
    const elapsedMs = Date.now() - lastProgressRenderAtMs;
    if (elapsedMs >= progressRenderIntervalMs) {
      render();
      return;
    }
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      render();
    }, progressRenderIntervalMs - elapsedMs);
  };
  const cancelScheduledRender = (): void => {
    if (renderTimer === undefined) {
      return;
    }
    clearTimeout(renderTimer);
    renderTimer = undefined;
  };

  render();
  const linesResult = await generateStylePaths(ports.chess, ports.providers, {
    lineId: `style-${ingested.position.hash}`,
    start: ingested.position,
    horizon: horizonResult.value,
    styleDepth: settings.styleDepth,
    onProgress: (line, engineKey, progressStyleDepth) => {
      const key = engineKey ?? line.label;
      partialResults.set(key, {
        engineKey: key,
        line,
        ...(progressStyleDepth !== undefined ? { styleDepth: progressStyleDepth } : {})
      });
      scheduleProgressRender();
    }
  });
  cancelScheduledRender();
  if (isErr(linesResult)) {
    ports.writeError(`${linesResult.error.code}: ${linesResult.error.message}\n`);
    return 1;
  }

  partialResults.clear();
  linesResult.value.forEach(result => partialResults.set(result.engineKey, result));
  render();
  return 0;
};

type ContinuousLineState = {
  currentPosition: PositionSnapshot;
  plies: ScenarioPly[];
  status: "Incomplete" | "Complete" | "Terminal";
  error?: DomainError;
  retryAfterMs?: number;
};

const scenarioLineForState = (
  start: PositionSnapshot,
  horizon: ScenarioHorizon,
  label: string,
  state: ContinuousLineState
): ScenarioLine => ({
  tag: "ScenarioLine",
  mode: "StylePath",
  label,
  start,
  horizon,
  plies: [...state.plies],
  status: state.status,
  ...(state.error !== undefined ? { error: state.error } : {})
});

const isTransientProviderError = (error: DomainError): boolean => (
  error.code === "PROVIDER_TIMEOUT" || error.code === "PROVIDER_UNAVAILABLE"
);

const stringDetail = (error: DomainError, key: string): string | undefined => {
  const value = error.details?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const renderErrorLine = (error: DomainError): string => {
  const provider = stringDetail(error, "engine");
  const cause = stringDetail(error, "cause");
  const suffix = [provider !== undefined ? `provider=${provider}` : undefined, cause !== undefined ? `cause=${cause}` : undefined]
    .filter((part): part is string => part !== undefined)
    .join("; ");
  return suffix.length > 0
    ? `error: ${error.code} ${error.message} (${suffix})`
    : `error: ${error.code} ${error.message}`;
};

const hasAdaptiveStyleDepth = (providers: StylePathProviders): boolean => (
  providers.styleEngines.some(engine => numberConfigValue(engine.configuration.styleDepth) === undefined)
);

const runWatch = async (options: CliOptions, ports: CliPorts): Promise<void> => {
  let stopped = false;
  let generation = 0;
  let targetSettings: AnalysisSettings = INITIAL_ANALYSIS_SETTINGS;
  let adaptiveState: AdaptiveAnalysisState = {
    settings: INITIAL_ANALYSIS_SETTINGS,
    stableSinceMs: Date.now(),
    depthLastIncreasedAtMs: Date.now(),
    horizonLastIncreasedAtMs: Date.now()
  };
  let lastLineSignature = "";
  let lastLineChangedAtMs = Date.now();
  let lastRenderedSignature = "";
  let lastRenderedLineCount = 0;
  let pendingFrame: string | null = null;
  let frameTimer: NodeJS.Timeout | undefined;
  let renderTimer: NodeJS.Timeout | undefined;
  let fileWatcher: ReturnType<typeof watch> | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;

  const writeWatchSnapshot = (text: string, signature: string): void => {
    if (signature === lastRenderedSignature) {
      return;
    }
    lastRenderedSignature = signature;
    pendingFrame = text;
    if (frameTimer !== undefined) {
      return;
    }
    frameTimer = setTimeout(() => {
      if (pendingFrame !== null) {
        ports.write(renderWatchUpdateFrame(pendingFrame, lastRenderedLineCount));
        lastRenderedLineCount = renderedLineCount(pendingFrame);
        pendingFrame = null;
      }
      frameTimer = undefined;
    }, 0);
  };

  const startContinuousGeneration = (): void => {
    const inputResult = ingestInput(options, ports);
    generation += 1;
    const currentGeneration = generation;
    targetSettings = INITIAL_ANALYSIS_SETTINGS;
    const nowMs = Date.now();
    adaptiveState = {
      settings: targetSettings,
      stableSinceMs: nowMs,
      depthLastIncreasedAtMs: nowMs,
      horizonLastIncreasedAtMs: nowMs
    };
    lastLineSignature = "";
    lastLineChangedAtMs = nowMs;

    if (isErr(inputResult)) {
      writeWatchSnapshot(`${inputResult.error.code}: ${inputResult.error.message}\n`, `error:${inputResult.error.code}:${inputResult.error.message}`);
      return;
    }

    const ingested = inputResult.value;
    const partialResults = new Map<string, StylePathLineResult>();
    const stateByEngine = new Map<string, ContinuousLineState>();

    const render = (): void => {
      const horizonResult = makeScenarioHorizon(targetSettings.horizonMoves * 2);
      if (isErr(horizonResult)) {
        writeWatchSnapshot(`${horizonResult.error.code}: ${horizonResult.error.message}\n`, `error:${horizonResult.error.code}:${horizonResult.error.message}`);
        return;
      }
      ports.providers.styleEngines.forEach(engine => {
        const state = stateByEngine.get(engine.key);
        if (state === undefined) {
          return;
        }
        partialResults.set(engine.key, {
          engineKey: engine.key,
          line: scenarioLineForState(
            ingested.position,
            horizonResult.value,
            engine.label ?? `${engine.identity.displayName} StylePath`,
            state
          ),
          styleDepth: styleDepthForCliEngine(engine, targetSettings.styleDepth)
        });
      });
      const orderedResults = ports.providers.styleEngines
        .map(engine => partialResults.get(engine.key))
        .filter((result): result is StylePathLineResult => result !== undefined);
      const currentLineSignature = lineSignature(orderedResults);
      if (currentLineSignature !== lastLineSignature) {
        lastLineSignature = currentLineSignature;
        lastLineChangedAtMs = Date.now();
        adaptiveState = {
          settings: targetSettings,
          lastLineSignature,
          stableSinceMs: lastLineChangedAtMs,
          depthLastIncreasedAtMs: lastLineChangedAtMs,
          horizonLastIncreasedAtMs: lastLineChangedAtMs
        };
      }
      const text = renderWatchProgress({
        startedAtMs: nowMs,
        ingested,
        settings: targetSettings,
        partialResults
      }, ports.providers, Date.now());
      writeWatchSnapshot(
        text,
        `lines:${targetSettings.styleDepth}:${targetSettings.horizonMoves}:${currentLineSignature}`
      );
    };

    const runEngine = async (styleEngine: StylePathProviders["styleEngines"][number]): Promise<void> => {
      const state: ContinuousLineState = {
        currentPosition: ingested.position,
        plies: [],
        status: "Incomplete"
      };
      stateByEngine.set(styleEngine.key, state);
      render();

      while (!stopped && currentGeneration === generation) {
        if (state.status === "Terminal") {
          await sleep(250);
          continue;
        }
        if (state.error !== undefined) {
          const retryAfterMs = state.retryAfterMs;
          if (!isTransientProviderError(state.error) || retryAfterMs === undefined || Date.now() < retryAfterMs) {
            await sleep(250);
            continue;
          }
          delete state.error;
          delete state.retryAfterMs;
        }

        const targetPlyCount = targetSettings.horizonMoves * 2;
        if (state.plies.length >= targetPlyCount) {
          if (state.status !== "Complete") {
            state.status = "Complete";
            render();
          }
          await sleep(250);
          continue;
        }
        if (state.status === "Complete") {
          state.status = "Incomplete";
          render();
        }

        const plyNumber = state.plies.length + 1;
        const factsResult = ports.chess.computeFacts(state.currentPosition);
        if (isErr(factsResult)) {
          state.error = factsResult.error;
          delete state.retryAfterMs;
          state.status = "Incomplete";
          render();
          continue;
        }
        if (factsResult.value.isTerminal) {
          state.status = "Terminal";
          render();
          continue;
        }

        const isStylePly = plyNumber % 2 === 1;
        const provider = isStylePly ? styleEngine.provideMove : styleEngine.opponent ?? ports.providers.maia;
        const expectedSource = isStylePly ? "LOCAL_STYLE_ENGINE" : "MAIA";
        const providerRequest = isStylePly
          ? {
            position: state.currentPosition,
            lineId: `style-${ingested.position.hash}-${styleEngine.key}`,
            ply: plyNumber,
            searchLimit: { tag: "Depth" as const, depth: styleDepthForCliEngine(styleEngine, targetSettings.styleDepth) }
          }
          : {
            position: state.currentPosition,
            lineId: `style-${ingested.position.hash}-${styleEngine.key}`,
            ply: plyNumber
          };
        const providedResult = await provider(providerRequest);
        if (stopped || currentGeneration !== generation) {
          return;
        }
        if (isErr(providedResult)) {
          state.error = providedResult.error;
          if (isTransientProviderError(providedResult.error)) {
            state.retryAfterMs = Date.now() + 2_000;
          } else {
            delete state.retryAfterMs;
          }
          state.status = "Incomplete";
          render();
          continue;
        }
        if (providedResult.value.provenance.source !== expectedSource) {
          delete state.retryAfterMs;
          state.error = {
            code: "SOURCE_SEQUENCE_VIOLATION",
            path: `scenario.plies.${plyNumber}.provenance.source`,
            message: "Provider returned a move with an unexpected source",
            details: { expected: expectedSource, actual: providedResult.value.provenance.source }
          };
          state.status = "Incomplete";
          render();
          continue;
        }
        const legalMove = ports.chess.parseLegalMove(state.currentPosition, providedResult.value.move.uci);
        if (isErr(legalMove)) {
          state.error = legalMove.error;
          delete state.retryAfterMs;
          state.status = "Incomplete";
          render();
          continue;
        }
        const nextPosition = ports.chess.applyMove(state.currentPosition, legalMove.value);
        if (isErr(nextPosition)) {
          state.error = nextPosition.error;
          delete state.retryAfterMs;
          state.status = "Incomplete";
          render();
          continue;
        }
        delete state.error;
        delete state.retryAfterMs;
        state.plies.push({
          tag: "ScenarioPly",
          index: makePlyIndex(plyNumber),
          move: legalMove.value,
          provenance: providedResult.value.provenance
        });
        state.currentPosition = nextPosition.value;
        render();
      }
    };

    ports.providers.styleEngines.forEach(engine => { void runEngine(engine); });
  };

  startContinuousGeneration();

  renderTimer = setInterval(() => {
    if (lastLineSignature.length === 0) {
      return;
    }
    const seededState = adaptiveState.lastLineSignature === lastLineSignature
      ? adaptiveState
      : {
        settings: targetSettings,
        lastLineSignature,
        stableSinceMs: lastLineChangedAtMs,
        depthLastIncreasedAtMs: lastLineChangedAtMs,
        horizonLastIncreasedAtMs: lastLineChangedAtMs
      };
    const updated = nextAdaptiveAnalysisState(seededState, lastLineSignature, Date.now());
    const nextSettings = {
      horizonMoves: updated.settings.horizonMoves,
      styleDepth: hasAdaptiveStyleDepth(ports.providers) ? updated.settings.styleDepth : targetSettings.styleDepth
    };
    if (
      nextSettings.styleDepth !== targetSettings.styleDepth
      || nextSettings.horizonMoves !== targetSettings.horizonMoves
    ) {
      adaptiveState = { ...updated, settings: nextSettings };
      targetSettings = nextSettings;
    }
  }, options.refreshMs);

  if (options.input.tag === "RawFile") {
    try {
      fileWatcher = watch(options.input.path, () => { startContinuousGeneration(); });
    } catch {
      // The refresh timer below is the polling fallback keepalive.
    }
  }
  refreshTimer = setInterval(() => undefined, options.refreshMs);

  await new Promise<void>(resolve => {
    const stop = (): void => {
      stopped = true;
      generation += 1;
      if (refreshTimer !== undefined) clearInterval(refreshTimer);
      if (renderTimer !== undefined) clearInterval(renderTimer);
      if (frameTimer !== undefined) clearTimeout(frameTimer);
      if (pendingFrame !== null) {
        ports.write(renderWatchUpdateFrame(pendingFrame, lastRenderedLineCount));
        pendingFrame = null;
      }
      fileWatcher?.close();
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
};

export const runCli = async (args: readonly string[], ports?: Partial<CliPorts>): Promise<number> => {
  if (args.includes("--help") || args.includes("-h")) {
    (ports?.write ?? process.stdout.write.bind(process.stdout))(usage);
    return 0;
  }
  const parsed = parseCliOptions(args);
  if (isErr(parsed)) {
    (ports?.writeError ?? process.stderr.write.bind(process.stderr))(`${parsed.error.message}\n\n${usage}`);
    return 2;
  }
  const chess = ports?.chess ?? createChessJsRulesAdapter();
  const fullPorts: CliPorts = {
    chess,
    providers: ports?.providers ?? (
      parsed.value.engineSuite === "cstal-windows"
        ? createWindowsCstalStylePathProviders(chess, undefined, {
          opponent: parsed.value.cstalOpponent,
          maia3Elo: parsed.value.maia3Elo
        })
        : createLocalStylePathProviders(chess)
    ),
    readTextFile: ports?.readTextFile ?? ((path: string): string => readFileSync(path, "utf8")),
    write: ports?.write ?? process.stdout.write.bind(process.stdout),
    writeError: ports?.writeError ?? process.stderr.write.bind(process.stderr)
  };
  if (parsed.value.watchMode) {
    await runWatch(parsed.value, fullPorts);
    return 0;
  }
  return runOneShotStreaming(parsed.value, fullPorts);
};

if (process.argv[1] !== undefined && basename(process.argv[1]) === "style-lines.ts") {
  void runCli(process.argv.slice(2)).then(code => {
    setTimeout(() => process.exit(code), 0);
  });
}
