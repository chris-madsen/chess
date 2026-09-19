#!/usr/bin/env node
import { existsSync, readFileSync, watch } from "node:fs";
import { basename } from "node:path";
import { setInterval, clearInterval, setTimeout } from "node:timers";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import type { ChessRulesPort } from "../application/ports/chess-rules";
import type { StylePathProviders } from "../application/ports/providers";
import { generateStylePaths, type StylePathLineResult } from "../application/use-cases/style-path";
import { makePlyIndex, makeScenarioHorizon, type ScenarioHorizon } from "../domain/chess/value-objects";
import type { PositionSnapshot } from "../domain/chess/position";
import type { ScenarioLine, ScenarioPly } from "../domain/scenario-lines/scenario-line";
import { domainError, type DomainError } from "../domain/shared/errors";
import { err, isErr, ok, type Result } from "../domain/shared/result";
import { createLocalStylePathProviders, createWindowsCstalStylePathProviders, type WindowsCstalOpponent } from "../wiring/local-style-engines";
import { renderedLineCount, renderLiveTerminalFrame, CLEAR_TO_END } from "./live-terminal-renderer";

export type CliInput =
  | Readonly<{ tag: "Fen"; value: string }>
  | Readonly<{ tag: "RawFile"; path: string }>;

export type BotEngine = "tal" | "local";

export type CliOptions = Readonly<{
  input: CliInput;
  watchMode: boolean;
  refreshMs: number;
  engineSuite: "local-style" | "cstal-windows";
  cstalOpponent: WindowsCstalOpponent;
  maia3Elo: number;
  botEngine: BotEngine;
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

export type ServerStyleLine = Readonly<{
  engineKey: string;
  label: string;
  status: "Incomplete" | "Complete" | "Terminal" | "Failed" | string;
  styleDepth?: number;
  sanMovetext: string;
  plies?: readonly Readonly<{
    index: number;
    san: string;
    uci: string;
    source: string;
    provider: string;
  }>[];
}>;

export type StyleJobSnapshot = Readonly<{
  jobId: string;
  status: "queued" | "running" | "complete" | "failed" | string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  settings: Readonly<{
    horizonMoves?: number;
    styleDepth?: number;
    maxFullMoves?: number;
    refreshMs?: number;
    timeoutMs?: number;
    cstalOpponent?: string;
    maia3Elo?: number;
  }>;
  input?: Readonly<{
    fen?: string;
    sideToMove?: string;
  }>;
  lines: readonly ServerStyleLine[];
  error?: string;
}>;

export type StyleJobCreateRequest = Readonly<{
  rawGame: string;
  botEngine: BotEngine;
  cstalOpponent: WindowsCstalOpponent;
  maia3Elo: number;
  refreshMs: number;
  maxFullMoves: number;
  timeoutMs: number;
}>;

export type StyleJobApiClient = Readonly<{
  createJob: (request: StyleJobCreateRequest) => Promise<Result<string, DomainError>>;
  streamEvents: (jobId: string, onSnapshot: (snapshot: StyleJobSnapshot, eventName: string) => void, signal: AbortSignal) => Promise<Result<void, DomainError>>;
}>;

export type CliPorts = Readonly<{
  chess: ChessRulesPort;
  providers: StylePathProviders;
  readTextFile: (path: string) => string;
  write: (text: string) => void;
  writeError: (text: string) => void;
  styleJobApi?: StyleJobApiClient;
}>;

export const WATCH_CLEAR_TO_END = CLEAR_TO_END;

const defaultStyleApiBaseUrl = "https://chess.network-communications.net";
const defaultStyleApiTokenFiles = [
  ".local/style-server-token.txt",
  "/media/ilja/DATA/chess/chess-api.ken"
] as const;
const defaultApiMaxFullMoves = 80;
const defaultApiTimeoutMs = 300_000;

const configuredStyleApiToken = (): string | undefined => {
  const fromEnv = process.env.CHESS_STYLE_API_TOKEN ?? process.env.CHESS_TRAINER_API_TOKEN;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  const tokenFiles = [
    process.env.CHESS_STYLE_API_TOKEN_FILE,
    process.env.STYLE_SERVER_TOKEN_FILE,
    ...defaultStyleApiTokenFiles
  ].filter((file): file is string => file !== undefined && file.length > 0);
  const tokenPath = tokenFiles.find(file => existsSync(file));
  return tokenPath === undefined ? undefined : readFileSync(tokenPath, "utf8").trim();
};

const base64Utf8 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

const styleJobApiError = (path: string, message: string, details?: Readonly<Record<string, unknown>>): DomainError => (
  domainError("PROVIDER_UNAVAILABLE", path, message, details)
);

const parseSseBlocks = (text: string): readonly Readonly<{ eventName: string; data: string }>[] => text
  .split(/\r?\n\r?\n/u)
  .map(block => {
    const eventName = block.split(/\r?\n/u).find(line => line.startsWith("event:"))?.slice("event:".length).trim() ?? "message";
    const data = block.split(/\r?\n/u)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice("data:".length).trimStart())
      .join("\n");
    return { eventName, data };
  })
  .filter(block => block.data.length > 0);

const isStyleJobSnapshot = (value: unknown): value is StyleJobSnapshot => (
  value !== null
  && typeof value === "object"
  && typeof (value as { jobId?: unknown }).jobId === "string"
  && Array.isArray((value as { lines?: unknown }).lines)
);

const renderApiStyleJobSnapshot = (snapshot: StyleJobSnapshot, generatedAtIso = new Date().toISOString()): string => {
  const lines: string[] = [];
  snapshot.lines.forEach(line => {
    lines.push(`## ${line.label} depth ${line.styleDepth ?? snapshot.settings.styleDepth ?? 13} horizon ${snapshot.settings.horizonMoves ?? "api"}`);
    lines.push(line.sanMovetext.length > 0 ? line.sanMovetext : "(no moves)");
    if (line.status !== "Complete") {
      lines.push(`status: ${line.status}`);
    }
    lines.push("");
  });
  if (snapshot.lines.length === 0) {
    lines.push("status: Analyzing", "");
  }
  lines.push(
    `StylePath API job ${snapshot.jobId} @ ${generatedAtIso}`,
    `Job status: ${snapshot.status}`,
    `Position: ${snapshot.input?.fen ?? "pending"}`,
    `Player side inferred from turn: ${snapshot.input?.sideToMove ?? "pending"}`,
    `API settings: bot engine tal, opponent ${snapshot.settings.cstalOpponent ?? "maia3"}, Maia3 Elo ${snapshot.settings.maia3Elo ?? 1900}, refresh ${snapshot.settings.refreshMs ?? "api"}ms, max ${snapshot.settings.maxFullMoves ?? defaultApiMaxFullMoves} full moves`
  );
  return `${lines.join("\n").trimEnd()}\n`;
};

const apiSnapshotSignature = (snapshot: StyleJobSnapshot): string => JSON.stringify({
  status: snapshot.status,
  settings: snapshot.settings,
  input: snapshot.input,
  lines: snapshot.lines.map(line => ({
    engineKey: line.engineKey,
    status: line.status,
    sanMovetext: line.sanMovetext,
    plies: line.plies?.map(ply => `${ply.index}:${ply.uci}:${ply.source}:${ply.provider}`) ?? []
  })),
  error: snapshot.error
});

const createDefaultStyleJobApiClient = (): StyleJobApiClient => {
  const baseUrl = (process.env.CHESS_STYLE_API_BASE_URL ?? defaultStyleApiBaseUrl).replace(/\/$/u, "");
  const token = configuredStyleApiToken();
  const authorization = token === undefined ? undefined : `Bearer ${token}`;

  return {
    createJob: async request => {
      if (authorization === undefined) {
        return err(styleJobApiError("styleApi.authorization", "CHESS_STYLE_API_TOKEN or a style server token file is required"));
      }
      const response = await fetch(`${baseUrl}/v1/style-lines/jobs`, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          rawGameBase64: base64Utf8(request.rawGame),
          engineSuite: request.botEngine === "tal" ? "cstal-windows" : "local-style",
          cstalOpponent: request.cstalOpponent,
          maia3Elo: request.maia3Elo,
          refreshMs: request.refreshMs,
          maxFullMoves: request.maxFullMoves,
          timeoutMs: request.timeoutMs
        })
      });
      const body = await response.json().catch(() => undefined) as { jobId?: unknown; error?: unknown } | undefined;
      if (!response.ok || typeof body?.jobId !== "string") {
        return err(styleJobApiError("styleApi.createJob", "StylePath API job creation failed", {
          status: response.status,
          error: typeof body?.error === "string" ? body.error : undefined
        }));
      }
      return ok(body.jobId);
    },
    streamEvents: async (jobId, onSnapshot, signal) => {
      if (authorization === undefined) {
        return err(styleJobApiError("styleApi.authorization", "CHESS_STYLE_API_TOKEN or a style server token file is required"));
      }
      const response = await fetch(`${baseUrl}/v1/style-lines/jobs/${encodeURIComponent(jobId)}/events`, {
        headers: { authorization },
        signal
      });
      if (!response.ok || response.body === null) {
        return err(styleJobApiError("styleApi.events", "StylePath API event stream failed", { status: response.status }));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const split = buffer.split(/\r?\n\r?\n/u);
          buffer = split.pop() ?? "";
          for (const event of parseSseBlocks(split.join("\n\n"))) {
            const parsed = JSON.parse(event.data) as unknown;
            if (isStyleJobSnapshot(parsed)) {
              onSnapshot(parsed, event.eventName);
            }
          }
        }
        for (const event of parseSseBlocks(buffer)) {
          const parsed = JSON.parse(event.data) as unknown;
          if (isStyleJobSnapshot(parsed)) {
            onSnapshot(parsed, event.eventName);
          }
        }
        return ok(undefined);
      } catch (error) {
        if (signal.aborted) {
          return ok(undefined);
        }
        return err(styleJobApiError("styleApi.events", "StylePath API event stream could not be parsed", {
          cause: error instanceof Error ? error.message : String(error)
        }));
      } finally {
        reader.releaseLock();
      }
    }
  };
};

const renderWatchUpdateFrame = (text: string, previousLineCount: number): string => (
  previousLineCount <= 0 ? text : renderLiveTerminalFrame(text, previousLineCount)
);

const usage = `Usage:\n  npm run style:lines -- --fen "<fen>" [--watch]\n  npm run style:lines -- --raw-file game.txt [--watch]\n  npm run style:lines:cstal -- --fen "<fen>" [--watch]\n\nOptions:\n  --fen <fen>                 Analyze a FEN position.\n  --raw-file <path>          Read RAW SAN game notation from a text file.\n  --bot-engine <id>         Watch RAW-file line source: tal or local. Default tal.\n  --engine-suite <id>        Local engine suite: local-style or cstal-windows. Default local-style.\n  --cstal-opponent <id>      CSTal opponent: maia3 or maia1900. Default maia3.\n  --maia3-elo <rating>       Maia3 Elo conditioning, integer 1..4000. Default 1900.\n  --watch                    Re-read changed input and refresh output every 2 seconds.\n  --refresh-ms <ms>          Watch render interval, default 2000.\n\nAdaptive watch starts at depth 13 and horizon 8 full moves. Stable lines increase depth every 5 seconds and horizon every 10 seconds while the process is running.\n`;

const valueAfter = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

export const parseCliOptions = (args: readonly string[]): Result<CliOptions, DomainError> => {
  const fen = valueAfter(args, "--fen");
  const rawFile = valueAfter(args, "--raw-file");
  const botEngineRaw = valueAfter(args, "--bot-engine") ?? "tal";
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
  if (botEngineRaw !== "tal" && botEngineRaw !== "local") {
    return {
      tag: "Err",
      error: {
        code: "INVALID_MOVE_NOTATION",
        path: "cli.botEngine",
        message: "--bot-engine must be tal or local",
        details: { value: botEngineRaw }
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
      maia3Elo,
      botEngine: botEngineRaw
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

export const ingestInput = (options: CliOptions, ports: Pick<CliPorts, "chess" | "readTextFile">): Result<IngestedCliInput, DomainError> => {
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

export const formatSanMovetext = (
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

type StyleApiLineSnapshot = Readonly<{
  engineKey: string;
  label: string;
  status: "Incomplete" | "Complete" | "Terminal";
  styleDepth: number;
  sanMovetext: string;
  plies: readonly Readonly<{ san: string; uci: string }>[];
  error?: DomainError;
}>;

type StyleApiJobSnapshot = Readonly<{
  jobId: string;
  status: "queued" | "running" | "complete" | "error" | "cancelled";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  settings: Readonly<{
    horizonMoves: number;
    styleDepth: number;
    maxFullMoves: number;
    refreshMs: number;
    timeoutMs: number;
    cstalOpponent: WindowsCstalOpponent;
    maia3Elo: number;
  }>;
  input?: Readonly<{
    fen: string;
    sideToMove: "white" | "black";
  }>;
  lines: readonly StyleApiLineSnapshot[];
  error?: DomainError;
}>;

type StyleApiConfig = Readonly<{
  baseUrl: string;
  token: string;
}>;

const localStyleServerTokenPath = ".local/style-server-token.txt";

const readStyleApiConfig = (): StyleApiConfig | undefined => {
  const tokenFromEnv = process.env.STYLE_SERVER_TOKEN?.trim();
  const token = tokenFromEnv !== undefined && tokenFromEnv.length > 0
    ? tokenFromEnv
    : existsSync(localStyleServerTokenPath)
      ? readFileSync(localStyleServerTokenPath, "utf8").trim()
      : "";
  if (token.length === 0) {
    return undefined;
  }
  const host = process.env.STYLE_SERVER_HOST ?? "127.0.0.1";
  const port = process.env.STYLE_SERVER_PORT ?? "8787";
  return {
    baseUrl: (process.env.STYLE_SERVER_URL ?? `http://${host}:${port}`).replace(/\/+$/, ""),
    token
  };
};

const apiOpponentLabel = (opponent: WindowsCstalOpponent): string => opponent === "maia1900" ? "Maia 1900" : "Maia3 79M";

const emptyApiLines = (settings: StyleApiJobSnapshot["settings"]): readonly StyleApiLineSnapshot[] => [
  {
    engineKey: `cstal-absurd-${settings.cstalOpponent === "maia1900" ? "maia1900" : "maia3"}`,
    label: `CSTal ABSURD vs ${apiOpponentLabel(settings.cstalOpponent)} StylePath`,
    status: "Incomplete",
    styleDepth: settings.styleDepth,
    sanMovetext: "",
    plies: []
  },
  {
    engineKey: `cstal-extreme-${settings.cstalOpponent === "maia1900" ? "maia1900" : "maia3"}`,
    label: `CSTal EXTREME vs ${apiOpponentLabel(settings.cstalOpponent)} StylePath`,
    status: "Incomplete",
    styleDepth: settings.styleDepth,
    sanMovetext: "",
    plies: []
  }
];

export const styleApiSnapshotSignature = (snapshot: StyleApiJobSnapshot): string => (
  [
    snapshot.jobId,
    snapshot.status,
    snapshot.settings.horizonMoves,
    snapshot.input?.fen ?? "pending",
    snapshot.error?.code ?? "",
    ...snapshot.lines.map(line => [
      line.engineKey,
      line.status,
      line.error?.code ?? "",
      line.plies.map(ply => ply.uci).join(",")
    ].join(":"))
  ].join("|")
);

export const renderStyleApiJobSnapshot = (
  snapshot: StyleApiJobSnapshot,
  nowIso = new Date().toISOString()
): string => {
  const lines: string[] = [];
  const lineSnapshots = snapshot.lines.length > 0 ? snapshot.lines : emptyApiLines(snapshot.settings);
  lineSnapshots.forEach(line => {
    lines.push(`## ${line.label} depth ${line.styleDepth} horizon ${snapshot.settings.horizonMoves}`);
    lines.push(line.sanMovetext.length > 0 ? line.sanMovetext : "status: Analyzing");
    if (line.sanMovetext.length > 0) {
      lines.push(`status: ${line.status}`);
    }
    if (line.error !== undefined) {
      lines.push(`error: ${line.error.code} ${line.error.message}`);
    }
    lines.push("");
  });
  lines.push(
    `StylePath API job ${snapshot.jobId} @ ${nowIso}`,
    `Job status: ${snapshot.status}`,
    `Position: ${snapshot.input?.fen ?? "pending"}`,
    `Player side inferred from turn: ${snapshot.input?.sideToMove ?? "pending"}`,
    `API settings: bot engine tal, opponent ${snapshot.settings.cstalOpponent}, Maia3 Elo ${snapshot.settings.maia3Elo}, refresh ${snapshot.settings.refreshMs}ms, max ${snapshot.settings.maxFullMoves} full moves`
  );
  if (snapshot.error !== undefined) {
    lines.push(`Job error: ${snapshot.error.code} ${snapshot.error.message}`);
  }
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


const runApiBackedWatch = async (options: CliOptions, ports: CliPorts): Promise<void> => {
  const api = ports.styleJobApi ?? createDefaultStyleJobApiClient();
  let stopped = false;
  let generation = 0;
  let controller: AbortController | undefined;
  let fileWatcher: ReturnType<typeof watch> | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  let lastRenderedLineCount = 0;
  let lastRenderedSignature = "";

  const writeSnapshot = (text: string, signature: string): void => {
    if (signature === lastRenderedSignature) {
      return;
    }
    lastRenderedSignature = signature;
    ports.write(renderWatchUpdateFrame(text, lastRenderedLineCount));
    lastRenderedLineCount = renderedLineCount(text);
  };

  const writeErrorSnapshot = (error: DomainError): void => {
    writeSnapshot(`${error.code}: ${error.message}\n`, `error:${error.code}:${error.message}:${JSON.stringify(error.details ?? {})}`);
  };

  const startServerJob = (): void => {
    generation += 1;
    const currentGeneration = generation;
    controller?.abort();
    controller = new AbortController();

    let rawGame: string;
    try {
      rawGame = options.input.tag === "RawFile" ? ports.readTextFile(options.input.path) : "";
    } catch (error) {
      writeErrorSnapshot(domainError("INVALID_RAW_GAME", "cli.rawFile", "Could not read RAW game file", {
        cause: error instanceof Error ? error.message : String(error)
      }));
      return;
    }

    writeSnapshot("status: Submitting StylePath API job\n", `submitting:${currentGeneration}:${rawGame.length}`);

    void (async (): Promise<void> => {
      const created = await api.createJob({
        rawGame,
        botEngine: options.botEngine,
        cstalOpponent: options.cstalOpponent,
        maia3Elo: options.maia3Elo,
        refreshMs: options.refreshMs,
        maxFullMoves: defaultApiMaxFullMoves,
        timeoutMs: defaultApiTimeoutMs
      });
      if (stopped || currentGeneration !== generation) {
        return;
      }
      if (isErr(created)) {
        writeErrorSnapshot(created.error);
        return;
      }
      const streamed = await api.streamEvents(created.value, (snapshot, eventName) => {
        if (stopped || currentGeneration !== generation) {
          return;
        }
        const signature = `api:${eventName}:${apiSnapshotSignature(snapshot)}`;
        writeSnapshot(renderApiStyleJobSnapshot(snapshot), signature);
      }, controller?.signal ?? new AbortController().signal);
      if (stopped || currentGeneration !== generation) {
        return;
      }
      if (isErr(streamed)) {
        writeErrorSnapshot(streamed.error);
      }
    })();
  };

  startServerJob();

  if (options.input.tag === "RawFile") {
    try {
      fileWatcher = watch(options.input.path, () => { startServerJob(); });
    } catch {
      // The refresh timer below is the polling fallback keepalive.
    }
  }
  refreshTimer = setInterval(() => undefined, options.refreshMs);

  await new Promise<void>(resolve => {
    const stop = (): void => {
      stopped = true;
      generation += 1;
      controller?.abort();
      if (refreshTimer !== undefined) clearInterval(refreshTimer);
      fileWatcher?.close();
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
};

const shouldUseApiBackedWatch = (options: CliOptions): boolean => (
  options.watchMode && options.input.tag === "RawFile" && options.botEngine === "tal"
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

type SseEvent = Readonly<{
  type: string;
  data: unknown;
}>;

const parseSseFrame = (frame: string): SseEvent | undefined => {
  const eventLine = frame.split("\n").find(line => line.startsWith("event: "));
  const dataLines = frame
    .split("\n")
    .filter(line => line.startsWith("data: "))
    .map(line => line.slice("data: ".length));
  if (eventLine === undefined || dataLines.length === 0) {
    return undefined;
  }
  return {
    type: eventLine.slice("event: ".length),
    data: JSON.parse(dataLines.join("\n")) as unknown
  };
};

const isStyleApiJobSnapshot = (data: unknown): data is StyleApiJobSnapshot => (
  data !== null
  && typeof data === "object"
  && typeof (data as { jobId?: unknown }).jobId === "string"
  && typeof (data as { status?: unknown }).status === "string"
  && typeof (data as { settings?: unknown }).settings === "object"
  && Array.isArray((data as { lines?: unknown }).lines)
);

const streamStyleApiEvents = async (
  response: Response,
  onSnapshot: (snapshot: StyleApiJobSnapshot) => void
): Promise<void> => {
  if (response.body === null) {
    throw new Error("StylePath API did not return a stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const read = await reader.read();
    if (read.done) {
      break;
    }
    buffer += decoder.decode(read.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event === undefined || !isStyleApiJobSnapshot(event.data)) {
        continue;
      }
      onSnapshot(event.data);
    }
  }
};

const runStyleApiWatch = async (
  options: CliOptions,
  ports: Pick<CliPorts, "readTextFile" | "write" | "writeError">,
  api: StyleApiConfig
): Promise<number> => {
  if (options.input.tag !== "RawFile") {
    return 1;
  }
  const rawFilePath = options.input.path;
  let stopped = false;
  let generation = 0;
  let lastRenderedLineCount = 0;
  let lastRenderedSignature = "";
  let activeAbort: AbortController | undefined;
  let activeJobId: string | undefined;
  let fileWatcher: ReturnType<typeof watch> | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;

  const render = (snapshot: StyleApiJobSnapshot): void => {
    const signature = styleApiSnapshotSignature(snapshot);
    if (signature === lastRenderedSignature) {
      return;
    }
    lastRenderedSignature = signature;
    const text = renderStyleApiJobSnapshot(snapshot);
    ports.write(renderWatchUpdateFrame(text, lastRenderedLineCount));
    lastRenderedLineCount = renderedLineCount(text);
  };

  const startJob = async (): Promise<void> => {
    generation += 1;
    const currentGeneration = generation;
    activeAbort?.abort();
    activeAbort = new AbortController();
    const abort = activeAbort;
    let rawGame = "";
    try {
      rawGame = ports.readTextFile(rawFilePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ports.writeError(`Failed to read ${rawFilePath}: ${message}\n`);
      return;
    }

    try {
      const created = await fetch(`${api.baseUrl}/v1/style-lines/jobs`, {
        method: "POST",
        signal: abort.signal,
        headers: {
          "authorization": `Bearer ${api.token}`,
          "content-type": "application/json",
          "cf-ipcountry": "EE"
        },
        body: JSON.stringify({
          rawGameBase64: Buffer.from(rawGame, "utf8").toString("base64"),
          engineSuite: "cstal-windows",
          cstalOpponent: options.cstalOpponent,
          maia3Elo: options.maia3Elo,
          refreshMs: options.refreshMs,
          maxFullMoves: 80,
          timeoutMs: 300_000
        })
      });
      if (!created.ok) {
        ports.writeError(`StylePath API POST failed: ${created.status} ${await created.text()}\n`);
        return;
      }
      const createdBody = await created.json() as { jobId?: unknown };
      if (typeof createdBody.jobId !== "string") {
        ports.writeError("StylePath API POST did not return jobId\n");
        return;
      }
      activeJobId = createdBody.jobId;
      const stream = await fetch(`${api.baseUrl}/v1/style-lines/jobs/${encodeURIComponent(createdBody.jobId)}/events`, {
        signal: abort.signal,
        headers: {
          "authorization": `Bearer ${api.token}`,
          "cf-ipcountry": "EE"
        }
      });
      if (!stream.ok) {
        ports.writeError(`StylePath API stream failed: ${stream.status} ${await stream.text()}\n`);
        return;
      }
      await streamStyleApiEvents(stream, snapshot => {
        if (!stopped && currentGeneration === generation) {
          render(snapshot);
        }
      });
    } catch (error) {
      if (!abort.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        ports.writeError(`StylePath API request failed: ${message}\n`);
      }
    }
  };

  void startJob();
  try {
    fileWatcher = watch(rawFilePath, () => { void startJob(); });
  } catch {
    // The keepalive timer below preserves watch-mode lifetime if fs.watch is unavailable.
  }
  refreshTimer = setInterval(() => undefined, options.refreshMs);

  await new Promise<void>(resolve => {
    const stop = (): void => {
      stopped = true;
      generation += 1;
      activeAbort?.abort();
      if (activeJobId !== undefined) {
        void fetch(`${api.baseUrl}/v1/style-lines/jobs/${encodeURIComponent(activeJobId)}`, {
          method: "DELETE",
          headers: {
            "authorization": `Bearer ${api.token}`,
            "cf-ipcountry": "EE"
          }
        }).catch(() => undefined);
      }
      fileWatcher?.close();
      if (refreshTimer !== undefined) clearInterval(refreshTimer);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
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
  if (ports === undefined && parsed.value.watchMode && parsed.value.input.tag === "RawFile") {
    const api = readStyleApiConfig();
    if (api !== undefined) {
      return runStyleApiWatch(parsed.value, {
        readTextFile: (path: string): string => readFileSync(path, "utf8"),
        write: process.stdout.write.bind(process.stdout),
        writeError: process.stderr.write.bind(process.stderr)
      }, api);
    }
  }
  const chess = ports?.chess ?? createChessJsRulesAdapter();
  const apiBackedWatch = shouldUseApiBackedWatch(parsed.value);
  const unavailableProvider: StylePathProviders["maia"] = async () => err(domainError(
    "PROVIDER_UNAVAILABLE",
    "providers.local",
    "Local providers are not available in API-backed watch mode"
  ));
  const fullPorts: CliPorts = {
    chess,
    providers: ports?.providers ?? (apiBackedWatch
      ? { maia: unavailableProvider, styleEngines: [] }
      : parsed.value.engineSuite === "cstal-windows"
        ? createWindowsCstalStylePathProviders(chess, undefined, {
          opponent: parsed.value.cstalOpponent,
          maia3Elo: parsed.value.maia3Elo
        })
        : createLocalStylePathProviders(chess)
    ),
    readTextFile: ports?.readTextFile ?? ((path: string): string => readFileSync(path, "utf8")),
    write: ports?.write ?? process.stdout.write.bind(process.stdout),
    writeError: ports?.writeError ?? process.stderr.write.bind(process.stderr),
    ...(ports?.styleJobApi !== undefined ? { styleJobApi: ports.styleJobApi } : {})
  };
  if (parsed.value.watchMode) {
    if (apiBackedWatch) {
      await runApiBackedWatch(parsed.value, fullPorts);
      return 0;
    }
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
