import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ForcedMateProofProvider } from "../../application/ports/forced-mate";
import type { UciOption } from "./uci-engine-adapter";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";
import type { ForcedMateProof } from "../../application/ports/forced-mate";

export type UciForcedMateProofConfig = Readonly<{
  key: string;
  command: string;
  args?: readonly string[];
  options?: readonly UciOption[];
  mateMoves: number;
  timeoutMs: number;
}>;

export const parseUciMateScore = (line: string): number | undefined => {
  const match = /(?:^|\s)score\s+mate\s+(-?\d+)(?:\s|$)/u.exec(line.trim());
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

const positionCommand = (fen: string, base: "startpos" | "fen", moves: readonly string[]): string => (
  base === "startpos"
    ? `position startpos${moves.length === 0 ? "" : ` moves ${moves.join(" ")}`}`
    : `position fen ${fen}${moves.length === 0 ? "" : ` moves ${moves.join(" ")}`}`
);

export const createUciForcedMateProofProvider = (config: UciForcedMateProofConfig): ForcedMateProofProvider => async request => {
  const child = spawn(config.command, config.args ?? [], { stdio: "pipe" });
  const rl = createInterface({ input: child.stdout });
  let settled = false;
  let mateScore: number | undefined;
  let stage: "uci" | "ready" | "search" = "uci";
  let output = "";

  return await new Promise(resolve => {
    const finish = (result: Result<ForcedMateProof, DomainError>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      try {
        if (child.stdin.writable) child.stdin.write("quit\n");
      } catch {
        // Cleanup is best effort after a terminal provider result.
      }
      if (!child.killed) child.kill("SIGTERM");
      resolve(result);
    };
    const timer = setTimeout(() => finish(err(domainError("PROVIDER_TIMEOUT", `providers.${config.key}`, "UCI forced-mate proof timed out", { output: output.slice(-1000) }))), config.timeoutMs);
    const write = (line: string): void => {
      if (!settled && child.stdin.writable) child.stdin.write(`${line}\n`);
    };

    child.stdin.on("error", error => finish(err(domainError("PROVIDER_UNAVAILABLE", `providers.${config.key}`, "UCI forced-mate provider stdin failed", { cause: error.message }))));
    child.once("error", error => finish(err(domainError("PROVIDER_UNAVAILABLE", `providers.${config.key}`, "UCI forced-mate provider failed to start", { cause: error.message }))));
    child.once("exit", code => {
      if (!settled) finish(err(domainError("PROVIDER_UNAVAILABLE", `providers.${config.key}`, "UCI forced-mate provider exited before proof", { code, output: output.slice(-1000) })));
    });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    rl.on("line", line => {
      output += `${line}\n`;
      if (stage === "uci" && line.trim() === "uciok") {
        config.options?.forEach(option => write(`setoption name ${option.name} value ${String(option.value)}`));
        stage = "ready";
        write("isready");
        return;
      }
      if (stage === "ready" && line.trim() === "readyok") {
        stage = "search";
        write("ucinewgame");
        write(positionCommand(String(request.start.fen), request.start.uciPosition.base, request.start.uciPosition.moves.map(String)));
        write(`go mate ${config.mateMoves}`);
        return;
      }
      const score = parseUciMateScore(line);
      if (stage === "search" && score !== undefined) mateScore = score;
      if (stage === "search" && line.startsWith("bestmove ")) {
        const verified = mateScore !== undefined && mateScore > 0;
        finish(ok({
          status: verified ? "VERIFIED" : "NOT_VERIFIED",
          provider: config.key,
          limits: { protocol: "uci", command: config.command, mateMoves: config.mateMoves, timeoutMs: config.timeoutMs, reportedMateScore: mateScore ?? null },
          terminalPositionHash: String(request.terminalPosition.hash)
        }));
      }
    });
    write("uci");
  });
};
