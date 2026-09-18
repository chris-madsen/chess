#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { parsePatternDataset } from "../application/experiments/pattern-dataset";
import { generatePatternSteeredTalPath } from "../application/use-cases/pattern-steered-tal-path";
import { isErr } from "../domain/shared/result";
import { makeScenarioHorizon } from "../domain/chess/value-objects";
import { createInMemoryAnalysisCache } from "../adapters/cache/in-memory-analysis-cache";
import { createPatriciaCandidateGenerator, createWindowsCstalPatternCandidateGenerator, createWindowsCstalStylePathProviders, createWindowsCstalTacticalGate, fetchRemotePatternSteeringBatch, loadLocalEnginePaths, makeRemoteStylePathConfig } from "../wiring/index";
import { renderPatternSteeringLine } from "./pattern-steering-render";

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
  --raw-file <path>             Analyze one PGN/raw SAN game and preserve its history.
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
  const rawFile = valueAfter(args, "--raw-file");
  if (datasetPath === undefined && rawFile === undefined) throw new Error(`${usage}\nProvide --dataset or --raw-file.`);
  if (datasetPath !== undefined && !existsSync(datasetPath)) throw new Error(`${usage}\nDataset file must exist.`);
  if (rawFile !== undefined && !existsSync(rawFile)) throw new Error(`${usage}\nRaw file must exist.`);
  const provider = valueAfter(args, "--provider") ?? "remote";
  if (provider !== "remote" && provider !== "local") throw new Error("--provider must be remote or local");
  const horizonMoves = positive(args, "--horizon-full-moves", 8);
  const inputChess = createChessJsRulesAdapter();
  const cases = datasetPath === undefined ? undefined : parsePatternDataset(inputChess, readFileSync(datasetPath, "utf8"), horizonMoves, 8);
  if (cases !== undefined && isErr(cases)) throw new Error(`${cases.error.code}: ${cases.error.message}`);
  const rawCase = rawFile === undefined ? undefined : (() => {
    const position = inputChess.ingestRawGame(readFileSync(rawFile, "utf8"));
    if (isErr(position)) throw new Error(`${position.error.code}: ${position.error.message}`);
    const horizon = makeScenarioHorizon(horizonMoves * 2);
    if (isErr(horizon)) throw new Error(`${horizon.error.code}: ${horizon.error.message}`);
    return { caseId: "raw-game", position: position.value, horizon: horizon.value, rawGame: readFileSync(rawFile, "utf8") };
  })();
  const selected = rawCase === undefined ? selectSubset(cases!.value, valueAfter(args, "--subset") ?? "100") : [rawCase];
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
    const renderedLines = new Map<string, string>();
    let renderedLineCount = 0;
    const renderLive = (text: string): void => {
      if (!process.stdout.isTTY) {
        process.stdout.write(text);
        return;
      }
      const frame = renderedLineCount === 0 ? text : `\x1b[${renderedLineCount}F\x1b[0J${text}`;
      process.stdout.write(frame);
      renderedLineCount = text.replace(/\n$/u, "").split("\n").length;
    };
    const remote = await fetchRemotePatternSteeringBatch(chess, selected.map(item => ({ caseId: item.caseId, position: item.position, ...("rawGame" in item && item.rawGame !== undefined ? { rawGame: item.rawGame } : {}) })), selected[0]?.horizon ?? cases!.value[0]!.horizon, config.value, concurrency, progress => {
      if (progress.caseId !== undefined && progress.line !== undefined) {
        const rendered = renderPatternSteeringLine(progress.caseId, progress.line);
        if (renderedLines.get(progress.caseId) !== rendered) {
          renderedLines.set(progress.caseId, rendered);
          renderLive([...renderedLines.values()].join(""));
        }
      }
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
  writeFileSync(output, `${JSON.stringify({ type: "run", mode: "steering", provider, ...(datasetPath === undefined ? { rawFile } : { dataset: datasetPath }), selectedCases: selected.length, concurrency })}\n${records.map(record => JSON.stringify(record)).join("\n")}\n`, "utf8");
  process.stdout.write(`steering artifact=${output}\n`);
};

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
