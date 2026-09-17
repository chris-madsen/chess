import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { ChessRulesPort } from "../../application/ports/chess-rules";
import type { MoveProvider, ProvidedMove, ProviderRequest, ProviderSearchLimit } from "../../application/ports/providers";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { MoveSource, ProviderIdentity } from "../../domain/provenance/provenance";
import { makeRequestId } from "../../domain/chess/value-objects";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, isErr, ok, type Result } from "../../domain/shared/result";

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
}>;

type PendingWait = Readonly<{
  predicate: (line: string) => boolean;
  observe?: (line: string) => void;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}>;

const goCommand = (limit: ProviderSearchLimit): string => {
  switch (limit.tag) {
    case "Depth": return `go depth ${limit.depth}`;
    case "MoveTime": return `go movetime ${limit.milliseconds}`;
    case "Nodes": return `go nodes ${limit.nodes}`;
  }
};

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
  private readonly cleanupOnExit = (): void => { this.stop(); };
  private readonly cleanupOnSigint = (): void => { this.stop(); process.exit(130); };
  private readonly cleanupOnSigterm = (): void => { this.stop(); process.exit(143); };
  private pending: PendingWait | null = null;
  private closed = false;

  public constructor(config: UciEngineConfig) {
    this.child = spawn(config.command, config.args ?? [], { stdio: "pipe" });
    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on("line", line => this.onLine(line));
    this.child.stderr.on("data", () => undefined);
    this.child.stdin.on("error", error => this.failPending(error));
    this.child.once("exit", () => this.failPending(new Error("UCI engine exited")));
    this.child.once("error", error => this.failPending(error));
    process.once("exit", this.cleanupOnExit);
    process.once("SIGINT", this.cleanupOnSigint);
    process.once("SIGTERM", this.cleanupOnSigterm);
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
    process.off("exit", this.cleanupOnExit);
    process.off("SIGINT", this.cleanupOnSigint);
    process.off("SIGTERM", this.cleanupOnSigterm);
    try {
      if (!this.child.stdin.destroyed && this.child.stdin.writable) {
        this.child.stdin.write("quit\n");
      }
    } catch {
      // best-effort cleanup
    }
    this.rl.close();
    if (!this.child.killed) {
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
  session.send("uci");
  await session.waitFor(line => line.trim() === "uciok", config.timeoutMs);
  config.options.forEach(option => session.send(optionCommand(option)));
  session.send("isready");
  await session.waitFor(line => line.trim() === "readyok", config.timeoutMs);
  return session;
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
