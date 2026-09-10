#!/usr/bin/env node
import { readFileSync, watch } from "node:fs";
import { basename } from "node:path";
import { setInterval, clearInterval, setTimeout } from "node:timers";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import type { ChessRulesPort } from "../application/ports/chess-rules";
import type { StylePathProviders } from "../application/ports/providers";
import { generateStylePath, generateStylePaths, type StylePathLineResult } from "../application/use-cases/style-path";
import { makeScenarioHorizon } from "../domain/chess/value-objects";
import type { PositionSnapshot } from "../domain/chess/position";
import type { DomainError } from "../domain/shared/errors";
import { isErr, type Result } from "../domain/shared/result";
import { createLocalStylePathProviders } from "../wiring/local-style-engines";

export type CliInput =
  | Readonly<{ tag: "Fen"; value: string }>
  | Readonly<{ tag: "RawFile"; path: string }>;

export type CliOptions = Readonly<{
  input: CliInput;
  watchMode: boolean;
  refreshMs: number;
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

const renderedLineCount = (text: string): number => {
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  return normalized.length === 0 ? 0 : normalized.split("\n").length;
};

const renderWatchUpdateFrame = (text: string, previousLineCount: number): string => (
  previousLineCount <= 0
    ? text
    : `\x1b[${previousLineCount}F${WATCH_CLEAR_TO_END}${text}`
);

const usage = `Usage:\n  npm run style:lines -- --fen "<fen>" [--watch]\n  npm run style:lines -- --raw-file game.txt [--watch]\n\nOptions:\n  --fen <fen>          Analyze a FEN position.\n  --raw-file <path>   Read RAW SAN game notation from a text file.\n  --watch             Re-read changed input and refresh output every 2 seconds.\n  --refresh-ms <ms>   Watch render interval, default 2000.\n\nAdaptive watch starts at depth 13 and horizon 8 full moves. Stable lines increase depth every 5 seconds and horizon every 10 seconds while the process is running.\n`;

const valueAfter = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

export const parseCliOptions = (args: readonly string[]): Result<CliOptions, DomainError> => {
  const fen = valueAfter(args, "--fen");
  const rawFile = valueAfter(args, "--raw-file");
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
  return {
    tag: "Ok",
    value: {
      input: fen === undefined ? { tag: "RawFile", path: rawFile as string } : { tag: "Fen", value: fen },
      watchMode: args.includes("--watch"),
      refreshMs
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
      lines.push(`error: ${line.error.code} ${line.error.message}`);
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
      `## ${engine.identity.displayName} StylePath depth ${styleDepthForCliEngine(engine, progress.settings.styleDepth)} horizon ${progress.settings.horizonMoves}`,
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

const printResult = (result: Result<string, DomainError>, ports: Pick<CliPorts, "write" | "writeError">): void => {
  if (isErr(result)) {
    ports.writeError(`${result.error.code}: ${result.error.message}\n`);
    return;
  }
  ports.write(result.value);
};

const runWatch = async (options: CliOptions, ports: CliPorts): Promise<void> => {
  let running = false;
  let rerunRequested = true;
  let lastRendered = "";
  let lastRenderedLineCount = 0;
  let renderTimer: NodeJS.Timeout | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  let fileWatcher: ReturnType<typeof watch> | undefined;
  let frameTimer: NodeJS.Timeout | undefined;
  let pendingFrame: string | null = null;
  let activeProgress: WatchProgress | null = null;
  let lastRenderedSignature = "";
  let lastLineSignature = "";
  let lastLineChangedAtMs = Date.now();
  let stopped = false;

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

  const now = Date.now();
  let adaptiveState: AdaptiveAnalysisState = {
    settings: INITIAL_ANALYSIS_SETTINGS,
    stableSinceMs: now,
    depthLastIncreasedAtMs: now,
    horizonLastIncreasedAtMs: now
  };

  const recompute = async (): Promise<void> => {
    if (running) {
      rerunRequested = true;
      return;
    }
    running = true;
    rerunRequested = false;

    const inputResult = ingestInput(options, ports);
    if (isErr(inputResult)) {
      lastRendered = `${inputResult.error.code}: ${inputResult.error.message}\n`;
      activeProgress = null;
      running = false;
      writeWatchSnapshot(lastRendered, `error:${inputResult.error.code}:${inputResult.error.message}`);
      return;
    }

    const settings = adaptiveState.settings;
    let runLineSignature = "";
    let runLineChangedAtMs = Date.now();
    const horizonResult = makeScenarioHorizon(settings.horizonMoves * 2);
    if (isErr(horizonResult)) {
      lastRendered = `${horizonResult.error.code}: ${horizonResult.error.message}\n`;
      activeProgress = null;
      running = false;
      writeWatchSnapshot(lastRendered, `error:${horizonResult.error.code}:${horizonResult.error.message}`);
      return;
    }

    const partialResults = new Map<string, StylePathLineResult>();
    activeProgress = {
      startedAtMs: Date.now(),
      ingested: inputResult.value,
      settings,
      partialResults
    };
    lastRendered = renderWatchProgress(activeProgress, ports.providers, Date.now());
    writeWatchSnapshot(
      lastRendered,
      `pending:${settings.styleDepth}:${settings.horizonMoves}:${String(inputResult.value.position.hash)}`
    );

    const orderedResults = (): readonly StylePathLineResult[] => ports.providers.styleEngines
      .map(engine => partialResults.get(engine.key))
      .filter((result): result is StylePathLineResult => result !== undefined);
    const progressSignature = (): string => lineSignature(orderedResults());
    const renderProgressIfChanged = (): void => {
      if (activeProgress === null) {
        return;
      }
      const currentLineSignature = progressSignature();
      if (currentLineSignature !== runLineSignature) {
        runLineSignature = currentLineSignature;
        runLineChangedAtMs = Date.now();
        lastLineSignature = currentLineSignature;
        lastLineChangedAtMs = runLineChangedAtMs;
      }
      const signature = `lines:${settings.styleDepth}:${settings.horizonMoves}:${currentLineSignature}`;
      lastRendered = renderWatchProgress(activeProgress, ports.providers, Date.now());
      writeWatchSnapshot(lastRendered, signature);
    };

    await Promise.all(ports.providers.styleEngines.map(async styleEngine => {
      const lineResult = await generateStylePath(ports.chess, { maia: ports.providers.maia }, styleEngine, {
        lineId: `style-${inputResult.value.position.hash}-${styleEngine.key}`,
        start: inputResult.value.position,
        horizon: horizonResult.value,
        styleDepth: settings.styleDepth,
        onProgress: line => {
          partialResults.set(styleEngine.key, {
            engineKey: styleEngine.key,
            line,
            styleDepth: styleDepthForCliEngine(styleEngine, settings.styleDepth)
          });
          renderProgressIfChanged();
        }
      });
      if (stopped || isErr(lineResult)) {
        return;
      }
      partialResults.set(styleEngine.key, {
        engineKey: styleEngine.key,
        line: lineResult.value,
        styleDepth: styleDepthForCliEngine(styleEngine, settings.styleDepth)
      });
      renderProgressIfChanged();
    }));

    const completedResults = orderedResults();
    if (completedResults.length > 0) {
      const finalSignature = lineSignature(completedResults);
      if (adaptiveState.lastLineSignature !== finalSignature) {
        adaptiveState = {
          settings: adaptiveState.settings,
          lastLineSignature: finalSignature,
          stableSinceMs: lastLineChangedAtMs,
          depthLastIncreasedAtMs: lastLineChangedAtMs,
          horizonLastIncreasedAtMs: lastLineChangedAtMs
        };
      } else {
        const previousSettings = adaptiveState.settings;
        adaptiveState = nextAdaptiveAnalysisState(adaptiveState, finalSignature, Date.now());
        if (
          adaptiveState.settings.styleDepth !== previousSettings.styleDepth
          || adaptiveState.settings.horizonMoves !== previousSettings.horizonMoves
        ) {
          rerunRequested = true;
        }
      }
    }

    activeProgress = null;
    running = false;
    if (!stopped && rerunRequested) {
      await recompute();
    }
  };

  void recompute();

  renderTimer = setInterval(() => {
    if (running || lastLineSignature.length === 0) {
      return;
    }
    const seededState = adaptiveState.lastLineSignature === lastLineSignature
      ? adaptiveState
      : {
        settings: adaptiveState.settings,
        lastLineSignature,
        stableSinceMs: lastLineChangedAtMs,
        depthLastIncreasedAtMs: lastLineChangedAtMs,
        horizonLastIncreasedAtMs: lastLineChangedAtMs
      };
    const updated = nextAdaptiveAnalysisState(seededState, lastLineSignature, Date.now());
    if (
      updated.settings.styleDepth !== adaptiveState.settings.styleDepth
      || updated.settings.horizonMoves !== adaptiveState.settings.horizonMoves
    ) {
      adaptiveState = updated;
      void recompute();
    }
  }, options.refreshMs);

  if (options.input.tag === "RawFile") {
    try {
      fileWatcher = watch(options.input.path, () => { void recompute(); });
    } catch {
      // The refresh timer below is the polling fallback.
    }
  }
  refreshTimer = setInterval(() => undefined, options.refreshMs);

  await new Promise<void>(resolve => {
    const stop = (): void => {
      stopped = true;
      if (refreshTimer !== undefined) {
        clearInterval(refreshTimer);
      }
      if (renderTimer !== undefined) {
        clearInterval(renderTimer);
      }
      if (frameTimer !== undefined) {
        clearTimeout(frameTimer);
      }
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
    providers: ports?.providers ?? createLocalStylePathProviders(chess),
    readTextFile: ports?.readTextFile ?? ((path: string): string => readFileSync(path, "utf8")),
    write: ports?.write ?? process.stdout.write.bind(process.stdout),
    writeError: ports?.writeError ?? process.stderr.write.bind(process.stderr)
  };
  if (parsed.value.watchMode) {
    await runWatch(parsed.value, fullPorts);
    return 0;
  }
  const result = await analyzeStylePathsOnce(parsed.value, fullPorts);
  printResult(result, fullPorts);
  return isErr(result) ? 1 : 0;
};

if (process.argv[1] !== undefined && basename(process.argv[1]) === "style-lines.ts") {
  void runCli(process.argv.slice(2)).then(code => {
    setTimeout(() => process.exit(code), 0);
  });
}
