#!/usr/bin/env node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import type { ChessRulesPort } from "../application/ports/chess-rules";
import type { LocalStyleEngineProvider, MoveProvider, StylePathProviders } from "../application/ports/providers";
import type { CandidateGenerator, CandidateTacticalGate } from "../application/ports/pattern-steering";
import { formatSanMovetext, ingestInput, INITIAL_ANALYSIS_SETTINGS, type CliOptions, type IngestedCliInput } from "../cli/style-lines";
import { makePlyIndex } from "../domain/chess/value-objects";
import { makeScenarioHorizon } from "../domain/chess/value-objects";
import type { PositionSnapshot } from "../domain/chess/position";
import type { ScenarioPly, ScenarioLineStatus } from "../domain/scenario-lines/scenario-line";
import type { MoveSource } from "../domain/provenance/provenance";
import type { DomainError } from "../domain/shared/errors";
import { isErr, type Result } from "../domain/shared/result";
import { createPatriciaCandidateGenerator, createWindowsCstalPatternCandidateGenerator, createWindowsCstalStylePathProviders, createWindowsCstalTacticalGate, loadLocalEnginePaths, type WindowsCstalOpponent } from "../wiring/local-style-engines";
import { generatePatternSteeredTalPath } from "../application/use-cases/pattern-steered-tal-path";
import { createInMemoryAnalysisCache } from "../adapters/cache/in-memory-analysis-cache";

type JobStatus = "queued" | "running" | "complete" | "error" | "cancelled";
type JobEventType = "queued" | "started" | "progress" | "complete" | "error" | "cancelled";

export type StyleServerJobRequest = Readonly<{
  rawGameBase64?: string;
  fen?: string;
  engineSuite?: "cstal-windows";
  cstalOpponent?: WindowsCstalOpponent;
  maia3Elo?: number;
  refreshMs?: number;
  maxFullMoves?: number;
  timeoutMs?: number;
}>;

type NormalizedJobRequest = Readonly<{
  rawGame?: string;
  fen?: string;
  engineSuite: "cstal-windows";
  cstalOpponent: WindowsCstalOpponent;
  maia3Elo: number;
  refreshMs: number;
  maxFullMoves: number;
  timeoutMs: number;
}>;

type ServerConfig = Readonly<{
  token: string;
  host: string;
  port: number;
  allowedCountries: readonly string[];
}>;

const localStyleServerTokenPath = ".local/style-server-token.txt";

export const readStyleServerToken = (tokenPath = localStyleServerTokenPath): string => {
  const tokenFromEnv = process.env.STYLE_SERVER_TOKEN?.trim();
  if (tokenFromEnv !== undefined && tokenFromEnv.length > 0) {
    return tokenFromEnv;
  }
  if (!existsSync(tokenPath)) {
    return "";
  }
  return readFileSync(tokenPath, "utf8").trim();
};

type JobLineSnapshot = Readonly<{
  engineKey: string;
  label: string;
  status: ScenarioLineStatus;
  styleDepth: number;
  sanMovetext: string;
  plies: readonly Readonly<{
    index: number;
    san: string;
    uci: string;
    source: MoveSource;
    provider: string;
  }>[];
  error?: DomainError;
}>;

type JobSnapshot = Readonly<{
  jobId: string;
  status: JobStatus;
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
  lines: readonly JobLineSnapshot[];
  error?: DomainError;
}>;

type JobEvent = Readonly<{
  id: number;
  type: JobEventType;
  at: string;
  data: JobSnapshot;
}>;

type PatternBatchCase = Readonly<{ caseId: string; fen: string }>;
type PatternBatchRequest = Readonly<{
  datasetVersion?: string;
  cases: readonly PatternBatchCase[];
  concurrency?: number;
  cstalOpponent?: WindowsCstalOpponent;
  maia3Elo?: number;
  refreshMs?: number;
  maxFullMoves?: number;
  timeoutMs?: number;
  mode?: "posthoc" | "steering";
}>;
type PatternSteeringProviders = Readonly<{
  generator: CandidateGenerator;
  tacticalGate: CandidateTacticalGate;
  maia: MoveProvider;
  dispose?: () => void;
}>;
type PatternBatch = {
  id: string;
  status: "running" | "complete" | "incomplete";
  datasetVersion: string;
  createdAt: string;
  total: number;
  completed: number;
  results: Array<Readonly<{ caseId: string; status: JobStatus; snapshot?: JobSnapshot; steeringLine?: unknown; error?: DomainError }>>;
  subscribers: Set<ServerResponse>;
  events: Array<Readonly<{ type: "started" | "progress" | "complete"; data: unknown }>>;
  finalEmitted: boolean;
};

type LineState = {
  currentPosition: PositionSnapshot;
  plies: ScenarioPly[];
  status: "Incomplete" | "Complete" | "Terminal";
  error?: DomainError;
};

type StyleJob = {
  id: string;
  request: NormalizedJobRequest;
  status: JobStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  events: JobEvent[];
  subscribers: Set<ServerResponse>;
  nextEventId: number;
  snapshot: JobSnapshot;
  abort: AbortController;
  providers?: StylePathProviders;
  ingested?: IngestedCliInput;
  targetHorizonMoves: number;
  finalEmitted: boolean;
  error?: DomainError;
};

export type StyleServerPorts = Readonly<{
  chess?: ChessRulesPort;
  createProviders?: (chess: ChessRulesPort, options: Readonly<{ opponent: WindowsCstalOpponent; maia3Elo: number }>) => StylePathProviders;
  now?: () => Date;
  makeJobId?: () => string;
  createPatternSteering?: (chess: ChessRulesPort, options: Readonly<{ opponent: WindowsCstalOpponent; maia3Elo: number }>) => PatternSteeringProviders;
}>;

const defaultConfig = (): ServerConfig => ({
  token: readStyleServerToken(),
  host: process.env.STYLE_SERVER_HOST ?? "127.0.0.1",
  port: Number(process.env.STYLE_SERVER_PORT ?? "8787"),
  allowedCountries: (process.env.STYLE_ALLOWED_COUNTRIES ?? "")
    .split(",")
    .map(country => country.trim().toUpperCase())
    .filter(Boolean)
});

const windowsListeningPids = (port: number): number[] => {
  if (process.platform !== "win32") return [];
  const output = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*TCP\s+\S+:([0-9]+)\s+\S+\s+LISTENING\s+([0-9]+)\s*$/i.exec(line);
    if (match !== null && Number(match[1]) === port) {
      const pid = Number(match[2]);
      if (pid > 0 && pid !== process.pid) pids.add(pid);
    }
  }
  return [...pids];
};

const stopWindowsPortOwners = (port: number): number[] => {
  const pids = windowsListeningPids(port);
  for (const pid of pids) {
    execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  }
  return pids;
};

const jsonResponse = (response: ServerResponse, status: number, data: unknown): void => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(data)}\n`);
};

const textResponse = (response: ServerResponse, status: number, text: string): void => {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
};

const readJsonBody = async (request: IncomingMessage, limitBytes = 1_000_000): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim().length === 0 ? {} : JSON.parse(text) as unknown;
};

const headerValue = (value: string | string[] | undefined): string | undefined => (
  Array.isArray(value) ? value[0] : value
);

const integerInRange = (value: unknown, fallback: number, min: number, max: number): number | undefined => {
  if (value === undefined) {
    return fallback;
  }
  return Number.isInteger(value) && typeof value === "number" && value >= min && value <= max ? value : undefined;
};

const normalizeJobRequest = (body: unknown): NormalizedJobRequest | DomainError => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { code: "INVALID_MOVE_NOTATION", path: "body", message: "Request body must be a JSON object" };
  }
  const data = body as Record<string, unknown>;
  if (data.engineSuite !== undefined && data.engineSuite !== "cstal-windows") {
    return { code: "INVALID_MOVE_NOTATION", path: "body.engineSuite", message: "engineSuite must be cstal-windows" };
  }
  const hasRawGame = typeof data.rawGameBase64 === "string" && data.rawGameBase64.length > 0;
  const hasFen = typeof data.fen === "string" && data.fen.trim().length > 0;
  if (hasRawGame === hasFen) {
    return { code: "INVALID_MOVE_NOTATION", path: "body.input", message: "Provide exactly one of rawGameBase64 or fen" };
  }
  const opponent = data.cstalOpponent ?? "maia3";
  if (opponent !== "maia3" && opponent !== "maia1900") {
    return { code: "INVALID_MOVE_NOTATION", path: "body.cstalOpponent", message: "cstalOpponent must be maia3 or maia1900" };
  }
  const maia3Elo = integerInRange(data.maia3Elo, 1900, 1, 4000);
  const refreshMs = integerInRange(data.refreshMs, 2000, 250, 60_000);
  const maxFullMoves = integerInRange(data.maxFullMoves, 80, 1, 300);
  const timeoutMs = integerInRange(data.timeoutMs, 300_000, 1_000, 3_600_000);
  if (maia3Elo === undefined) return { code: "INVALID_MOVE_NOTATION", path: "body.maia3Elo", message: "maia3Elo must be an integer between 1 and 4000" };
  if (refreshMs === undefined) return { code: "INVALID_MOVE_NOTATION", path: "body.refreshMs", message: "refreshMs must be an integer between 250 and 60000" };
  if (maxFullMoves === undefined) return { code: "INVALID_MOVE_NOTATION", path: "body.maxFullMoves", message: "maxFullMoves must be an integer between 1 and 300" };
  if (timeoutMs === undefined) return { code: "INVALID_MOVE_NOTATION", path: "body.timeoutMs", message: "timeoutMs must be an integer between 1000 and 3600000" };
  const rawGame = hasRawGame ? Buffer.from(data.rawGameBase64 as string, "base64").toString("utf8") : undefined;
  if (hasRawGame && rawGame?.trim().length === 0) return { code: "INVALID_MOVE_NOTATION", path: "body.rawGameBase64", message: "Decoded raw game is empty" };
  return {
    ...(rawGame === undefined ? { fen: (data.fen as string).trim() } : { rawGame }),
    engineSuite: "cstal-windows",
    cstalOpponent: opponent,
    maia3Elo,
    refreshMs,
    maxFullMoves,
    timeoutMs
  };
};

const CSTAL_STYLE_DEPTH = 14;

const numberConfigValue = (value: unknown): number | undefined => (
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
);

const styleDepthForEngine = (engine: LocalStyleEngineProvider): number => (
  numberConfigValue(engine.configuration.styleDepth) ?? INITIAL_ANALYSIS_SETTINGS.styleDepth
);

const transientProviderError = (error: DomainError): boolean => (
  error.code === "PROVIDER_TIMEOUT" || error.code === "PROVIDER_UNAVAILABLE"
);

const lineSnapshot = (
  ingested: IngestedCliInput | undefined,
  engine: LocalStyleEngineProvider,
  state: LineState | undefined
): JobLineSnapshot => {
  const plies = state?.plies ?? [];
  const continuation = plies.map(ply => String(ply.move.san));
  const sanMovetext = ingested === undefined
    ? ""
    : formatSanMovetext([...ingested.baseSanMoves, ...continuation], ingested.lineStartFullmove, ingested.lineStartSide);
  return {
    engineKey: engine.key,
    label: engine.label ?? `${engine.identity.displayName} StylePath`,
    status: state?.status ?? "Incomplete",
    styleDepth: styleDepthForEngine(engine),
    sanMovetext,
    plies: plies.map(ply => ({
      index: Number(ply.index),
      san: String(ply.move.san),
      uci: String(ply.move.uci),
      source: ply.provenance.source,
      provider: ply.provenance.provider.displayName
    })),
    ...(state?.error !== undefined ? { error: state.error } : {})
  };
};

class StyleJobQueue {
  readonly chess: ChessRulesPort;
  private readonly createProviders: NonNullable<StyleServerPorts["createProviders"]>;
  private readonly now: () => Date;
  private readonly makeJobId: () => string;
  private readonly config: ServerConfig;
  private readonly jobs = new Map<string, StyleJob>();

  constructor(config: ServerConfig, ports: StyleServerPorts = {}) {
    this.config = config;
    this.chess = ports.chess ?? createChessJsRulesAdapter();
    this.createProviders = ports.createProviders ?? ((chess, options) => createWindowsCstalStylePathProviders(chess, undefined, {
      opponent: options.opponent,
      maia3Elo: options.maia3Elo
    }));
    this.now = ports.now ?? (() => new Date());
    this.makeJobId = ports.makeJobId ?? (() => randomUUID());
  }

  public create(request: NormalizedJobRequest, cancelExisting = true): StyleJob | DomainError {
    if (cancelExisting) this.cancelUnfinishedJobs();
    const now = this.now();
    const job: StyleJob = {
      id: this.makeJobId(),
      request,
      status: "queued",
      createdAt: now,
      events: [],
      subscribers: new Set(),
      nextEventId: 1,
      snapshot: this.emptySnapshot("", request, now),
      abort: new AbortController(),
      targetHorizonMoves: Math.min(INITIAL_ANALYSIS_SETTINGS.horizonMoves, request.maxFullMoves),
      finalEmitted: false
    };
    job.snapshot = this.emptySnapshot(job.id, request, now);
    this.jobs.set(job.id, job);
    this.emit(job, "queued");
    void this.run(job);
    return job;
  }

  public awaitCompletion(job: StyleJob): Promise<JobSnapshot> {
    if (job.finalEmitted) return Promise.resolve(job.snapshot);
    return new Promise(resolve => {
      const timer = setInterval(() => {
        if (!job.finalEmitted) return;
        clearInterval(timer);
        resolve(job.snapshot);
      }, 50);
    });
  }

  public get(jobId: string): StyleJob | undefined {
    return this.jobs.get(jobId);
  }

  public cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job === undefined || job.finalEmitted) {
      return false;
    }
    this.cancelJob(job);
    return true;
  }

  public subscribe(job: StyleJob, response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no"
    });
    job.subscribers.add(response);
    job.events.forEach(event => this.writeEvent(response, event));
    if (job.finalEmitted) {
      response.end();
      job.subscribers.delete(response);
      return;
    }
    response.on("close", () => {
      job.subscribers.delete(response);
    });
  }

  private cancelUnfinishedJobs(): void {
    this.jobs.forEach(job => {
      if (!job.finalEmitted) {
        this.cancelJob(job);
      }
    });
  }

  private cancelJob(job: StyleJob): void {
    job.abort.abort();
    this.disposeProviders(job);
    job.status = "cancelled";
    job.completedAt = this.now();
    this.emit(job, "cancelled", true);
  }

  private disposeProviders(job: StyleJob): void {
    job.providers?.maia.dispose?.();
    job.providers?.styleEngines.forEach(engine => {
      engine.provideMove.dispose?.();
      engine.opponent?.dispose?.();
    });
  }

  private emptySnapshot(jobId: string, request: NormalizedJobRequest, now: Date): JobSnapshot {
    return {
      jobId,
      status: "queued",
      createdAt: now.toISOString(),
      settings: {
        horizonMoves: Math.min(INITIAL_ANALYSIS_SETTINGS.horizonMoves, request.maxFullMoves),
        styleDepth: CSTAL_STYLE_DEPTH,
        maxFullMoves: request.maxFullMoves,
        refreshMs: request.refreshMs,
        timeoutMs: request.timeoutMs,
        cstalOpponent: request.cstalOpponent,
        maia3Elo: request.maia3Elo
      },
      lines: []
    };
  }

  private buildSnapshot(job: StyleJob, states = new Map<string, LineState>()): JobSnapshot {
    const engines = job.providers?.styleEngines ?? [];
    return {
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      ...(job.startedAt !== undefined ? { startedAt: job.startedAt.toISOString() } : {}),
      ...(job.completedAt !== undefined ? { completedAt: job.completedAt.toISOString() } : {}),
      settings: {
        horizonMoves: job.targetHorizonMoves,
        styleDepth: CSTAL_STYLE_DEPTH,
        maxFullMoves: job.request.maxFullMoves,
        refreshMs: job.request.refreshMs,
        timeoutMs: job.request.timeoutMs,
        cstalOpponent: job.request.cstalOpponent,
        maia3Elo: job.request.maia3Elo
      },
      ...(job.ingested !== undefined ? {
        input: {
          fen: String(job.ingested.position.fen),
          sideToMove: job.ingested.position.sideToMove
        }
      } : {}),
      lines: engines.map(engine => lineSnapshot(job.ingested, engine, states.get(engine.key))),
      ...(job.error !== undefined ? { error: job.error } : {})
    };
  }

  private emit(job: StyleJob, type: JobEventType, final = false): void {
    job.snapshot = this.buildSnapshot(job);
    const event: JobEvent = {
      id: job.nextEventId,
      type,
      at: this.now().toISOString(),
      data: job.snapshot
    };
    job.nextEventId += 1;
    job.events.push(event);
    job.subscribers.forEach(response => this.writeEvent(response, event));
    if (final) {
      job.finalEmitted = true;
      job.subscribers.forEach(response => response.end());
      job.subscribers.clear();
    }
  }

  private emitWithStates(job: StyleJob, type: JobEventType, states: Map<string, LineState>, final = false): void {
    job.snapshot = this.buildSnapshot(job, states);
    const event: JobEvent = {
      id: job.nextEventId,
      type,
      at: this.now().toISOString(),
      data: job.snapshot
    };
    job.nextEventId += 1;
    job.events.push(event);
    job.subscribers.forEach(response => this.writeEvent(response, event));
    if (final) {
      job.finalEmitted = true;
      job.subscribers.forEach(response => response.end());
      job.subscribers.clear();
    }
  }

  private writeEvent(response: ServerResponse, event: JobEvent): void {
    response.write(`id: ${event.id}\n`);
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }

  private async run(job: StyleJob): Promise<void> {
    if (job.abort.signal.aborted) {
      return;
    }
    job.status = "running";
    job.startedAt = this.now();
    const providers = this.createProviders(this.chess, {
      opponent: job.request.cstalOpponent,
      maia3Elo: job.request.maia3Elo
    });
    job.providers = providers;
    const inputOptions: CliOptions = {
      input: job.request.fen === undefined ? { tag: "RawFile", path: "__style_server_raw_game__.pgn" } : { tag: "Fen", value: job.request.fen },
      watchMode: false,
      refreshMs: job.request.refreshMs,
      engineSuite: "cstal-windows",
      botEngine: "tal",
      cstalOpponent: job.request.cstalOpponent,
      maia3Elo: job.request.maia3Elo
    };
    const ingestedResult = ingestInput(inputOptions, {
      chess: this.chess,
      readTextFile: () => job.request.rawGame ?? ""
    });
    if (isErr(ingestedResult)) {
      job.status = "error";
      job.error = ingestedResult.error;
      job.completedAt = this.now();
      this.emit(job, "error", true);
      return;
    }
    job.ingested = ingestedResult.value;
    const states = new Map<string, LineState>();
    providers.styleEngines.forEach(engine => {
      states.set(engine.key, {
        currentPosition: ingestedResult.value.position,
        plies: [],
        status: "Incomplete"
      });
    });
    this.emitWithStates(job, "started", states);
    this.emitWithStates(job, "progress", states);

    let lastProgressAt = 0;
    const progress = (force = false): void => {
      const nowMs = Date.now();
      if (force || nowMs - lastProgressAt >= job.request.refreshMs) {
        lastProgressAt = nowMs;
        this.emitWithStates(job, "progress", states);
      }
    };
    const timeout = setTimeout(() => {
      if (job.finalEmitted) {
        return;
      }
      job.abort.abort();
      job.status = "error";
      job.error = { code: "PROVIDER_TIMEOUT", path: "job.timeoutMs", message: "StylePath job timed out", details: { timeoutMs: job.request.timeoutMs } };
      job.completedAt = this.now();
      this.emitWithStates(job, "error", states, true);
    }, job.request.timeoutMs);

    const runEngine = async (engine: LocalStyleEngineProvider): Promise<void> => {
      const state = states.get(engine.key);
      if (state === undefined) {
        return;
      }
      while (!job.abort.signal.aborted && !job.finalEmitted) {
        if (state.error !== undefined && !transientProviderError(state.error)) {
          await sleep(50);
          continue;
        }
        if (state.status === "Terminal") {
          await sleep(50);
          continue;
        }
        if (state.plies.length >= job.targetHorizonMoves * 2) {
          if (state.status !== "Complete") {
            state.status = "Complete";
            progress(true);
          }
          await sleep(50);
          continue;
        }
        if (state.status === "Complete") {
          state.status = "Incomplete";
          progress(true);
        }
        const factsResult = this.chess.computeFacts(state.currentPosition);
        if (isErr(factsResult)) {
          state.error = factsResult.error;
          progress(true);
          return;
        }
        if (factsResult.value.isTerminal) {
          state.status = "Terminal";
          progress(true);
          return;
        }
        const plyNumber = state.plies.length + 1;
        const isStylePly = plyNumber % 2 === 1;
        const expectedSource: MoveSource = isStylePly ? "LOCAL_STYLE_ENGINE" : "MAIA";
        const provider: MoveProvider = isStylePly ? engine.provideMove : engine.opponent ?? providers.maia;
        const provided = await provider({
          position: state.currentPosition,
          lineId: `style-${ingestedResult.value.position.hash}-${engine.key}`,
          ply: plyNumber,
          ...(isStylePly ? { searchLimit: { tag: "Depth" as const, depth: styleDepthForEngine(engine) } } : {})
        });
        if (job.abort.signal.aborted || job.finalEmitted) {
          return;
        }
        if (isErr(provided)) {
          state.error = provided.error;
          progress(true);
          if (!transientProviderError(provided.error)) {
            return;
          }
          await sleep(2_000);
          continue;
        }
        if (provided.value.provenance.source !== expectedSource) {
          state.error = {
            code: "SOURCE_SEQUENCE_VIOLATION",
            path: `scenario.plies.${plyNumber}.provenance.source`,
            message: "Provider returned a move with an unexpected source",
            details: { expected: expectedSource, actual: provided.value.provenance.source }
          };
          progress(true);
          return;
        }
        const legal = this.chess.parseLegalMove(state.currentPosition, provided.value.move.uci);
        if (isErr(legal)) {
          state.error = legal.error;
          progress(true);
          return;
        }
        const next = this.chess.applyMove(state.currentPosition, legal.value);
        if (isErr(next)) {
          state.error = next.error;
          progress(true);
          return;
        }
        delete state.error;
        state.plies.push({
          tag: "ScenarioPly",
          index: makePlyIndex(plyNumber),
          move: legal.value,
          provenance: provided.value.provenance
        });
        state.currentPosition = next.value;
        progress();
      }
    };

    const engineRuns = providers.styleEngines.map(engine => runEngine(engine));
    try {
      while (!job.abort.signal.aborted && !job.finalEmitted) {
        const values = [...states.values()];
        const nonTransientError = values.find(state => state.error !== undefined && !transientProviderError(state.error));
        if (nonTransientError?.error !== undefined) {
          job.status = "error";
          job.error = nonTransientError.error;
          job.completedAt = this.now();
          this.emitWithStates(job, "error", states, true);
          break;
        }
        const allSettledAtHorizon = values.every(state => state.status === "Terminal" || state.status === "Complete");
        const allTerminal = values.length > 0 && values.every(state => state.status === "Terminal");
        if (allTerminal || (allSettledAtHorizon && job.targetHorizonMoves >= job.request.maxFullMoves)) {
          job.status = "complete";
          job.completedAt = this.now();
          this.emitWithStates(job, "complete", states, true);
          break;
        }
        if (allSettledAtHorizon && job.targetHorizonMoves < job.request.maxFullMoves) {
          job.targetHorizonMoves = Math.min(job.request.maxFullMoves, job.targetHorizonMoves + 2);
          progress(true);
        }
        await sleep(50);
      }
      await Promise.race([Promise.all(engineRuns), sleep(0)]);
    } finally {
      clearTimeout(timeout);
      this.disposeProviders(job);
      if (job.abort.signal.aborted && !job.finalEmitted) {
        job.status = "cancelled";
        job.completedAt = this.now();
        this.emitWithStates(job, "cancelled", states, true);
      }
    }
  }
}

const sleep = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));

export const createStyleLineJobServer = (
  configOverrides: Partial<ServerConfig> = {},
  ports: StyleServerPorts = {}
): Server => {
  const config = { ...defaultConfig(), ...configOverrides };
  const queue = new StyleJobQueue(config, ports);
  const patternCache = createInMemoryAnalysisCache();
  const resolvedPorts: StyleServerPorts = {
    ...ports,
    createPatternSteering: ports.createPatternSteering ?? ((chess, options) => {
      const paths = loadLocalEnginePaths();
      const providers = createWindowsCstalStylePathProviders(chess, paths, options);
      const patricia = paths.patriciaPath === undefined ? undefined : createPatriciaCandidateGenerator(chess, paths, 8);
      const generator = createWindowsCstalPatternCandidateGenerator(chess, paths, options, 8, patricia);
      const tacticalGate = createWindowsCstalTacticalGate(chess, paths, options);
      return {
        generator,
        tacticalGate,
        maia: providers.maia,
        dispose: () => {
          generator.dispose?.();
          tacticalGate.dispose?.();
          providers.styleEngines.forEach(engine => engine.provideMove.dispose?.());
          providers.maia.dispose?.();
        }
      };
    })
  };
  const batches = new Map<string, PatternBatch>();

  const batchSnapshot = (batch: PatternBatch): Readonly<Record<string, unknown>> => ({
    batchId: batch.id,
    status: batch.status,
    datasetVersion: batch.datasetVersion,
    createdAt: batch.createdAt,
    total: batch.total,
    completed: batch.completed,
    results: batch.results
  });
  const emitBatch = (batch: PatternBatch, type: "started" | "progress" | "complete"): void => {
    const event = { type, data: batchSnapshot(batch) } as const;
    batch.events.push(event);
    batch.subscribers.forEach(response => {
      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event.data)}\n\n`);
    });
    if (type === "complete") {
      batch.finalEmitted = true;
      batch.subscribers.forEach(response => response.end());
      batch.subscribers.clear();
    }
  };
  const runBatch = async (batch: PatternBatch, request: Readonly<{ cases: readonly PatternBatchCase[]; concurrency: number; common: Omit<PatternBatchRequest, "cases" | "datasetVersion" | "concurrency"> }>): Promise<void> => {
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const item = request.cases[index];
        if (item === undefined) return;
        if (request.common.mode === "steering") {
          const start = queue.chess.ingestPosition(item.fen);
          if (isErr(start)) {
            batch.results.push({ caseId: item.caseId, status: "error", error: start.error });
            batch.completed += 1;
            emitBatch(batch, "progress");
            continue;
          }
          const steering = resolvedPorts.createPatternSteering?.(queue.chess, {
            opponent: request.common.cstalOpponent ?? "maia3",
            maia3Elo: request.common.maia3Elo ?? 1800
          });
          if (steering === undefined) {
            batch.results.push({ caseId: item.caseId, status: "error", error: { code: "PROVIDER_UNAVAILABLE", path: "patternBatch.steering", message: "Pattern steering providers are not configured" } });
            batch.completed += 1;
            emitBatch(batch, "progress");
            continue;
          }
          const horizon = makeScenarioHorizon(Math.max(1, (request.common.maxFullMoves ?? 8) * 2));
          if (isErr(horizon)) {
            steering.dispose?.();
            batch.results.push({ caseId: item.caseId, status: "error", error: horizon.error });
            batch.completed += 1;
            emitBatch(batch, "progress");
            continue;
          }
          let line;
          try {
            line = await Promise.race([
              generatePatternSteeredTalPath({
                chess: queue.chess,
                start: start.value,
                attackerSide: start.value.sideToMove,
                generator: steering.generator,
                tacticalGate: steering.tacticalGate,
                maia: steering.maia,
                lineId: `pattern-steering-${item.caseId}`,
                horizon: horizon.value,
                cache: patternCache,
                maiaCacheIdentity: `${request.common.cstalOpponent ?? "maia3"}:${request.common.maia3Elo ?? 1800}`
              }),
              sleep(request.common.timeoutMs ?? 300_000).then(() => ({ tag: "Err" as const, error: { code: "PROVIDER_TIMEOUT" as const, path: `patternBatch.${item.caseId}`, message: "Pattern steering case timed out" } }))
            ]);
          } finally {
            steering.dispose?.();
          }
          if (line.tag === "Err") {
            batch.results.push({ caseId: item.caseId, status: "error", error: line.error });
          } else {
            batch.results.push({ caseId: item.caseId, status: line.value.status === "Incomplete" ? "error" : "complete", steeringLine: line.value, ...(line.value.error === undefined ? {} : { error: line.value.error }) });
          }
          batch.completed += 1;
          emitBatch(batch, "progress");
          continue;
        }
        const normalized = normalizeJobRequest({ ...request.common, fen: item.fen });
        if ("code" in normalized) {
          batch.results.push({ caseId: item.caseId, status: "error", error: normalized });
          batch.completed += 1;
          emitBatch(batch, "progress");
          continue;
        }
        const job = queue.create(normalized, false);
        if ("code" in job) {
          batch.results.push({ caseId: item.caseId, status: "error", error: job });
          batch.completed += 1;
          emitBatch(batch, "progress");
          continue;
        }
        const snapshot = await queue.awaitCompletion(job);
        batch.results.push({ caseId: item.caseId, status: snapshot.status, snapshot, ...(snapshot.error === undefined ? {} : { error: snapshot.error }) });
        batch.completed += 1;
        emitBatch(batch, "progress");
      }
    };
    await Promise.all(Array.from({ length: Math.min(request.concurrency, request.cases.length) }, () => worker()));
    batch.status = batch.results.some(result => result.status !== "complete") ? "incomplete" : "complete";
    emitBatch(batch, "complete");
  };

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") {
      jsonResponse(response, 200, { ok: true });
      return;
    }
    if (config.token.length === 0 || request.headers.authorization !== `Bearer ${config.token}`) {
      jsonResponse(response, 401, { error: "Unauthorized" });
      return;
    }
    if (config.allowedCountries.length > 0) {
      const country = headerValue(request.headers["cf-ipcountry"])?.toUpperCase();
      if (country === undefined || !config.allowedCountries.includes(country)) {
        jsonResponse(response, 403, { error: "Country not allowed" });
        return;
      }
    }

    try {
      if (request.method === "POST" && url.pathname === "/v1/pattern-experiments/batches") {
        const body = await readJsonBody(request);
        const normalized = normalizePatternBatchRequest(body);
        if (normalized.tag === "Err") {
          jsonResponse(response, 400, { error: normalized.error });
          return;
        }
        const batch: PatternBatch = {
          id: randomUUID(),
          status: "running",
          datasetVersion: normalized.value.datasetVersion,
          createdAt: new Date().toISOString(),
          total: normalized.value.cases.length,
          completed: 0,
          results: [],
          subscribers: new Set(),
          events: [],
          finalEmitted: false
        };
        batches.set(batch.id, batch);
        emitBatch(batch, "started");
        void runBatch(batch, normalized.value);
        jsonResponse(response, 202, { batchId: batch.id, status: batch.status, total: batch.total });
        return;
      }

      const batchMatch = /^\/v1\/pattern-experiments\/batches\/([^/]+)(?:\/events)?$/.exec(url.pathname);
      if (batchMatch !== null) {
        const batch = batches.get(decodeURIComponent(batchMatch[1] as string));
        if (batch === undefined) {
          jsonResponse(response, 404, { error: "Batch not found" });
          return;
        }
        if (request.method === "GET" && url.pathname.endsWith("/events")) {
          response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
          batch.events.forEach(event => {
            response.write(`event: ${event.type}\n`);
            response.write(`data: ${JSON.stringify(event.data)}\n\n`);
          });
          if (batch.finalEmitted) response.end();
          else {
            batch.subscribers.add(response);
            response.on("close", () => batch.subscribers.delete(response));
          }
          return;
        }
        if (request.method === "GET") {
          jsonResponse(response, 200, batchSnapshot(batch));
          return;
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/style-lines/jobs") {
        const body = await readJsonBody(request);
        const normalized = normalizeJobRequest(body);
        if ("code" in normalized) {
          jsonResponse(response, 400, { error: normalized });
          return;
        }
        const job = queue.create(normalized);
        if ("code" in job) {
          jsonResponse(response, 429, { error: job });
          return;
        }
        jsonResponse(response, 202, { jobId: job.id, status: job.status });
        return;
      }

      const jobMatch = /^\/v1\/style-lines\/jobs\/([^/]+)(?:\/events)?$/.exec(url.pathname);
      if (jobMatch !== null) {
        const job = queue.get(decodeURIComponent(jobMatch[1] as string));
        if (job === undefined) {
          jsonResponse(response, 404, { error: "Job not found" });
          return;
        }
        if (request.method === "GET" && url.pathname.endsWith("/events")) {
          queue.subscribe(job, response);
          return;
        }
        if (request.method === "GET") {
          jsonResponse(response, 200, job.snapshot);
          return;
        }
        if (request.method === "DELETE") {
          const cancelled = queue.cancel(job.id);
          jsonResponse(response, cancelled ? 202 : 409, { jobId: job.id, status: job.status });
          return;
        }
      }

      textResponse(response, 404, "Not found\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      jsonResponse(response, message === "REQUEST_BODY_TOO_LARGE" ? 413 : 400, { error: message });
    }
  });
};

const normalizePatternBatchRequest = (body: unknown): Result<Readonly<{
  datasetVersion: string;
  cases: readonly PatternBatchCase[];
  concurrency: number;
  common: Omit<PatternBatchRequest, "cases" | "datasetVersion" | "concurrency">;
}>, DomainError> => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { tag: "Err", error: { code: "INVALID_MOVE_NOTATION", path: "body", message: "Batch body must be an object" } };
  const data = body as Record<string, unknown>;
  if (!Array.isArray(data.cases) || data.cases.length === 0 || data.cases.length > 500) return { tag: "Err", error: { code: "INVALID_MOVE_NOTATION", path: "body.cases", message: "cases must contain between 1 and 500 items" } };
  const cases: PatternBatchCase[] = [];
  for (const [index, value] of data.cases.entries()) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { tag: "Err", error: { code: "INVALID_MOVE_NOTATION", path: `body.cases.${index}`, message: "case must be an object" } };
    const item = value as Record<string, unknown>;
    if (typeof item.caseId !== "string" || item.caseId.length === 0 || typeof item.fen !== "string" || item.fen.trim().length === 0) return { tag: "Err", error: { code: "INVALID_MOVE_NOTATION", path: `body.cases.${index}`, message: "caseId and fen are required" } };
    cases.push({ caseId: item.caseId, fen: item.fen.trim() });
  }
  const concurrency = integerInRange(data.concurrency, 2, 1, 4);
  if (concurrency === undefined) return { tag: "Err", error: { code: "INVALID_MOVE_NOTATION", path: "body.concurrency", message: "concurrency must be an integer between 1 and 4" } };
  const common: Omit<PatternBatchRequest, "cases" | "datasetVersion" | "concurrency"> = {
    ...(data.mode === undefined ? {} : { mode: data.mode as "posthoc" | "steering" }),
    ...(data.cstalOpponent === undefined ? {} : { cstalOpponent: data.cstalOpponent as WindowsCstalOpponent }),
    ...(data.maia3Elo === undefined ? {} : { maia3Elo: data.maia3Elo as number }),
    ...(data.refreshMs === undefined ? {} : { refreshMs: data.refreshMs as number }),
    ...(data.maxFullMoves === undefined ? {} : { maxFullMoves: data.maxFullMoves as number }),
    ...(data.timeoutMs === undefined ? {} : { timeoutMs: data.timeoutMs as number })
  };
  if (data.mode !== undefined && data.mode !== "posthoc" && data.mode !== "steering") return { tag: "Err", error: { code: "INVALID_RAW_GAME", path: "body.mode", message: "mode must be posthoc or steering" } };
  return { tag: "Ok", value: { datasetVersion: typeof data.datasetVersion === "string" ? data.datasetVersion : "unknown", cases, concurrency, common } };
};

export const startStyleServer = (configOverrides: Partial<ServerConfig> = {}): Server => {
  const config = { ...defaultConfig(), ...configOverrides };
  if (config.token.length === 0) {
    throw new Error("STYLE_SERVER_TOKEN is required");
  }
  const server = createStyleLineJobServer(config);
  let recoveredPort = false;
  let retryScheduled = false;
  let listening = false;
  const listen = (): void => {
    if (listening || retryScheduled) return;
    server.listen(config.port, config.host, () => {
      if (listening) return;
      listening = true;
      process.stdout.write(`StylePath server listening on http://${config.host}:${config.port}\n`);
      const readyFile = process.env.STYLE_SERVER_READY_FILE?.trim();
      if (readyFile !== undefined && readyFile.length > 0) {
        writeFileSync(readyFile, `${process.pid}\n`, "utf8");
      }
    });
  };
  server.on("error", error => {
    const serverError = error as NodeJS.ErrnoException;
    if (serverError.code !== "EADDRINUSE" || recoveredPort || retryScheduled || process.platform !== "win32") {
      throw error;
    }
    recoveredPort = true;
    const stoppedPids = stopWindowsPortOwners(config.port);
    if (stoppedPids.length === 0) throw error;
    retryScheduled = true;
    listening = false;
    process.stdout.write(`Port ${config.port} was busy; stopped PID(s) ${stoppedPids.join(", ")} and restarting\n`);
    server.close(() => setTimeout(() => {
      retryScheduled = false;
      listen();
    }, 250));
  });
  listen();
  return server;
};

if (process.argv[1] !== undefined && basename(process.argv[1]) === "style-server.ts") {
  startStyleServer();
}
