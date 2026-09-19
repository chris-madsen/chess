import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { ChessRulesPort } from "../../application/ports/chess-rules";
import type { MoveProvider, ProvidedMove, ProviderRequest, ProviderSearchLimit } from "../../application/ports/providers";
import type { CandidateGenerator, CandidateTacticalGate, EngineScore } from "../../application/ports/pattern-steering";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { Side } from "../../domain/chess/value-objects";
import type { MoveSource, ProviderIdentity } from "../../domain/provenance/provenance";
import { makeRequestId } from "../../domain/chess/value-objects";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";
import type { CandidateSeed } from "../../domain/scenario-lines/scenario-line";

export type UciOption = Readonly<{
  name: string;
  value: string | number | boolean;
}>;

export type UciGoLimit = ProviderSearchLimit;


export type UciEngineConfig = Readonly<{
  key: string;
  command: string;
  args?: readonly string[];
  identity: ProviderIdentity;
  source: MoveSource;
  options: readonly UciOption[];
  limit: UciGoLimit;
  timeoutMs: number;
  configuration: Readonly<Record<string, unknown>>;
  allowInfoPvBestMoveFallback?: boolean;
  /** Legacy flag retained for callers; capability is preferred. */
  supportsSearchMoves?: boolean;
  searchMovesCapability?: "VERIFIED" | "UNSUPPORTED" | "UNKNOWN";
  scorePerspective?: "SIDE_TO_MOVE" | "ATTACKER";
}>;

type PendingWait = Readonly<{
  predicate: (line: string) => boolean;
  observe?: (line: string) => void;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}>;

type ManagedUciSession = Readonly<{ stop: () => void }>;

const liveSessions = new Set<ManagedUciSession>();
let processCleanupRegistered = false;

const stopAllLiveSessions = (): void => {
  [...liveSessions].forEach(session => session.stop());
};

const ensureProcessCleanupRegistered = (): void => {
  if (processCleanupRegistered) {
    return;
  }
  processCleanupRegistered = true;
  process.once("exit", stopAllLiveSessions);
  process.once("SIGINT", () => {
    stopAllLiveSessions();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    stopAllLiveSessions();
    process.exit(143);
  });
};

const goCommand = (limit: ProviderSearchLimit): string => {
  switch (limit.tag) {
    case "Depth": return `go depth ${limit.depth}`;
    case "MoveTime": return `go movetime ${limit.milliseconds}`;
    case "Nodes": return `go nodes ${limit.nodes}`;
  }
};

const goSearchMovesCommand = (limit: ProviderSearchLimit, move: string): string => `${goCommand(limit)} searchmoves ${move}`;

const optionCommand = (option: UciOption): string => `setoption name ${option.name} value ${String(option.value)}`;

const positionCommand = (position: PositionSnapshot): string => {
  const moves = position.uciPosition.moves.length > 0
    ? ` moves ${position.uciPosition.moves.map(String).join(" ")}`
    : "";
  return position.uciPosition.base === "startpos"
    ? `position startpos${moves}`
    : `position fen ${String(position.uciPosition.fen)}${moves}`;
};

class UciSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly rl: Interface;
  private pending: PendingWait | null = null;
  private closed = false;

  public constructor(config: UciEngineConfig) {
    this.child = spawn(config.command, config.args ?? [], { stdio: "pipe" });
    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on("line", line => this.onLine(line));
    this.child.stderr.on("data", () => undefined);
    this.child.stdin.on("error", error => this.failPending(error));
    this.child.once("exit", () => {
      this.failPending(new Error("UCI engine exited"));
      this.stop();
    });
    this.child.once("error", error => {
      this.failPending(error);
      this.stop();
    });
    liveSessions.add(this);
    ensureProcessCleanupRegistered();
  }

  public send(command: string): void {
    if (this.closed || this.child.stdin.destroyed || !this.child.stdin.writable) {
      throw new Error("UCI engine stdin is not writable");
    }
    this.child.stdin.write(`${command}\n`);
  }

  public waitFor(
    predicate: (line: string) => boolean,
    timeoutMs: number,
    observe?: (line: string) => void
  ): Promise<string> {
    if (this.pending !== null) {
      return Promise.reject(new Error("Concurrent UCI wait is not supported"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error("UCI timeout"));
      }, timeoutMs);
      this.pending = {
        predicate,
        ...(observe !== undefined ? { observe } : {}),
        resolve,
        reject,
        timer
      };
    });
  }

  public stop(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    liveSessions.delete(this);
    try {
      if (this.child.exitCode === null && !this.child.stdin.destroyed && this.child.stdin.writable) {
        this.child.stdin.write("quit\n");
      }
    } catch {
      // best-effort cleanup
    }
    try {
      this.rl.close();
    } catch {
      // best-effort cleanup
    }
    if (this.child.exitCode === null && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }

  private onLine(line: string): void {
    const current = this.pending;
    if (current === null) {
      return;
    }
    current.observe?.(line);
    if (current.predicate(line)) {
      clearTimeout(current.timer);
      this.pending = null;
      current.resolve(line);
    }
  }

  private failPending(error: Error): void {
    const current = this.pending;
    if (current === null) {
      return;
    }
    clearTimeout(current.timer);
    this.pending = null;
    current.reject(error);
  }
}


const extractBestMove = (bestMoveLine: string, config: UciEngineConfig): Result<string, DomainError> => {
  const match = /^bestmove\s+(\S+)/.exec(bestMoveLine.trim());
  if (match === null || match[1] === undefined || match[1] === "(none)") {
    return err(domainError("PROVIDER_MALFORMED_OUTPUT", `providers.${config.key}.bestmove`, "UCI engine did not return a usable bestmove", {
      engine: config.key,
      line: bestMoveLine
    }));
  }
  return ok(match[1]);
};

const timeoutMsFor = (config: UciEngineConfig, limit: ProviderSearchLimit): number => (
  limit.tag === "Depth" && config.allowInfoPvBestMoveFallback !== true
    ? Math.max(config.timeoutMs, limit.depth * 15_000)
    : config.timeoutMs
);

const firstPvMove = (line: string): string | undefined => {
  const match = /(?:^|\s)pv\s+(\S+)/.exec(line.trim());
  return match?.[1];
};

export const parseUciScore = (line: string): EngineScore | undefined => {
  const match = /(?:^|\s)score\s+(cp|mate)\s+(-?\d+)/.exec(line.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  const bound = /\s(lowerbound|upperbound)(?:\s|$)/u.exec(line.trim())?.[1];
  return { kind: match[1] === "cp" ? "centipawns" : "mate", value: Number(match[2]), bound: bound === "lowerbound" ? "lower" : bound === "upperbound" ? "upper" : "exact" };
};

const pvMoves = (line: string): readonly string[] => {
  const match = /(?:^|\s)pv\s+(.+)$/u.exec(line.trim());
  return match?.[1]?.split(/\s+/u).filter(token => /^[a-h][1-8][a-h][1-8][qrbn]?$/u.test(token)) ?? [];
};

export const parseUciMultiPvRootMove = (line: string): Readonly<{ index: number; move: string }> | undefined => {
  const match = /(?:^|\s)multipv\s+(\d+).*?(?:^|\s)pv\s+(\S+)/.exec(line.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  return { index: Number(match[1]), move: match[2] };
};

const providerFailure = (config: UciEngineConfig, error: unknown): Result<string, DomainError> => {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.includes("timeout") ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE";
  return err(domainError(code, `providers.${config.key}`, "UCI engine request failed", {
    engine: config.key,
    cause: message
  }));
};

const initializeSession = async (config: UciEngineConfig): Promise<UciSession> => {
  const session = new UciSession(config);
  try {
    session.send("uci");
    await session.waitFor(line => line.trim() === "uciok", config.timeoutMs);
    config.options.forEach(option => session.send(optionCommand(option)));
    session.send("isready");
    await session.waitFor(line => line.trim() === "readyok", config.timeoutMs);
    return session;
  } catch (error) {
    session.stop();
    throw error;
  }
};

export const createUciMoveProvider = (
  chess: ChessRulesPort,
  config: UciEngineConfig
): MoveProvider => {
  let sessionPromise: Promise<UciSession> | null = null;
  let queue: Promise<Result<string, DomainError>> = Promise.resolve(ok(""));

  const getSession = async (): Promise<UciSession> => {
    sessionPromise ??= initializeSession(config);
    return sessionPromise;
  };

  const requestBestMove = async (request: ProviderRequest, limit: ProviderSearchLimit): Promise<Result<string, DomainError>> => {
    let lastLegalPvMove: string | undefined;
    try {
      const session = await getSession();
      const timeoutMs = timeoutMsFor(config, limit);
      session.send("isready");
      await session.waitFor(line => line.trim() === "readyok", timeoutMs);
      session.send(positionCommand(request.position));
      session.send(goCommand(limit));
      const bestMoveLine = await session.waitFor(
        line => line.startsWith("bestmove "),
        timeoutMs,
        line => {
          const candidate = firstPvMove(line);
          if (candidate === undefined) {
            return;
          }
          const legalMove = chess.parseLegalMove(request.position, candidate);
          if (!isErr(legalMove)) {
            lastLegalPvMove = candidate;
          }
        }
      );
      return extractBestMove(bestMoveLine, config);
    } catch (error) {
      const failedSession = sessionPromise;
      sessionPromise = null;
      try {
        (await failedSession)?.stop();
      } catch {
        // best-effort cleanup
      }
      const message = error instanceof Error ? error.message : String(error);
      if (config.allowInfoPvBestMoveFallback === true && message.includes("timeout") && lastLegalPvMove !== undefined) {
        return ok(lastLegalPvMove);
      }
      return providerFailure(config, error);
    }
  };

  const dispose = (): void => {
    const currentSession = sessionPromise;
    sessionPromise = null;
    queue = Promise.resolve(ok(""));
    if (currentSession !== null) {
      void currentSession.then(session => session.stop(), () => undefined);
    }
  };

  const provider: MoveProvider = Object.assign(async (request: ProviderRequest): Promise<Result<ProvidedMove, DomainError>> => {
    const limit = request.searchLimit ?? config.limit;
    queue = queue.then(() => requestBestMove(request, limit), () => requestBestMove(request, limit));
    const bestMoveResult = await queue;
    if (isErr(bestMoveResult)) {
      return bestMoveResult;
    }
    const legalMove = chess.parseLegalMove(request.position, bestMoveResult.value);
    if (isErr(legalMove)) {
      return err(domainError("PROVIDER_ILLEGAL_MOVE", `providers.${config.key}.bestmove`, "UCI engine returned an illegal move", {
        engine: config.key,
        move: bestMoveResult.value,
        fen: request.position.fen
      }));
    }
    return ok({
      move: legalMove.value,
      provenance: {
        source: config.source,
        provider: config.identity,
        status: config.source === "MAIA" ? "MODELED_LOCAL" : "ENGINE_GENERATED",
        requestId: makeRequestId(`${config.key}-${request.lineId}-${request.ply}-${Date.now()}`),
        inputPositionHash: request.position.hash,
        configuration: {
          ...config.configuration,
          options: config.options,
          limit,
          session: "persistent-queued"
        },
        observedAtIso: new Date().toISOString()
      }
    });
  }, { dispose });
  return provider;
};

/** Root-candidate adapter for engines that support UCI MultiPV (Patricia).
 * It never treats an engine PV as a line: only the legal first move is emitted.
 */
export const createUciCandidateGenerator = (
  chess: ChessRulesPort,
  config: UciEngineConfig,
  candidateLimit: number
): CandidateGenerator => {
  const boundedLimit = Math.max(1, Math.floor(candidateLimit));
  let sessionPromise: Promise<UciSession> | null = null;
  let queue: Promise<Result<readonly CandidateSeed[], DomainError>> = Promise.resolve(ok([]));
  const getSession = async (): Promise<UciSession> => {
    sessionPromise ??= initializeSession(config);
    return sessionPromise;
  };
  const requestCandidates = async (request: Parameters<CandidateGenerator>[0]): Promise<Result<readonly CandidateSeed[], DomainError>> => {
    const collected = new Map<number, string>();
    try {
      const session = await getSession();
      const timeoutMs = timeoutMsFor(config, config.limit);
      session.send("isready");
      await session.waitFor(line => line.trim() === "readyok", timeoutMs);
      session.send(positionCommand(request.position));
      session.send(goCommand(config.limit));
      const bestMoveLine = await session.waitFor(
        line => line.startsWith("bestmove "),
        timeoutMs,
        line => {
          const candidate = parseUciMultiPvRootMove(line);
          if (candidate !== undefined && candidate.index <= boundedLimit) collected.set(candidate.index, candidate.move);
        }
      );
      const fallback = extractBestMove(bestMoveLine, config);
      if (isErr(fallback) && collected.size === 0) return err(fallback.error);
      if (collected.size === 0 && !isErr(fallback)) collected.set(1, fallback.value);
      const seeds: CandidateSeed[] = [];
      for (const [index, uci] of [...collected.entries()].sort(([a], [b]) => a - b).slice(0, Math.min(request.limit, boundedLimit))) {
        const legal = chess.parseLegalMove(request.position, uci);
        if (isErr(legal)) continue;
        seeds.push({
          tag: "CandidateSeed",
          move: legal.value,
          provenance: {
            source: config.source,
            provider: config.identity,
            status: "ENGINE_GENERATED",
            requestId: makeRequestId(`${config.key}-multipv-${index}-${request.lineId}-${Date.now()}`),
            inputPositionHash: request.position.hash,
            configuration: { ...config.configuration, options: config.options, limit: request.limit, protocol: "uci-multipv-root" },
            observedAtIso: new Date().toISOString()
          }
        });
      }
      return seeds.length === 0 ? err(domainError("PROVIDER_ILLEGAL_MOVE", `providers.${config.key}.multipv`, "UCI engine returned no legal MultiPV root move")) : ok(seeds);
    } catch (error) {
      const failedSession = sessionPromise;
      sessionPromise = null;
      try { (await failedSession)?.stop(); } catch { /* best-effort cleanup */ }
      return providerFailure(config, error) as Result<readonly CandidateSeed[], DomainError>;
    }
  };
  const dispose = (): void => {
    const current = sessionPromise;
    sessionPromise = null;
    queue = Promise.resolve(ok([]));
    if (current !== null) void current.then(session => session.stop(), () => undefined);
  };
  return Object.assign(async (request: Parameters<CandidateGenerator>[0]) => {
    queue = queue.then(() => requestCandidates(request), () => requestCandidates(request));
    return queue;
  }, { dispose });
};

export type UciTacticalGatePolicy = Readonly<{
  minCentipawns?: number;
  allowedLossCentipawns: number;
  preserveMateClass?: boolean;
  searchLimit?: ProviderSearchLimit;
  scorePerspective?: "SIDE_TO_MOVE" | "ATTACKER";
}>;

export const compareEngineScoresForAttacker = (first: EngineScore, second: EngineScore): number => {
  if (first.kind === "mate" && second.kind !== "mate") return first.value > 0 ? 1 : -1;
  if (first.kind !== "mate" && second.kind === "mate") return second.value > 0 ? -1 : 1;
  if (first.kind === "centipawns" && second.kind === "centipawns") return first.value - second.value;
  if (first.value > 0 && second.value > 0) return second.value - first.value;
  if (first.value < 0 && second.value < 0) return second.value - first.value;
  return first.value > second.value ? 1 : first.value < second.value ? -1 : 0;
};

export const normalizeScoreToAttacker = (
  score: EngineScore,
  scorePerspective: "SIDE_TO_MOVE" | "ATTACKER",
  sideToMove: Side,
  attackerSide: Side
): EngineScore => {
  if (scorePerspective === "ATTACKER" || sideToMove === attackerSide) return score;
  return { ...score, value: -score.value };
};

/**
 * ACL for Tal/CSTal candidate safety. Pattern code never parses engine scores;
 * it receives only an accepted/rejected candidate assessment.
 */
export const createUciTacticalGate = (
  chess: ChessRulesPort,
  config: UciEngineConfig,
  policy: UciTacticalGatePolicy = { minCentipawns: -150, allowedLossCentipawns: 100, preserveMateClass: true }
): CandidateTacticalGate => {
  let sessionPromise: Promise<UciSession> | null = null;
  let queue: Promise<Result<readonly import("../../application/ports/pattern-steering").TacticalCandidateAssessment[], DomainError>> = Promise.resolve(ok([]));
  const getSession = async (): Promise<UciSession> => {
    sessionPromise ??= initializeSession(config);
    return sessionPromise;
  };
  const requestGate = async (request: Parameters<CandidateTacticalGate>[0]): Promise<Result<readonly import("../../application/ports/pattern-steering").TacticalCandidateAssessment[], DomainError>> => {
    if (config.supportsSearchMoves !== true) return err(domainError("PROVIDER_UNAVAILABLE", `providers.${config.key}.searchmoves`, "Tactical gate requires documented UCI searchmoves support"));
    const session = await getSession();
    const results: import("../../application/ports/pattern-steering").TacticalCandidateAssessment[] = [];
    try {
      for (const seed of request.candidates) {
        const legal = chess.parseLegalMove(request.position, seed.move.uci);
        if (isErr(legal)) return err(domainError("PROVIDER_ILLEGAL_MOVE", `providers.${config.key}.searchmoves`, "Tactical gate received an illegal candidate", { uci: seed.move.uci }));
        let score: EngineScore | undefined;
        let pv: readonly string[] = [];
        const timeoutMs = timeoutMsFor(config, policy.searchLimit ?? config.limit);
        session.send("isready");
        await session.waitFor(line => line.trim() === "readyok", timeoutMs);
        session.send(positionCommand(request.position));
        session.send(goSearchMovesCommand(policy.searchLimit ?? config.limit, String(seed.move.uci)));
        const bestMoveLine = await session.waitFor(line => line.startsWith("bestmove "), timeoutMs, line => {
          const nextScore = parseUciScore(line);
          if (nextScore !== undefined) score = nextScore;
          const nextPv = pvMoves(line);
          if (nextPv.length > 0) pv = nextPv;
        });
        const bestMove = extractBestMove(bestMoveLine, config);
        if (isErr(bestMove) || bestMove.value !== String(seed.move.uci)) {
          return err(domainError("PROVIDER_MALFORMED_OUTPUT", `providers.${config.key}.searchmoves`, "UCI engine did not honor the requested searchmove", { requested: String(seed.move.uci), returned: isErr(bestMove) ? undefined : bestMove.value }));
        }
        if (pv.length > 0 && pv[0] !== String(seed.move.uci)) {
          return err(domainError("PROVIDER_MALFORMED_OUTPUT", `providers.${config.key}.searchmoves.pv`, "UCI PV root does not match requested searchmove", { requested: String(seed.move.uci), returned: pv[0] }));
        }
        if (score === undefined) {
          results.push({ seed, accepted: false, reason: "TAL_SCORE_UNAVAILABLE" });
          continue;
        }
        if (score.bound !== "exact") {
          results.push({ seed, accepted: false, talScore: score, reason: "TAL_SCORE_BOUND_UNSAFE" });
          continue;
        }
        const accepted = score.kind === "mate" ? score.value > 0 : score.value >= (policy.minCentipawns ?? Number.NEGATIVE_INFINITY);
        const legalPv: import("../../domain/chess/moves").LegalMove[] = [];
        let current = request.position;
        for (const rawMove of pv) {
          const next = chess.parseLegalMove(current, rawMove);
          if (isErr(next)) break;
          legalPv.push(next.value);
          const applied = chess.applyMove(current, next.value);
          if (isErr(applied)) break;
          current = applied.value;
        }
        results.push({ seed, accepted, talScore: score, ...(score.kind === "mate" ? { talMate: score.value } : {}), ...(legalPv.length === 0 ? {} : { talPv: legalPv }), ...(accepted ? {} : { reason: "TAL_TACTICAL_VETO" }) });
      }
      const scored = results.filter(result => result.talScore?.bound === "exact");
      const best = scored.reduce<EngineScore | undefined>((current, result) => {
        const scoreValue = result.talScore;
        if (scoreValue === undefined) return current;
        if (current === undefined) return scoreValue;
        if (scoreValue.kind === "mate" && current.kind !== "mate") return scoreValue;
        if (scoreValue.kind === current.kind && scoreValue.value > current.value) return scoreValue;
        return current;
      }, undefined);
      const relative = results.map(result => {
        const scoreValue = result.talScore;
        if (scoreValue === undefined || best === undefined) return result;
        const mateClassOk = policy.preserveMateClass !== false && best.kind === "mate" ? scoreValue.kind === "mate" && scoreValue.value > 0 : true;
        const lossOk = best.kind === "centipawns" && scoreValue.kind === "centipawns" ? best.value - scoreValue.value <= policy.allowedLossCentipawns : true;
        return { ...result, accepted: result.accepted && mateClassOk && lossOk, ...(result.accepted && (!mateClassOk || !lossOk) ? { reason: "TAL_RELATIVE_SAFETY_VETO" } : {}) };
      });
      if (relative.length > 0 && !relative.some(result => result.accepted)) {
        const exact = relative.filter(result => result.talScore?.bound === "exact");
        const fallback = [...exact].sort((first, second) => (second.talScore?.value ?? Number.NEGATIVE_INFINITY) - (first.talScore?.value ?? Number.NEGATIVE_INFINITY))[0];
        if (fallback !== undefined) return ok(relative.map(result => result.seed.move.uci === fallback.seed.move.uci ? { ...result, accepted: true, reason: "TAL_BEST_CANDIDATE_FALLBACK" } : result));
      }
      return ok(relative);
    } catch (error) {
      const failedSession = sessionPromise;
      sessionPromise = null;
      try { (await failedSession)?.stop(); } catch { /* best-effort cleanup */ }
      return providerFailure(config, error) as Result<readonly import("../../application/ports/pattern-steering").TacticalCandidateAssessment[], DomainError>;
    }
  };
  const dispose = (): void => {
    const current = sessionPromise;
    sessionPromise = null;
    queue = Promise.resolve(ok([]));
    if (current !== null) void current.then(session => session.stop(), () => undefined);
  };
  return Object.assign(async (request: Parameters<CandidateTacticalGate>[0]) => {
    queue = queue.then(() => requestGate(request), () => requestGate(request));
    return queue;
  }, { dispose });
};

/**
 * CSTal 2.07 ACL. CSTal ignores UCI `searchmoves`, so the candidate is
 * applied by the chess rules port first and the engine evaluates the resulting
 * defender-to-move position. Scores are normalized to the attacker's view.
 */
export const createUciPostMoveTacticalGate = (
  chess: ChessRulesPort,
  config: UciEngineConfig,
  policy: UciTacticalGatePolicy = { minCentipawns: -150, allowedLossCentipawns: 100, preserveMateClass: true }
): CandidateTacticalGate => {
  let sessionPromise: Promise<UciSession> | null = null;
  let queue: Promise<Result<readonly import("../../application/ports/pattern-steering").TacticalCandidateAssessment[], DomainError>> = Promise.resolve(ok([]));
  const getSession = async (): Promise<UciSession> => {
    sessionPromise ??= initializeSession(config);
    return sessionPromise;
  };
  const requestGate = async (request: Parameters<CandidateTacticalGate>[0]): Promise<Result<readonly import("../../application/ports/pattern-steering").TacticalCandidateAssessment[], DomainError>> => {
    const session = await getSession();
    const results: import("../../application/ports/pattern-steering").TacticalCandidateAssessment[] = [];
    try {
      for (const seed of request.candidates) {
        const legal = chess.parseLegalMove(request.position, seed.move.uci);
        if (isErr(legal)) return err(domainError("PROVIDER_ILLEGAL_MOVE", `providers.${config.key}.postMove`, "Tactical gate received an illegal candidate", { uci: seed.move.uci }));
        const after = chess.applyMove(request.position, legal.value);
        if (isErr(after)) return err(after.error);
        const afterFacts = chess.computeFacts(after.value);
        if (isErr(afterFacts)) return err(afterFacts.error);
        let score: EngineScore | undefined;
        let pv: readonly string[] = [];
        if (afterFacts.value.isCheckmate) {
          score = { kind: "mate", value: after.value.sideToMove === request.attackerSide ? -1 : 1, bound: "exact" };
        } else if (afterFacts.value.isTerminal) {
          score = { kind: "centipawns", value: 0, bound: "exact" };
        } else {
          const limit = policy.searchLimit ?? config.limit;
          const timeoutMs = timeoutMsFor(config, limit);
          session.send("isready");
          await session.waitFor(line => line.trim() === "readyok", timeoutMs);
          session.send(positionCommand(after.value));
          session.send(goCommand(limit));
          await session.waitFor(line => line.startsWith("bestmove "), timeoutMs, line => {
            const nextScore = parseUciScore(line);
            if (nextScore !== undefined) score = nextScore;
            const nextPv = pvMoves(line);
            if (nextPv.length > 0) pv = nextPv;
          });
          if (score !== undefined) {
            score = normalizeScoreToAttacker(score, policy.scorePerspective ?? config.scorePerspective ?? "SIDE_TO_MOVE", after.value.sideToMove, request.attackerSide);
          }
        }
        if (score === undefined) {
          results.push({ seed, accepted: false, reason: "TAL_SCORE_UNAVAILABLE" });
          continue;
        }
        const accepted = score.bound === "exact" && (score.kind === "mate" ? score.value > 0 : score.value >= (policy.minCentipawns ?? Number.NEGATIVE_INFINITY));
        const legalPv: import("../../domain/chess/moves").LegalMove[] = [];
        let current = after.value;
        for (const rawMove of pv) {
          const next = chess.parseLegalMove(current, rawMove);
          if (isErr(next)) break;
          legalPv.push(next.value);
          const applied = chess.applyMove(current, next.value);
          if (isErr(applied)) break;
          current = applied.value;
        }
        results.push({ seed, accepted, talScore: score, ...(score.kind === "mate" ? { talMate: score.value } : {}), ...(legalPv.length === 0 ? {} : { talPv: legalPv }), ...(accepted ? {} : { reason: score.bound !== "exact" ? "TAL_SCORE_BOUND_UNSAFE" : "TAL_TACTICAL_VETO" }) });
      }
      const scored = results.filter(result => result.talScore?.bound === "exact" && result.talScore !== undefined);
      const best = scored.reduce<EngineScore | undefined>((current, result) => {
        const score = result.talScore;
        return score !== undefined && (current === undefined || compareEngineScoresForAttacker(score, current) > 0) ? score : current;
      }, undefined);
      const relative = results.map(result => {
        const score = result.talScore;
        if (score === undefined || best === undefined || score.bound !== "exact") return result;
        const mateClassOk = policy.preserveMateClass !== false && best.kind === "mate" ? score.kind === "mate" && score.value > 0 : true;
        const lossOk = best.kind === "centipawns" && score.kind === "centipawns" ? best.value - score.value <= policy.allowedLossCentipawns : true;
        return { ...result, accepted: result.accepted && mateClassOk && lossOk, ...(result.accepted && (!mateClassOk || !lossOk) ? { reason: "TAL_RELATIVE_SAFETY_VETO" } : {}) };
      });
      if (relative.length > 0 && !relative.some(result => result.accepted)) {
        const exact = relative.filter(result => result.talScore?.bound === "exact");
        const fallback = [...exact].sort((first, second) => compareEngineScoresForAttacker(second.talScore!, first.talScore!))[0];
        if (fallback !== undefined) return ok(relative.map(result => result.seed.move.uci === fallback.seed.move.uci ? { ...result, accepted: true, reason: "TAL_BEST_CANDIDATE_FALLBACK" } : result));
      }
      return ok(relative);
    } catch (error) {
      const failedSession = sessionPromise;
      sessionPromise = null;
      try { (await failedSession)?.stop(); } catch { /* best-effort cleanup */ }
      return providerFailure(config, error) as Result<readonly import("../../application/ports/pattern-steering").TacticalCandidateAssessment[], DomainError>;
    }
  };
  const dispose = (): void => {
    const current = sessionPromise;
    sessionPromise = null;
    queue = Promise.resolve(ok([]));
    if (current !== null) void current.then(session => session.stop(), () => undefined);
  };
  return Object.assign(async (request: Parameters<CandidateTacticalGate>[0]) => {
    queue = queue.then(() => requestGate(request), () => requestGate(request));
    return queue;
  }, { dispose });
};
