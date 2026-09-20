#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { fetchRemoteStylePaths, makeRemoteStylePathConfig } from "../adapters/http/remote-style-path-adapter";
import { makeScenarioHorizon } from "../domain/chess/value-objects";
import { isErr } from "../domain/shared/result";

const valueAfter = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};

const positive = (args: readonly string[], flag: string, fallback: number): number => {
  const value = Number(valueAfter(args, flag) ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer`);
  return value;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const rawFile = valueAfter(args, "--raw-file");
  if (rawFile === undefined || !existsSync(rawFile)) throw new Error("--raw-file must point to an existing PGN/raw SAN file");
  const runs = positive(args, "--runs", 10);
  const maia3Elo = positive(args, "--maia3-elo", 1900);
  const horizonMoves = positive(args, "--horizon-full-moves", 34);
  const chess = createChessJsRulesAdapter();
  const rawGame = readFileSync(rawFile, "utf8");
  const start = chess.ingestRawGame(rawGame);
  if (isErr(start)) throw new Error(`${start.error.code}: ${start.error.message}`);
  const horizon = makeScenarioHorizon(horizonMoves * 2);
  if (isErr(horizon)) throw new Error(`${horizon.error.code}: ${horizon.error.message}`);
  for (const threads of [1, 2]) {
    const config = makeRemoteStylePathConfig({ maia3Elo, cstalThreads: threads });
    if (isErr(config)) throw new Error(`${config.error.code}: ${config.error.message}`);
    const roots = new Map<string, string[]>();
    const fullLines = new Map<string, Set<string>>();
    process.stdout.write(`Threads=${threads}\n`);
    for (let run = 1; run <= runs; run += 1) {
      const result = await fetchRemoteStylePaths(chess, start.value, horizon.value, config.value, 14, rawGame);
      if (isErr(result)) throw new Error(`threads=${threads} run=${run}: ${result.error.code}: ${result.error.message}`);
      for (const item of result.value) {
        const moves = item.line.plies.map(ply => String(ply.move.uci));
        const previous = roots.get(item.engineKey);
        if (previous === undefined) roots.set(item.engineKey, moves);
        const signatures = fullLines.get(item.engineKey) ?? new Set<string>();
        signatures.add(moves.join(" "));
        fullLines.set(item.engineKey, signatures);
        process.stdout.write(`  run ${run}/${runs} ${item.engineKey}: root=${moves[0] ?? "none"} plies=${moves.length}\n`);
      }
    }
    for (const [engineKey, first] of roots) {
      const signatures = fullLines.get(engineKey) ?? new Set<string>();
      const rootStable = [...signatures].every(signature => signature.split(" ")[0] === first[0]);
      process.stdout.write(`  summary ${engineKey}: rootStable=${rootStable} uniqueFullLines=${signatures.size}\n`);
    }
  }
};

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
