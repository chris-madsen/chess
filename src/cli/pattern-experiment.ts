#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { parsePatternDataset } from "../application/experiments/pattern-dataset";
import { summarizePatternExperiment } from "../application/experiments/pattern-report";
import { runPatternSelectionExperiment, runPatternSelectionExperimentFromLines } from "../application/use-cases/pattern-experiment";
import { domainError } from "../domain/shared/errors";
import { isErr } from "../domain/shared/result";
import { createInMemoryAnalysisCache } from "../adapters/cache/in-memory-analysis-cache";
import { createForcedMateVerifier, createUciForcedMateProofProvider, createWindowsCstalStylePathProviders, fetchRemoteStylePathBatch, loadLocalEnginePaths, makeRemoteStylePathConfig } from "../wiring/index";

const valueAfter = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};

const integerOption = (args: readonly string[], flag: string, fallback: number): number => {
  const raw = valueAfter(args, flag);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer`);
  return value;
};

const runRemoteCaseWithProgress = async <T>(caseId: string, run: () => Promise<T>): Promise<T> => {
  const startedAt = Date.now();
  process.stdout.write(`${caseId}: requesting Windows CSTal ABSURD/EXTREME + Maia lines...\n`);
  const heartbeat = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    process.stdout.write(`${caseId}: waiting for remote SSE completion (${elapsedSeconds}s)...\n`);
  }, 10_000);
  try {
    return await run();
  } finally {
    clearInterval(heartbeat);
  }
};

const usage = `Usage:
  npm run pattern:experiment -- --dataset datasets/pattern-mvp.jsonl [options]

Options:
  --dataset <path>             Versioned JSONL dataset.
  --out <path>                 JSONL artifact output path.
  --dataset-version <id>       Dataset version, default pattern-mvp-v1.
  --horizon-full-moves <n>     Rollout horizon, default 8.
  --prefix-plies <n>           Prefix visible to selector, default 8.
  --maia3-elo <rating>         Maia3 Elo, default 1800.
  --provider <remote|local>    Remote Windows API (default) or local engines.
  --api-url <url>              Remote API base URL override.
  --remote-concurrency <n>     Batch workers on Windows, default 2.
`;

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const datasetPath = valueAfter(args, "--dataset");
  if (datasetPath === undefined || !existsSync(datasetPath)) {
    process.stderr.write(`${usage}\nDataset file is required and must exist.\n`);
    process.exitCode = 2;
    return;
  }
  const datasetVersion = valueAfter(args, "--dataset-version") ?? "pattern-mvp-v1";
  const horizonFullMoves = integerOption(args, "--horizon-full-moves", 8);
  const prefixPlies = integerOption(args, "--prefix-plies", 8);
  const maia3Elo = integerOption(args, "--maia3-elo", 1800);
  const remoteConcurrency = integerOption(args, "--remote-concurrency", 2);
  const providerMode = valueAfter(args, "--provider") ?? "remote";
  if (providerMode !== "remote" && providerMode !== "local") {
    process.stderr.write(`${usage}\n--provider must be remote or local.\n`);
    process.exitCode = 2;
    return;
  }
  const outputPath = valueAfter(args, "--out") ?? `.local/pattern-experiment-${Date.now()}.jsonl`;
  const chess = createChessJsRulesAdapter();
  const dataset = parsePatternDataset(chess, readFileSync(datasetPath, "utf8"), horizonFullMoves, prefixPlies);
  if (isErr(dataset)) {
    process.stderr.write(`${dataset.error.code}: ${dataset.error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const firstCase = dataset.value[0];
  if (firstCase === undefined) {
    process.stderr.write("Dataset must contain at least one case.\n");
    process.exitCode = 2;
    return;
  }
  if (remoteConcurrency > 4) {
    process.stderr.write("--remote-concurrency must be between 1 and 4.\n");
    process.exitCode = 2;
    return;
  }
  const enginePaths = loadLocalEnginePaths();
  const providers = providerMode === "local" ? createWindowsCstalStylePathProviders(chess, enginePaths, { opponent: "maia3", maia3Elo }) : undefined;
  const apiUrl = valueAfter(args, "--api-url");
  const remoteConfig = providerMode === "remote"
    ? makeRemoteStylePathConfig(apiUrl === undefined ? { maia3Elo } : { baseUrl: apiUrl, maia3Elo })
    : undefined;
  if (remoteConfig !== undefined && isErr(remoteConfig)) {
    process.stderr.write(`${remoteConfig.error.code}: ${remoteConfig.error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const verifier = enginePaths.stockfish19Path === undefined ? undefined : createForcedMateVerifier(chess, createUciForcedMateProofProvider({
    key: "stockfish19-forced-mate",
    command: enginePaths.stockfish19Path,
    options: [{ name: "Threads", value: 2 }, { name: "Hash", value: 1024 }],
    mateMoves: 20,
    timeoutMs: 300_000
  }));
  const cache = createInMemoryAnalysisCache();
  const remoteBatch = providerMode === "remote"
    ? remoteConfig === undefined
      ? { tag: "Err" as const, error: domainError("PROVIDER_UNAVAILABLE", "remoteStyleApi", "Remote API configuration is unavailable") }
      : await runRemoteCaseWithProgress(`batch:${dataset.value.length}`, () => fetchRemoteStylePathBatch(chess, dataset.value.map(experimentCase => ({ caseId: experimentCase.caseId, position: experimentCase.position })), firstCase.horizon, remoteConfig.value, remoteConcurrency))
    : undefined;
  if (remoteBatch !== undefined && isErr(remoteBatch)) {
    process.stderr.write(`${remoteBatch.error.code}: ${remoteBatch.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const results = [];
  for (const experimentCase of dataset.value) {
    const result = providerMode === "remote"
      ? remoteConfig === undefined
        ? { tag: "Err" as const, error: domainError("PROVIDER_UNAVAILABLE", "remoteStyleApi", "Remote API configuration is unavailable") }
        : await (async () => {
          const remoteLines = remoteBatch?.value[experimentCase.caseId];
          return remoteLines === undefined
            ? { tag: "Err" as const, error: domainError("PROVIDER_UNAVAILABLE", `remoteStyleApi.batch.${experimentCase.caseId}`, "Remote batch did not return this case") }
            : await runPatternSelectionExperimentFromLines(chess, remoteLines, experimentCase, verifier, cache);
        })()
      : providers === undefined
        ? { tag: "Err" as const, error: domainError("PROVIDER_UNAVAILABLE", "localStyleProviders", "Local provider configuration is unavailable") }
        : await runPatternSelectionExperiment(chess, providers, experimentCase, verifier, cache);
    if (isErr(result)) {
      process.stderr.write(`${experimentCase.caseId}: ${result.error.code}: ${result.error.message}\n`);
      process.exitCode = 1;
      return;
    }
    results.push(result.value);
    process.stdout.write(`${experimentCase.caseId}: selected=${result.value.comparison.selection.selectedEngineKey} baseline=${result.value.comparison.baseline.beautifulForcedCombination} treatment=${result.value.comparison.treatment.beautifulForcedCombination} forced=${result.value.comparison.treatment.forcedMate.status}\n`);
  }
  const report = summarizePatternExperiment(datasetVersion, results);
  mkdirSync(dirname(outputPath), { recursive: true });
  const artifact = [
    ...results.map(result => JSON.stringify({ type: "case", ...result })),
    JSON.stringify({ type: "summary", report })
  ].join("\n") + "\n";
  writeFileSync(outputPath, artifact, "utf8");
  process.stdout.write(`summary: ${report.status}; ${report.reason}; artifact=${outputPath}\n`);
  if (report.status === "FAILURE") process.exitCode = 1;
};

void main().catch(error => {
  const failure = domainError("PROVIDER_UNAVAILABLE", "pattern-experiment", error instanceof Error ? error.message : String(error));
  process.stderr.write(`${failure.code}: ${failure.message}\n`);
  process.exitCode = 1;
});
