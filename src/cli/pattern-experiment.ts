#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { parsePatternDataset } from "../application/experiments/pattern-dataset";
import { summarizePatternExperiment } from "../application/experiments/pattern-report";
import { runPatternSelectionExperiment } from "../application/use-cases/pattern-experiment";
import { domainError } from "../domain/shared/errors";
import { isErr } from "../domain/shared/result";
import { createInMemoryAnalysisCache } from "../adapters/cache/in-memory-analysis-cache";
import { createWindowsCstalStylePathProviders, loadLocalEnginePaths } from "../wiring/local-style-engines";

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

const usage = `Usage:
  npm run pattern:experiment -- --dataset datasets/pattern-mvp.jsonl [options]

Options:
  --dataset <path>             Versioned JSONL dataset.
  --out <path>                 JSONL artifact output path.
  --dataset-version <id>       Dataset version, default pattern-mvp-v1.
  --horizon-full-moves <n>     Rollout horizon, default 8.
  --prefix-plies <n>           Prefix visible to selector, default 8.
  --maia3-elo <rating>         Maia3 Elo, default 1800.
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
  const outputPath = valueAfter(args, "--out") ?? `.local/pattern-experiment-${Date.now()}.jsonl`;
  const chess = createChessJsRulesAdapter();
  const dataset = parsePatternDataset(chess, readFileSync(datasetPath, "utf8"), horizonFullMoves, prefixPlies);
  if (isErr(dataset)) {
    process.stderr.write(`${dataset.error.code}: ${dataset.error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const providers = createWindowsCstalStylePathProviders(chess, loadLocalEnginePaths(), { opponent: "maia3", maia3Elo });
  const cache = createInMemoryAnalysisCache();
  const results = [];
  for (const experimentCase of dataset.value) {
    const result = await runPatternSelectionExperiment(chess, providers, experimentCase, undefined, cache);
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
