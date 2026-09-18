import { existsSync, readFileSync } from "node:fs";
import type { ChessRulesPort } from "../../application/ports/chess-rules";
import type { StylePathLineResult } from "../../application/use-cases/style-path";
import type { PositionSnapshot } from "../../domain/chess/position";
import { makePlyIndex, makeRequestId, makeScenarioHorizon, type ScenarioHorizon } from "../../domain/chess/value-objects";
import type { MoveSource, ProviderIdentity } from "../../domain/provenance/provenance";
import type { ScenarioLine, ScenarioLineStatus } from "../../domain/scenario-lines/scenario-line";
import type { PatternTargetSession } from "../../application/use-cases/pattern-target-branching";
import { rankPatternTargets } from "../../application/use-cases/pattern-target-branching";
import { isPatternFamilyId, type PatternFamilyId } from "../../domain/patterns/pattern";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";

export type RemoteStylePathConfig = Readonly<{
  baseUrl: string;
  token: string;
  cstalOpponent: "maia3" | "maia1900";
  maia3Elo: number;
  timeoutMs: number;
}>;

type RemoteProvider = string | Readonly<{ name?: unknown; displayName?: unknown; version?: unknown }>;
type RemoteProvenance = Readonly<{ source?: unknown; provider?: RemoteProvider; requestId?: unknown; configuration?: unknown }>;
type RemotePly = Readonly<{
  index: number;
  uci?: string;
  san?: string;
  move?: Readonly<{ uci?: unknown }>;
  source?: string;
  provider?: RemoteProvider;
  provenance?: RemoteProvenance;
  requestId?: string;
  inputPositionHash?: string;
  configuration?: Readonly<Record<string, unknown>>;
}>;
type RemoteLine = Readonly<{ engineKey: string; label: string; status: string; start?: unknown; targetFamily?: unknown; styleDepth?: number; plies: readonly RemotePly[]; decisionTraces?: NonNullable<ScenarioLine["decisionTraces"]>; error?: DomainError }>;
type RemoteJobSnapshot = Readonly<{ jobId: string; status: string; lines: readonly RemoteLine[] }>;
type RemoteSteeringLine = Readonly<{ status: string; start?: unknown; horizon?: unknown; targetFamily?: unknown; plies: readonly RemotePly[]; decisionTraces?: NonNullable<ScenarioLine["decisionTraces"]>; error?: DomainError }>;
type RemoteSteeringTarget = Readonly<{ targetFamily: string; triggerPly: number; triggerAffinity: number; position?: unknown; prefixPlies: readonly RemotePly[]; line?: RemoteSteeringLine }>;
type RemoteSteeringSession = Readonly<{ discovery: RemoteSteeringLine; targets: readonly RemoteSteeringTarget[] }>;
type RemoteBatchResult = Readonly<{ caseId: string; status: string; snapshot?: RemoteJobSnapshot; steeringLine?: RemoteSteeringLine; steeringSession?: RemoteSteeringSession; error?: DomainError }>;
type RemoteBatchSnapshot = Readonly<{ batchId: string; status: string; completed?: number; results: readonly RemoteBatchResult[] }>;
export type RemotePatternSteeringLine = ScenarioLine & Readonly<{ targetSession?: PatternTargetSession }>;

const base64Utf8 = (value: string): string => Buffer.from(value, "utf8").toString("base64");

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

const providerIdentity = (provider: RemoteProvider): ProviderIdentity => {
  if (typeof provider === "string") return { name: "remote-style-api", displayName: provider, version: "windows-cstal-api" };
  const displayName = typeof provider.displayName === "string" ? provider.displayName : "Remote StylePath provider";
  return {
    name: typeof provider.name === "string" ? provider.name : "remote-style-api",
    displayName,
    version: typeof provider.version === "string" ? provider.version : "windows-cstal-api"
  };
};

const remoteSource = (ply: RemotePly): string | undefined => (
  typeof ply.provenance?.source === "string" ? ply.provenance.source : ply.source
);

const remoteProvider = (ply: RemotePly): RemoteProvider | undefined => ply.provenance?.provider ?? ply.provider;

const remoteUci = (ply: RemotePly): string | undefined => (
  typeof ply.uci === "string" ? ply.uci : typeof ply.move?.uci === "string" ? ply.move.uci : undefined
);

const remoteRequestId = (ply: RemotePly): string | undefined => (
  typeof ply.provenance?.requestId === "string" ? ply.provenance.requestId : ply.requestId
);

const remoteConfiguration = (ply: RemotePly): Readonly<Record<string, unknown>> => {
  const configuration = ply.provenance?.configuration ?? ply.configuration;
  return configuration !== null && typeof configuration === "object" && !Array.isArray(configuration)
    ? configuration as Readonly<Record<string, unknown>>
    : {};
};

const positionFromRemote = (chess: ChessRulesPort, fallback: PositionSnapshot, value: unknown, path: string): Result<PositionSnapshot, DomainError> => {
  if (value === undefined || value === null || typeof value !== "object" || typeof (value as { fen?: unknown }).fen !== "string") return ok(fallback);
  const parsed = chess.ingestPosition((value as { fen: string }).fen);
  return isErr(parsed) ? err(domainError("INVALID_FEN", path, "Remote API returned an invalid branch start position", { cause: parsed.error })) : parsed;
};

const makeRemotePlies = (chess: ChessRulesPort, start: PositionSnapshot, remotePlies: readonly RemotePly[], config: RemoteStylePathConfig, pathPrefix: string): Result<readonly import("../../domain/scenario-lines/scenario-line").ScenarioPly[], DomainError> => {
  let current = start;
  const plies = [];
  for (const [offset, remotePly] of remotePlies.entries()) {
    const source = sourceFor(remoteSource(remotePly) ?? "");
    if (source === undefined) return responseError(`${pathPrefix}.plies.${offset}.source`, "Remote API returned an unsupported provenance source", { source: remoteSource(remotePly) });
    const uci = remoteUci(remotePly);
    if (uci === undefined) return responseError(`${pathPrefix}.plies.${offset}.move`, "Remote API returned a ply without a UCI move");
    const provider = remoteProvider(remotePly);
    if (provider === undefined) return responseError(`${pathPrefix}.plies.${offset}.provider`, "Remote API returned a ply without provider provenance");
    const move = chess.parseLegalMove(current, uci);
    if (isErr(move)) return err(domainError("PROVIDER_ILLEGAL_MOVE", `${pathPrefix}.plies.${offset}.move`, "Remote API returned an illegal move", { uci, cause: move.error }));
    plies.push({
      tag: "ScenarioPly" as const,
      index: makePlyIndex(remotePly.index > 0 ? remotePly.index : offset + 1),
      move: move.value,
      provenance: {
        source,
        provider: providerIdentity(provider),
        status: "IMPORTED" as const,
        requestId: makeRequestId(remoteRequestId(remotePly) ?? `remote-${pathPrefix}-${offset + 1}`),
        inputPositionHash: current.hash,
        configuration: { remoteApiBaseUrl: config.baseUrl, ...remoteConfiguration(remotePly) }
      }
    });
    const next = chess.applyMove(current, move.value);
    if (isErr(next)) return err(next.error);
    current = next.value;
  }
  return ok(plies);
};

const makeRemoteLine = (chess: ChessRulesPort, start: PositionSnapshot, horizon: ScenarioHorizon, remote: RemoteLine, config: RemoteStylePathConfig, mode: ScenarioLine["mode"] = "StylePath"): Result<StylePathLineResult, DomainError> => {
  const resolvedStart = positionFromRemote(chess, start, remote.start, `remoteStyleApi.${remote.engineKey}.start`);
  if (isErr(resolvedStart)) return err(resolvedStart.error);
  const parsedPlies = makeRemotePlies(chess, resolvedStart.value, remote.plies, config, `remoteStyleApi.${remote.engineKey}`);
  if (isErr(parsedPlies)) return err(parsedPlies.error);
  const line: ScenarioLine = {
    tag: "ScenarioLine",
    mode,
    label: remote.label,
    start: resolvedStart.value,
    horizon,
    plies: parsedPlies.value,
    status: statusFor(remote.status),
    ...(isPatternFamilyId(String(remote.targetFamily ?? "")) ? { targetFamily: String(remote.targetFamily) as PatternFamilyId } : {}),
    ...(remote.decisionTraces === undefined ? {} : { decisionTraces: remote.decisionTraces }),
    ...(remote.error === undefined ? {} : { error: remote.error })
  };
  return ok({ engineKey: remote.engineKey, line, ...(remote.styleDepth === undefined ? {} : { styleDepth: remote.styleDepth }) });
};

const makeRemoteSteeringSession = (chess: ChessRulesPort, start: PositionSnapshot, horizon: ScenarioHorizon, remote: RemoteSteeringSession, config: RemoteStylePathConfig): Result<Readonly<{ discovery: ScenarioLine; targets: readonly Readonly<{ targetFamily: PatternFamilyId; triggerPly: number; triggerAffinity: number; position: PositionSnapshot; prefixPlies: readonly import("../../domain/scenario-lines/scenario-line").ScenarioPly[]; line?: ScenarioLine }>[] }>, DomainError> => {
  const discovery = makeRemoteLine(chess, start, horizon, { engineKey: "pattern-discovery", label: "PatternSteeredTalPath", status: remote.discovery.status, plies: remote.discovery.plies, ...(remote.discovery.decisionTraces === undefined ? {} : { decisionTraces: remote.discovery.decisionTraces }), ...(remote.discovery.error === undefined ? {} : { error: remote.discovery.error }) }, config, "HumanPath");
  if (isErr(discovery)) return err(discovery.error);
  const targets = [];
  for (const [index, target] of remote.targets.entries()) {
    if (!isPatternFamilyId(target.targetFamily)) return responseError(`remotePatternSteering.targets.${index}.targetFamily`, "Remote API returned an unsupported target family");
    const branchStart = positionFromRemote(chess, start, target.position, `remotePatternSteering.targets.${index}.position`);
    if (isErr(branchStart)) return err(branchStart.error);
    const prefix = makeRemotePlies(chess, start, target.prefixPlies, config, `remotePatternSteering.targets.${index}.prefix`);
    if (isErr(prefix)) return err(prefix.error);
    let line: ScenarioLine | undefined;
    if (target.line !== undefined) {
      const parsed = makeRemoteLine(chess, branchStart.value, horizon, { engineKey: `pattern-target-${target.targetFamily}`, label: `Target ${target.targetFamily}`, status: target.line.status, ...(target.line.start === undefined ? {} : { start: target.line.start }), targetFamily: target.targetFamily, plies: target.line.plies, ...(target.line.decisionTraces === undefined ? {} : { decisionTraces: target.line.decisionTraces }), ...(target.line.error === undefined ? {} : { error: target.line.error }) }, config, "HumanPath");
      if (isErr(parsed)) return err(parsed.error);
      line = parsed.value.line;
    }
    targets.push({ targetFamily: target.targetFamily, triggerPly: target.triggerPly, triggerAffinity: target.triggerAffinity, position: branchStart.value, prefixPlies: prefix.value, ...(line === undefined ? {} : { line }) });
  }
  return ok({ discovery: discovery.value.line, targets: rankPatternTargets(targets) });
};

const parseSseSnapshots = async (response: Response, onSnapshot?: (snapshot: unknown) => void): Promise<readonly unknown[]> => {
  const snapshots: unknown[] = [];
  const consume = (block: string): void => {
    const data = block.split(/\r?\n/u).find(line => line.startsWith("data:"))?.slice("data:".length).trim();
    if (data === undefined || data.length === 0) return;
    const snapshot = JSON.parse(data) as unknown;
    snapshots.push(snapshot);
    onSnapshot?.(snapshot);
  };
  if (response.body === null || response.body === undefined) {
    (await response.text()).split(/\r?\n\r?\n/u).forEach(consume);
    return snapshots;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const blocks = buffer.split(/\r?\n\r?\n/u);
    buffer = blocks.pop() ?? "";
    blocks.forEach(consume);
    if (chunk.done) break;
  }
  if (buffer.trim().length > 0) consume(buffer);
  return snapshots;
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
  cases: readonly Readonly<{ caseId: string; position: PositionSnapshot; rawGame?: string }>[],
  horizon: ScenarioHorizon,
  config: RemoteStylePathConfig,
  concurrency = 2,
  onProgress?: (progress: Readonly<{ status: string; completed: number; total: number; caseId?: string; line?: RemotePatternSteeringLine; session?: PatternTargetSession }>) => void
): Promise<Result<Readonly<Record<string, RemotePatternSteeringLine>>, DomainError>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs * Math.max(1, cases.length));
  try {
    const response = await fetch(`${config.baseUrl}/v1/pattern-experiments/batches`, {
      method: "POST", signal: controller.signal,
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ datasetVersion: "pattern-steering-runtime", mode: "steering", concurrency, cstalOpponent: config.cstalOpponent, maia3Elo: config.maia3Elo, maxFullMoves: Math.max(1, Math.floor(Number(horizon) / 2)), timeoutMs: config.timeoutMs, cases: cases.map(item => ({ caseId: item.caseId, fen: String(item.position.fen), ...(item.rawGame === undefined ? {} : { rawGameBase64: base64Utf8(item.rawGame) }) })) })
    });
    const created = await response.json().catch(() => undefined) as { batchId?: unknown } | undefined;
    if (!response.ok || typeof created?.batchId !== "string") return responseError("remotePatternSteering.createBatch", "Remote Pattern steering batch creation failed", { status: response.status });
    const events = await fetch(`${config.baseUrl}/v1/pattern-experiments/batches/${encodeURIComponent(created.batchId)}/events`, { signal: controller.signal, headers: { authorization: `Bearer ${config.token}` } });
    if (!events.ok || events.body === null) return responseError("remotePatternSteering.events", "Remote Pattern steering event stream failed", { status: events.status });
    const final = (await parseSseSnapshots(events, snapshot => {
      if (!isRemoteBatchSnapshot(snapshot)) return;
      const completed = snapshot.completed ?? snapshot.results.filter(item => item.status === "complete" || item.status === "error").length;
      onProgress?.({ status: snapshot.status, completed, total: cases.length });
      for (const item of snapshot.results) {
        const source = cases.find(candidate => candidate.caseId === item.caseId);
        if (source === undefined || (item.steeringLine === undefined && item.steeringSession === undefined)) continue;
        const normalized = makeScenarioHorizon(Number(horizon));
        if (isErr(normalized)) continue;
        if (item.steeringSession !== undefined) {
          const session = makeRemoteSteeringSession(chess, source.position, normalized.value, item.steeringSession, config);
          if (!isErr(session)) onProgress?.({ status: snapshot.status, completed, total: cases.length, caseId: item.caseId, line: { ...session.value.discovery, targetSession: session.value }, session: session.value });
          continue;
        }
        const steeringLine = item.steeringLine;
        if (steeringLine === undefined) continue;
        const remoteLine: RemoteLine = { engineKey: "pattern-steered-tal", label: "PatternSteeredTalPath", status: steeringLine.status, ...(steeringLine.start === undefined ? {} : { start: steeringLine.start }), plies: steeringLine.plies, ...(steeringLine.decisionTraces === undefined ? {} : { decisionTraces: steeringLine.decisionTraces }), ...(steeringLine.error === undefined ? {} : { error: steeringLine.error }) };
        const lineResult = makeRemoteLine(chess, source.position, normalized.value, remoteLine, config);
        if (!isErr(lineResult)) onProgress?.({ status: snapshot.status, completed, total: cases.length, caseId: item.caseId, line: lineResult.value.line });
      }
    })).filter(isRemoteBatchSnapshot).at(-1);
    if (final === undefined) return responseError("remotePatternSteering.events", "Remote Pattern steering batch returned no final snapshot");
    const result: Record<string, RemotePatternSteeringLine> = {};
    for (const item of final.results) {
      const source = cases.find(candidate => candidate.caseId === item.caseId);
      if (source === undefined) return responseError(`remotePatternSteering.batch.${item.caseId}`, "Remote steering returned an unknown case", { caseId: item.caseId });
      if (item.error !== undefined) {
        return err(domainError(item.error.code, `remotePatternSteering.batch.${item.caseId}.${item.error.path}`, item.error.message, {
          caseId: item.caseId,
          ...(item.error.details ?? {})
        }));
      }
      if (item.steeringLine === undefined && item.steeringSession === undefined) return responseError(`remotePatternSteering.batch.${item.caseId}`, "Remote steering result is incomplete", { caseId: item.caseId, status: item.status });
      const normalized = makeScenarioHorizon(Number(horizon));
      if (isErr(normalized)) return err(normalized.error);
      if (item.steeringSession !== undefined) {
        const session = makeRemoteSteeringSession(chess, source.position, normalized.value, item.steeringSession, config);
        if (isErr(session)) return err(session.error);
        result[item.caseId] = { ...session.value.discovery, targetSession: session.value };
        continue;
      }
      const remoteLine: RemoteLine = { engineKey: "pattern-steered-tal", label: "PatternSteeredTalPath", status: item.steeringLine!.status, plies: item.steeringLine!.plies, ...(item.steeringLine!.decisionTraces === undefined ? {} : { decisionTraces: item.steeringLine!.decisionTraces }), ...(item.steeringLine!.error === undefined ? {} : { error: item.steeringLine!.error }) };
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
