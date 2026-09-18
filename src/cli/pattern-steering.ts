#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { parsePatternDataset } from "../application/experiments/pattern-dataset";
import { generatePatternSteeredTalPath } from "../application/use-cases/pattern-steered-tal-path";
import { isErr } from "../domain/shared/result";
import { createInMemoryAnalysisCache } from "../adapters/cache/in-memory-analysis-cache";
import { createPatriciaCandidateGenerator, createWindowsCstalPatternCandidateGenerator, createWindowsCstalStylePathProviders, createWindowsCstalTacticalGate, fetchRemotePatternSteeringBatch, loadLocalEnginePaths, makeRemoteStylePathConfig } from "../wiring/index";

const valueAfter = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};

const positive = (args: readonly string[], flag: string, fallback: number): number => {
  const value = Number(valueAfter(args, flag) ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer`);
  return value;
};

const usage = `Usage:
  npm run pattern:experiment -- --dataset datasets/pattern-mvp-lichess.jsonl [options]

Options:
  --provider <remote|local>    Windows batch API (default remote) or local Windows engines.
  --subset <n|all>             Number of deterministic cases, default 100.
  --maia3-elo <rating>         Maia3 Elo, default 1800.
  --concurrency <n>            Remote bounded workers, default 2.
  --out <path>                 JSONL artifact path.
`;

const selectSubset = <T extends { caseId: string }>(items: readonly T[], raw: string): readonly T[] => {
  if (raw === "all") return items;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--subset must be all or a positive integer");
  return [...items].sort((a, b) => a.caseId.localeCompare(b.caseId)).slice(0, limit);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const datasetPath = valueAfter(args, "--dataset");
  if (datasetPath === undefined || !existsSync(datasetPath)) throw new Error(`${usage}\nDataset file is required and must exist.`);
  const provider = valueAfter(args, "--provider") ?? "remote";
  if (provider !== "remote" && provider !== "local") throw new Error("--provider must be remote or local");
  const horizonMoves = positive(args, "--horizon-full-moves", 8);
  const cases = parsePatternDataset(createChessJsRulesAdapter(), readFileSync(datasetPath, "utf8"), horizonMoves, 8);
  if (isErr(cases)) throw new Error(`${cases.error.code}: ${cases.error.message}`);
  const selected = selectSubset(cases.value, valueAfter(args, "--subset") ?? "100");
  if (selected.length === 0) throw new Error("Dataset contains no cases");
  const chess = createChessJsRulesAdapter();
  const maia3Elo = positive(args, "--maia3-elo", 1800);
  const concurrency = positive(args, "--concurrency", 2);
  const output = valueAfter(args, "--out") ?? `.local/pattern-steering-${Date.now()}.jsonl`;
  const records: unknown[] = [];
  const patternCache = createInMemoryAnalysisCache();

  if (provider === "remote") {
    const config = makeRemoteStylePathConfig({ maia3Elo });
    if (isErr(config)) throw new Error(`${config.error.code}: ${config.error.message}`);
    process.stdout.write(`remote steering: submitted ${selected.length} cases, concurrency=${concurrency}; waiting for Windows Tal+Maia workers...\n`);
    const remote = await fetchRemotePatternSteeringBatch(chess, selected.map(item => ({ caseId: item.caseId, position: item.position })), selected[0]?.horizon ?? cases.value[0]!.horizon, config.value, concurrency, progress => {
      process.stdout.write(`remote steering: ${progress.completed}/${progress.total} completed, status=${progress.status}\n`);
    });
    if (isErr(remote)) throw new Error(`${remote.error.code}: ${remote.error.message}`);
    selected.forEach(item => records.push({ type: "case", caseId: item.caseId, mode: "steering", line: remote.value[item.caseId] ?? null }));
  } else {
    const paths = loadLocalEnginePaths();
    for (const item of selected) {
      const providers = createWindowsCstalStylePathProviders(chess, paths, { opponent: "maia3", maia3Elo });
      const patricia = paths.patriciaPath === undefined ? undefined : createPatriciaCandidateGenerator(chess, paths, 8);
      const generator = createWindowsCstalPatternCandidateGenerator(chess, paths, { opponent: "maia3", maia3Elo }, 8, patricia);
      const tacticalGate = createWindowsCstalTacticalGate(chess, paths, { opponent: "maia3", maia3Elo });
      let line;
      try {
        line = await generatePatternSteeredTalPath({ chess, start: item.position, attackerSide: item.position.sideToMove, generator, tacticalGate, maia: providers.maia, lineId: `pattern-steering-${item.caseId}`, horizon: item.horizon, cache: patternCache });
      } finally {
        generator.dispose?.();
        tacticalGate.dispose?.();
        providers.maia.dispose?.();
        providers.styleEngines.forEach(engine => engine.provideMove.dispose?.());
      }
      if (isErr(line)) throw new Error(`${item.caseId}: ${line.error.code}: ${line.error.message}`);
      records.push({ type: "case", caseId: item.caseId, mode: "steering", line: line.value });
      process.stdout.write(`${item.caseId}: ${line.value.status}, plies=${line.value.plies.length}\n`);
    }
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ type: "run", mode: "steering", provider, dataset: datasetPath, selectedCases: selected.length, concurrency })}\n${records.map(record => JSON.stringify(record)).join("\n")}\n`, "utf8");
  process.stdout.write(`steering artifact=${output}\n`);
};

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
