import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import type { ChessRulesPort } from "../application/ports/chess-rules";
import type { StylePathProviders } from "../application/ports/providers";
import { generateStylePaths, type StylePathLineResult } from "../application/use-cases/style-path";
import { makeScenarioHorizon } from "../domain/chess/value-objects";
import type { DomainError } from "../domain/shared/errors";
import { domainError } from "../domain/shared/errors";
import { isErr, type Result } from "../domain/shared/result";
import { createLocalStylePathProviders, createWindowsCstalStylePathProviders, type WindowsCstalOpponent } from "../wiring/local-style-engines";
import { renderStylePathResults, type AnalysisSettings, type IngestedCliInput } from "../cli/style-lines";

export type StyleLinesApiInput = Readonly<{
  fen?: string;
  rawSan?: string;
  engineSuite?: "local-style" | "cstal-windows";
  cstalOpponent?: WindowsCstalOpponent;
  maia3Elo?: number;
  horizonMoves?: number;
  styleDepth?: number;
  includeRenderedText?: boolean;
}>;

export type StyleLinesApiConfig = Readonly<{
  host: string;
  port: number;
  authToken: string;
}>;

export type StyleLinesApiPorts = Readonly<{
  chess: ChessRulesPort;
  providers: StylePathProviders;
  nowIso: () => string;
}>;

export type SerializedPly = Readonly<{
  index: number;
  uci: string;
  san: string;
  source: string;
  provider: Readonly<{ name: string; displayName: string; version?: string }>;
  status: string;
  requestId: string;
  inputPositionHash: string;
  configuration: Readonly<Record<string, unknown>>;
  observedAtIso?: string;
}>;

export type SerializedStyleLine = Readonly<{
  engineKey: string;
  label: string;
  mode: string;
  status: string;
  styleDepth?: number;
  plies: readonly SerializedPly[];
  error?: DomainError;
}>;

export type StyleLinesApiResponse = Readonly<{
  generatedAtIso: string;
  position: Readonly<{
    fen: string;
    hash: string;
    sideToMove: string;
  }>;
  settings: AnalysisSettings;
  lines: readonly SerializedStyleLine[];
  renderedText?: string;
}>;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const maxBodyBytes = 64 * 1024;
const defaultSettings: AnalysisSettings = { horizonMoves: 8, styleDepth: 13 };

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  response.writeHead(statusCode, jsonHeaders);
  response.end(`${JSON.stringify(payload)}\n`);
};

const errorPayload = (error: DomainError): Readonly<{ error: DomainError }> => ({ error });

const parseIntegerOption = (value: unknown, fallback: number, path: string): Result<number, DomainError> => (
  value === undefined
    ? { tag: "Ok", value: fallback }
    : Number.isInteger(value) && Number(value) > 0
      ? { tag: "Ok", value: Number(value) }
      : { tag: "Err", error: domainError("INVALID_MOVE_NOTATION", path, "Expected a positive integer", { value }) }
);

const parseRequestJson = (raw: string): Result<StyleLinesApiInput, DomainError> => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? { tag: "Ok", value: parsed as StyleLinesApiInput }
      : { tag: "Err", error: domainError("INVALID_MOVE_NOTATION", "request.body", "JSON request body must be an object") };
  } catch (error) {
    return {
      tag: "Err",
      error: domainError("INVALID_MOVE_NOTATION", "request.body", "Request body must be valid JSON", {
        cause: error instanceof Error ? error.message : String(error)
      })
    };
  }
};

const readRequestBody = async (request: IncomingMessage): Promise<Result<string, DomainError>> => new Promise(resolve => {
  const chunks: Buffer[] = [];
  let total = 0;
  let resolved = false;
  const finish = (result: Result<string, DomainError>): void => {
    if (!resolved) {
      resolved = true;
      resolve(result);
    }
  };
  request.on("data", (chunk: Buffer) => {
    total += chunk.length;
    if (total > maxBodyBytes) {
      finish({ tag: "Err", error: domainError("INVALID_MOVE_NOTATION", "request.body", "Request body exceeds 64 KiB") });
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => finish({ tag: "Ok", value: Buffer.concat(chunks).toString("utf8") }));
  request.on("error", error => finish({
    tag: "Err",
    error: domainError("PROVIDER_MALFORMED_OUTPUT", "request.body", "Failed to read request body", {
      cause: error.message
    })
  }));
});

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

const fullmoveFromFen = (fen: string): number => {
  const fields = fen.trim().split(/\s+/);
  const fullmove = Number(fields[5] ?? "1");
  return Number.isInteger(fullmove) && fullmove > 0 ? fullmove : 1;
};

const sideToMoveFromFen = (fen: string): "white" | "black" => fen.trim().split(/\s+/)[1] === "b" ? "black" : "white";

const exactlyOneInput = (input: StyleLinesApiInput): Result<true, DomainError> => {
  const hasFen = typeof input.fen === "string" && input.fen.trim().length > 0;
  const hasRawSan = typeof input.rawSan === "string" && input.rawSan.trim().length > 0;
  return hasFen !== hasRawSan
    ? { tag: "Ok", value: true }
    : { tag: "Err", error: domainError("INVALID_MOVE_NOTATION", "request.input", "Provide exactly one of fen or rawSan") };
};

const ingestApiInput = (chess: ChessRulesPort, input: StyleLinesApiInput): Result<IngestedCliInput, DomainError> => {
  const inputShape = exactlyOneInput(input);
  if (isErr(inputShape)) {
    return inputShape;
  }
  if (typeof input.fen === "string") {
    const position = chess.ingestPosition(input.fen);
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
  const position = chess.ingestRawGame(input.rawSan as string);
  if (isErr(position)) {
    return position;
  }
  return {
    tag: "Ok",
    value: {
      position: position.value,
      baseSanMoves: rawSanTokens(input.rawSan as string),
      lineStartFullmove: 1,
      lineStartSide: "white"
    }
  };
};

const serializeLine = (result: StylePathLineResult): SerializedStyleLine => ({
  engineKey: result.engineKey,
  label: result.line.label,
  mode: result.line.mode,
  status: result.line.status,
  ...(result.styleDepth === undefined ? {} : { styleDepth: result.styleDepth }),
  plies: result.line.plies.map(ply => ({
    index: Number(ply.index),
    uci: String(ply.move.uci),
    san: String(ply.move.san),
    source: ply.provenance.source,
    provider: ply.provenance.provider,
    status: ply.provenance.status,
    requestId: String(ply.provenance.requestId),
    inputPositionHash: String(ply.provenance.inputPositionHash),
    configuration: ply.provenance.configuration,
    ...(ply.provenance.observedAtIso === undefined ? {} : { observedAtIso: ply.provenance.observedAtIso })
  })),
  ...(result.line.error === undefined ? {} : { error: result.line.error })
});

const buildApiResponse = (
  input: StyleLinesApiInput,
  ingested: IngestedCliInput,
  results: readonly StylePathLineResult[],
  settings: AnalysisSettings,
  generatedAtIso: string
): StyleLinesApiResponse => ({
  generatedAtIso,
  position: {
    fen: String(ingested.position.fen),
    hash: String(ingested.position.hash),
    sideToMove: ingested.position.sideToMove
  },
  settings,
  lines: results.map(serializeLine),
  ...(input.includeRenderedText === false
    ? {}
    : { renderedText: renderStylePathResults(ingested, results, generatedAtIso, settings) })
});

export const analyzeStyleLinesApi = async (
  input: StyleLinesApiInput,
  ports: StyleLinesApiPorts
): Promise<Result<StyleLinesApiResponse, DomainError>> => {
  const horizonMoves = parseIntegerOption(input.horizonMoves, defaultSettings.horizonMoves, "request.horizonMoves");
  if (isErr(horizonMoves)) return horizonMoves;
  const styleDepth = parseIntegerOption(input.styleDepth, defaultSettings.styleDepth, "request.styleDepth");
  if (isErr(styleDepth)) return styleDepth;
  const ingested = ingestApiInput(ports.chess, input);
  if (isErr(ingested)) return ingested;
  const horizon = makeScenarioHorizon(horizonMoves.value * 2);
  if (isErr(horizon)) return horizon;
  const results = await generateStylePaths(ports.chess, ports.providers, {
    lineId: `api-style-${ingested.value.position.hash}`,
    start: ingested.value.position,
    horizon: horizon.value,
    styleDepth: styleDepth.value
  });
  if (isErr(results)) return results;
  const settings = { horizonMoves: horizonMoves.value, styleDepth: styleDepth.value };
  return { tag: "Ok", value: buildApiResponse(input, ingested.value, results.value, settings, ports.nowIso()) };
};

const isAuthorized = (request: IncomingMessage, token: string): boolean => request.headers.authorization === `Bearer ${token}`;

export const createStyleLinesApiHandler = (
  config: Pick<StyleLinesApiConfig, "authToken">,
  ports: StyleLinesApiPorts
): ((request: IncomingMessage, response: ServerResponse) => Promise<void>) => async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/style-lines") {
    sendJson(response, 404, errorPayload(domainError("INVALID_MOVE_NOTATION", "request.url", "Route not found")));
    return;
  }
  if (!isAuthorized(request, config.authToken)) {
    sendJson(response, 401, errorPayload(domainError("EXTERNAL_WRITE_FORBIDDEN", "request.authorization", "Missing or invalid bearer token")));
    return;
  }
  const raw = await readRequestBody(request);
  if (isErr(raw)) {
    sendJson(response, 400, errorPayload(raw.error));
    return;
  }
  const parsed = parseRequestJson(raw.value);
  if (isErr(parsed)) {
    sendJson(response, 400, errorPayload(parsed.error));
    return;
  }
  const result = await analyzeStyleLinesApi(parsed.value, ports);
  if (isErr(result)) {
    sendJson(response, 400, errorPayload(result.error));
    return;
  }
  sendJson(response, 200, result.value);
};

export const startStyleLinesApiServer = (
  config: StyleLinesApiConfig,
  ports: StyleLinesApiPorts
): Promise<Server> => new Promise(resolve => {
  const server = createServer((request, response) => {
    void createStyleLinesApiHandler(config, ports)(request, response);
  });
  server.listen(config.port, config.host, () => resolve(server));
});

const envNumber = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const runStyleLinesApi = async (): Promise<void> => {
  const authToken = process.env.CHESS_TRAINER_API_TOKEN;
  if (authToken === undefined || authToken.length < 16) {
    throw new Error("CHESS_TRAINER_API_TOKEN must be set to a secret value with at least 16 characters");
  }
  const host = process.env.CHESS_TRAINER_API_HOST ?? "127.0.0.1";
  const port = envNumber("CHESS_TRAINER_API_PORT", 8787);
  const engineSuite = process.env.CHESS_TRAINER_ENGINE_SUITE === "cstal-windows" ? "cstal-windows" : "local-style";
  const cstalOpponent = process.env.CHESS_TRAINER_CSTAL_OPPONENT === "maia1900" ? "maia1900" : "maia3";
  const maia3Elo = envNumber("CHESS_TRAINER_MAIA3_ELO", 1900);
  const chess = createChessJsRulesAdapter();
  const providers = engineSuite === "cstal-windows"
    ? createWindowsCstalStylePathProviders(chess, undefined, { opponent: cstalOpponent, maia3Elo })
    : createLocalStylePathProviders(chess);
  await startStyleLinesApiServer({ host, port, authToken }, {
    chess,
    providers,
    nowIso: () => new Date().toISOString()
  });
  process.stdout.write(`Chess Trainer StylePath API listening on http://${host}:${port}\n`);
};

if (process.argv[1]?.endsWith("style-lines-http.ts") === true) {
  runStyleLinesApi().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
