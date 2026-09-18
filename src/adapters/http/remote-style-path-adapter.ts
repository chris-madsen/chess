import { existsSync, readFileSync } from "node:fs";
import type { ChessRulesPort } from "../../application/ports/chess-rules";
import type { StylePathLineResult } from "../../application/use-cases/style-path";
import type { PositionSnapshot } from "../../domain/chess/position";
import { makePlyIndex, makeRequestId, makeScenarioHorizon, type ScenarioHorizon } from "../../domain/chess/value-objects";
import type { MoveSource, ProviderIdentity } from "../../domain/provenance/provenance";
import type { ScenarioLine, ScenarioLineStatus } from "../../domain/scenario-lines/scenario-line";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";

export type RemoteStylePathConfig = Readonly<{
  baseUrl: string;
  token: string;
  cstalOpponent: "maia3" | "maia1900";
  maia3Elo: number;
  timeoutMs: number;
}>;

type RemotePly = Readonly<{ index: number; uci: string; san: string; source: string; provider: string; requestId?: string; inputPositionHash?: string; configuration?: Readonly<Record<string, unknown>> }>;
type RemoteLine = Readonly<{ engineKey: string; label: string; status: string; styleDepth?: number; plies: readonly RemotePly[]; error?: DomainError }>;
type RemoteJobSnapshot = Readonly<{ jobId: string; status: string; lines: readonly RemoteLine[] }>;
type RemoteSteeringLine = Readonly<{ status: string; start?: unknown; horizon?: unknown; plies: readonly RemotePly[]; error?: DomainError }>;
type RemoteBatchResult = Readonly<{ caseId: string; status: string; snapshot?: RemoteJobSnapshot; steeringLine?: RemoteSteeringLine; error?: DomainError }>;
type RemoteBatchSnapshot = Readonly<{ batchId: string; status: string; results: readonly RemoteBatchResult[] }>;

const tokenFromEnvironment = (): string | undefined => {
  const direct = process.env.CHESS_STYLE_API_TOKEN ?? process.env.CHESS_TRAINER_API_TOKEN;
  if (direct?.trim()) return direct.trim();
  const paths = [process.env.CHESS_STYLE_API_TOKEN_FILE, process.env.STYLE_SERVER_TOKEN_FILE, ".local/style-server-token.txt", "/media/ilja/DATA/chess/chess-api.ken"]
    .filter((path): path is string => path !== undefined && path.length > 0);
  const path = paths.find(candidate => existsSync(candidate));
  return path === undefined ? undefined : readFileSync(path, "utf8").trim();
};

export const makeRemoteStylePathConfig = (overrides: Partial<Omit<RemoteStylePathConfig, "token">> & { token?: string } = {}): Result<RemoteStylePathConfig, DomainError> => {
  const token = overrides.token?.trim() || tokenFromEnvironment();
  if (token === undefined || token.length < 16) return err(domainError("PROVIDER_UNAVAILABLE", "remoteStyleApi.token", "A remote StylePath API token is required"));
  return ok({
    baseUrl: (overrides.baseUrl ?? process.env.CHESS_STYLE_API_BASE_URL ?? "https://chess.network-communications.net").replace(/\/$/u, ""),
    token,
    cstalOpponent: overrides.cstalOpponent ?? "maia3",
    maia3Elo: overrides.maia3Elo ?? 1800,
    timeoutMs: overrides.timeoutMs ?? 900_000
  });
};

const responseError = (path: string, message: string, details?: Readonly<Record<string, unknown>>): Result<never, DomainError> => err(domainError("PROVIDER_UNAVAILABLE", path, message, details));

const isRemoteJobSnapshot = (value: unknown): value is RemoteJobSnapshot => value !== null && typeof value === "object" && typeof (value as { jobId?: unknown }).jobId === "string" && Array.isArray((value as { lines?: unknown }).lines);
const isRemoteBatchSnapshot = (value: unknown): value is RemoteBatchSnapshot => value !== null && typeof value === "object" && typeof (value as { batchId?: unknown }).batchId === "string" && Array.isArray((value as { results?: unknown }).results);

const sourceFor = (source: string): MoveSource | undefined => source === "LOCAL_STYLE_ENGINE" || source === "MAIA" ? source : undefined;

const statusFor = (status: string): ScenarioLineStatus => ["Complete", "Incomplete", "Terminal", "Failed"].includes(status) ? status as ScenarioLineStatus : "Incomplete";

const providerIdentity = (provider: string): ProviderIdentity => ({ name: "remote-style-api", displayName: provider, version: "windows-cstal-api" });

const makeRemoteLine = (chess: ChessRulesPort, start: PositionSnapshot, horizon: ScenarioHorizon, remote: RemoteLine, config: RemoteStylePathConfig): Result<StylePathLineResult, DomainError> => {
  let current = start;
  const plies = [];
  for (const [offset, remotePly] of remote.plies.entries()) {
    const source = sourceFor(remotePly.source);
    if (source === undefined) return responseError(`remoteStyleApi.${remote.engineKey}.plies.${offset}.source`, "Remote API returned an unsupported provenance source", { source: remotePly.source });
    const move = chess.parseLegalMove(current, remotePly.uci);
    if (isErr(move)) return err(domainError("PROVIDER_ILLEGAL_MOVE", `remoteStyleApi.${remote.engineKey}.plies.${offset}.move`, "Remote API returned an illegal move", { uci: remotePly.uci, cause: move.error }));
    plies.push({
      tag: "ScenarioPly" as const,
      index: makePlyIndex(remotePly.index > 0 ? remotePly.index : offset + 1),
      move: move.value,
      provenance: {
        source,
        provider: providerIdentity(remotePly.provider),
        status: "IMPORTED" as const,
        requestId: makeRequestId(remotePly.requestId ?? `remote-${remote.engineKey}-${offset + 1}`),
        inputPositionHash: current.hash,
        configuration: { remoteApiBaseUrl: config.baseUrl, ...(remotePly.configuration ?? {}) }
      }
    });
    const next = chess.applyMove(current, move.value);
    if (isErr(next)) return err(next.error);
    current = next.value;
  }
  const line: ScenarioLine = {
    tag: "ScenarioLine",
    mode: "StylePath",
    label: remote.label,
    start,
    horizon,
    plies,
    status: statusFor(remote.status),
    ...(remote.error === undefined ? {} : { error: remote.error })
  };
  return ok({ engineKey: remote.engineKey, line, ...(remote.styleDepth === undefined ? {} : { styleDepth: remote.styleDepth }) });
};

const parseSseSnapshots = async (response: Response): Promise<readonly unknown[]> => {
  const eventText = await response.text();
  return eventText.split(/\r?\n\r?\n/u)
    .map(block => block.split(/\r?\n/u).find(line => line.startsWith("data:"))?.slice("data:".length).trim())
    .filter((data): data is string => data !== undefined)
    .map(data => JSON.parse(data) as unknown);
};

export const fetchRemoteStylePaths = async (
  chess: ChessRulesPort,
  start: PositionSnapshot,
  horizon: ScenarioHorizon,
  config: RemoteStylePathConfig,
  styleDepth?: number
): Promise<Result<readonly StylePathLineResult[], DomainError>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/v1/style-lines/jobs`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ fen: String(start.fen), engineSuite: "cstal-windows", cstalOpponent: config.cstalOpponent, maia3Elo: config.maia3Elo, refreshMs: 2_000, maxFullMoves: Math.max(1, Math.floor(Number(horizon) / 2)), timeoutMs: config.timeoutMs, ...(styleDepth === undefined ? {} : { styleDepth }) })
    });
    const created = await response.json().catch(() => undefined) as { jobId?: unknown } | undefined;
    if (!response.ok || typeof created?.jobId !== "string") return responseError("remoteStyleApi.createJob", "Remote StylePath API job creation failed", { status: response.status });
    const events = await fetch(`${config.baseUrl}/v1/style-lines/jobs/${encodeURIComponent(created.jobId)}/events`, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${config.token}` }
    });
    if (!events.ok || events.body === null) return responseError("remoteStyleApi.events", "Remote StylePath API event stream failed", { status: events.status });
    const snapshots = (await parseSseSnapshots(events)).filter(isRemoteJobSnapshot);
    const body = snapshots.at(-1);
    if (body === undefined) return responseError("remoteStyleApi.events", "Remote StylePath API returned no final snapshot");
    const normalizedHorizon = makeScenarioHorizon(Number(horizon));
    if (isErr(normalizedHorizon)) return err(normalizedHorizon.error);
    const lines = body.lines.map(line => makeRemoteLine(chess, start, normalizedHorizon.value, line, config));
    const values: StylePathLineResult[] = [];
    for (const line of lines) {
      if (isErr(line)) return err(line.error);
      values.push(line.value);
    }
    return ok(values);
  } catch (error) {
    return responseError("remoteStyleApi.request", "Remote StylePath API request failed", { cause: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
};

export const fetchRemoteStylePathBatch = async (
  chess: ChessRulesPort,
  cases: readonly Readonly<{ caseId: string; position: PositionSnapshot }>[] ,
  horizon: ScenarioHorizon,
  config: RemoteStylePathConfig,
  concurrency = 2
): Promise<Result<Readonly<Record<string, readonly StylePathLineResult[]>>, DomainError>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs * Math.max(1, cases.length));
  try {
    const response = await fetch(`${config.baseUrl}/v1/pattern-experiments/batches`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        datasetVersion: "pattern-steering-remote",
        concurrency,
        cstalOpponent: config.cstalOpponent,
        maia3Elo: config.maia3Elo,
        refreshMs: 2_000,
        maxFullMoves: Math.max(1, Math.floor(Number(horizon) / 2)),
        timeoutMs: config.timeoutMs,
        cases: cases.map(item => ({ caseId: item.caseId, fen: String(item.position.fen) }))
      })
    });
    const created = await response.json().catch(() => undefined) as { batchId?: unknown } | undefined;
    if (!response.ok || typeof created?.batchId !== "string") return responseError("remoteStyleApi.createBatch", "Remote Pattern batch API creation failed", { status: response.status });
    const events = await fetch(`${config.baseUrl}/v1/pattern-experiments/batches/${encodeURIComponent(created.batchId)}/events`, { signal: controller.signal, headers: { authorization: `Bearer ${config.token}` } });
    if (!events.ok || events.body === null) return responseError("remoteStyleApi.batchEvents", "Remote Pattern batch event stream failed", { status: events.status });
    const snapshots = (await parseSseSnapshots(events)).filter(isRemoteBatchSnapshot);
    const final = snapshots.at(-1);
    if (final === undefined) return responseError("remoteStyleApi.batchEvents", "Remote Pattern batch returned no final snapshot");
    const normalizedHorizon = makeScenarioHorizon(Number(horizon));
    if (isErr(normalizedHorizon)) return err(normalizedHorizon.error);
    const values: Record<string, readonly StylePathLineResult[]> = {};
    for (const item of final.results) {
      const source = cases.find(candidate => candidate.caseId === item.caseId);
      if (source === undefined || item.snapshot === undefined) return responseError(`remoteStyleApi.batch.${item.caseId}`, "Remote Pattern batch result is incomplete");
      const lines = item.snapshot.lines.map(line => makeRemoteLine(chess, source.position, normalizedHorizon.value, line, config));
      const resolved: StylePathLineResult[] = [];
      for (const line of lines) {
        if (isErr(line)) return err(line.error);
        resolved.push(line.value);
      }
      values[item.caseId] = resolved;
    }
    return ok(values);
  } catch (error) {
    return responseError("remoteStyleApi.batchRequest", "Remote Pattern batch request failed", { cause: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
};

export const fetchRemotePatternSteeringBatch = async (
  chess: ChessRulesPort,
  cases: readonly Readonly<{ caseId: string; position: PositionSnapshot }>[],
  horizon: ScenarioHorizon,
  config: RemoteStylePathConfig,
  concurrency = 2
): Promise<Result<Readonly<Record<string, ScenarioLine>>, DomainError>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs * Math.max(1, cases.length));
  try {
    const response = await fetch(`${config.baseUrl}/v1/pattern-experiments/batches`, {
      method: "POST", signal: controller.signal,
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ datasetVersion: "pattern-steering-runtime", mode: "steering", concurrency, cstalOpponent: config.cstalOpponent, maia3Elo: config.maia3Elo, maxFullMoves: Math.max(1, Math.floor(Number(horizon) / 2)), timeoutMs: config.timeoutMs, cases: cases.map(item => ({ caseId: item.caseId, fen: String(item.position.fen) })) })
    });
    const created = await response.json().catch(() => undefined) as { batchId?: unknown } | undefined;
    if (!response.ok || typeof created?.batchId !== "string") return responseError("remotePatternSteering.createBatch", "Remote Pattern steering batch creation failed", { status: response.status });
    const events = await fetch(`${config.baseUrl}/v1/pattern-experiments/batches/${encodeURIComponent(created.batchId)}/events`, { signal: controller.signal, headers: { authorization: `Bearer ${config.token}` } });
    if (!events.ok || events.body === null) return responseError("remotePatternSteering.events", "Remote Pattern steering event stream failed", { status: events.status });
    const final = (await parseSseSnapshots(events)).filter(isRemoteBatchSnapshot).at(-1);
    if (final === undefined) return responseError("remotePatternSteering.events", "Remote Pattern steering batch returned no final snapshot");
    const result: Record<string, ScenarioLine> = {};
    for (const item of final.results) {
      const source = cases.find(candidate => candidate.caseId === item.caseId);
      if (source === undefined || item.steeringLine === undefined) return responseError(`remotePatternSteering.batch.${item.caseId}`, "Remote steering result is incomplete");
      const normalized = makeScenarioHorizon(Number(horizon));
      if (isErr(normalized)) return err(normalized.error);
      const remoteLine: RemoteLine = { engineKey: "pattern-steered-tal", label: "PatternSteeredTalPath", status: item.steeringLine.status, plies: item.steeringLine.plies, ...(item.steeringLine.error === undefined ? {} : { error: item.steeringLine.error }) };
      const lineResult = makeRemoteLine(chess, source.position, normalized.value, remoteLine, config);
      if (isErr(lineResult)) return err(lineResult.error);
      result[item.caseId] = lineResult.value.line;
    }
    return ok(result);
  } catch (error) {
    return responseError("remotePatternSteering.request", "Remote Pattern steering batch request failed", { cause: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
};
