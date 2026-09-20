#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { fetchRemoteStylePaths, makeRemoteStylePathConfig } from "../adapters/http/remote-style-path-adapter";
import { isErr } from "../domain/shared/result";
import { makeScenarioHorizon } from "../domain/chess/value-objects";
import { windowsCstalRuntimeConfig } from "../wiring/local-style-engines";

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
  const horizonPlies = positive(args, "--horizon-plies", 68);
  const chess = createChessJsRulesAdapter();
  const rawGame = readFileSync(rawFile, "utf8");
  const start = chess.ingestRawGame(rawGame);
  if (isErr(start)) throw new Error(`${start.error.code}: ${start.error.message}`);
  const horizon = makeScenarioHorizon(horizonPlies);
  if (isErr(horizon)) throw new Error(`${horizon.error.code}: ${horizon.error.message}`);
  const config = makeRemoteStylePathConfig({ maia3Elo });
  if (isErr(config)) throw new Error(`${config.error.code}: ${config.error.message}`);
  const runtime = windowsCstalRuntimeConfig();
  process.stdout.write(`Windows backend: ${config.value.baseUrl}\nCSTal depth ${runtime.styleDepth}, threads ${runtime.cstalThreads}\nMaia3 Elo ${maia3Elo}\n`);

  let exactMatches = 0;
  let rootMatches = 0;
  for (let run = 1; run <= runs; run += 1) {
    const plain = await fetchRemoteStylePaths(chess, start.value, horizon.value, config.value, runtime.styleDepth, rawGame);
    const patternBaseline = await fetchRemoteStylePaths(chess, start.value, horizon.value, config.value, runtime.styleDepth, rawGame);
    if (isErr(plain)) throw new Error(`plain run ${run}: ${plain.error.code}: ${plain.error.message}`);
    if (isErr(patternBaseline)) throw new Error(`pattern baseline run ${run}: ${patternBaseline.error.code}: ${patternBaseline.error.message}`);
    const patternByKey = new Map(patternBaseline.value.map(item => [item.engineKey, item]));
    let exact = true;
    let root = true;
    for (const first of plain.value) {
      const second = patternByKey.get(first.engineKey);
      const firstMoves = first.line.plies.map(ply => String(ply.move.uci));
      const secondMoves = second?.line.plies.map(ply => String(ply.move.uci)) ?? [];
      const sameRoot = firstMoves[0] === secondMoves[0];
      const sameLine = sameRoot && firstMoves.length === secondMoves.length && firstMoves.every((move, index) => move === secondMoves[index]);
      root = root && sameRoot;
      exact = exact && sameLine;
      process.stdout.write(`Run ${run} ${first.engineKey}: plain root = ${firstMoves[0] ?? "none"}, pattern-baseline root = ${secondMoves[0] ?? "none"} ${sameLine ? "MATCH" : sameRoot ? "ROOT MATCH" : "MISMATCH"}\n`);
    }
    if (root) rootMatches += 1;
    if (exact) exactMatches += 1;
  }
  process.stdout.write(`exact line match: ${exactMatches}/${runs}\nroot move match: ${rootMatches}/${runs}\n`);
  if (rootMatches !== runs) process.exitCode = 1;
};

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
