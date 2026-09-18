#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { parsePatternDataset } from "../application/experiments/pattern-dataset";
import { generatePatternSteeredTalPath } from "../application/use-cases/pattern-steered-tal-path";
import { isErr } from "../domain/shared/result";
import { makeScenarioHorizon } from "../domain/chess/value-objects";
import { createInMemoryAnalysisCache } from "../adapters/cache/in-memory-analysis-cache";
import { createPatriciaCandidateGenerator, createWindowsCstalPatternCandidateGenerator, createWindowsCstalStylePathProviders, createWindowsCstalTacticalGate, fetchRemotePatternSteeringBatch, generatePatternTargetSession, loadLocalEnginePaths, makeRemoteStylePathConfig } from "../wiring/index";
import { renderPatternDiscoveryStart, renderPatternReference, renderPatternSteeringLine, renderPatternTargetReferences, renderPatternTargetSession } from "./pattern-steering-render";
import { defaultPatternHorizonMoves } from "./pattern-steering-options";

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
  --raw-file <path>             Analyze one PGN/raw SAN game and preserve its history (default horizon: 80 full moves).
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

const ansiLiveOutputSupported = (): boolean => {
  if (process.env.STYLE_PATTERN_ANSI === "1") return true;
  if (process.env.STYLE_PATTERN_ANSI === "0" || process.env.NO_COLOR !== undefined) return false;
  if (process.stdout.isTTY !== true) return false;
  if (process.platform !== "win32") return true;
  return process.env.WT_SESSION !== undefined
    || process.env.ConEmuANSI === "ON"
    || process.env.ANSICON !== undefined
    || process.env.TERM_PROGRAM === "vscode"
    || process.env.TERM_PROGRAM === "Windows_Terminal";
};

const createLiveRenderer = (): { render: (text: string, final?: boolean) => void } => {
  let rendered = false;
  let compactLength = 0;
  const ansi = ansiLiveOutputSupported();
  const compact = (text: string): string => {
    const singleLine = text.replace(/\s+/gu, " ").trim();
    if (singleLine.length <= 72) return singleLine;
    return `${singleLine.slice(0, 34)} ... ${singleLine.slice(-34)}`;
  };
  return {
    render: (text, final = false) => {
      if (!ansi) {
        if (final) {
          process.stdout.write(`\r${" ".repeat(compactLength)}\r${text}`);
        } else if (!rendered) {
          process.stdout.write(text);
          compactLength = 0;
        } else {
          const status = compact(text);
          process.stdout.write(`\r${status}${" ".repeat(Math.max(0, compactLength - status.length))}`);
          compactLength = status.length;
        }
        rendered = true;
        return;
      }
      process.stdout.write(rendered ? `\x1b[2J\x1b[H${text}` : text);
      rendered = true;
    }
  };
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
  const horizonMoves = positive(args, "--horizon-full-moves", defaultPatternHorizonMoves(rawFile));
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
    const liveRenderer = createLiveRenderer();
    const renderLive = (text: string, final = false): void => liveRenderer.render(text, final);
    selected.forEach(item => renderedLines.set(item.caseId, renderPatternDiscoveryStart(item.caseId, item.position)));
    renderLive([...renderedLines.values()].join(""));
    const remote = await fetchRemotePatternSteeringBatch(chess, selected.map(item => ({ caseId: item.caseId, position: item.position, ...("rawGame" in item && item.rawGame !== undefined ? { rawGame: item.rawGame } : {}) })), selected[0]?.horizon ?? cases!.value[0]!.horizon, config.value, concurrency, progress => {
      if (progress.caseId !== undefined && progress.line !== undefined) {
        const rendered = progress.session === undefined
          ? renderPatternSteeringLine(progress.caseId, progress.line)
          : renderPatternTargetSession(progress.caseId, progress.session);
        if (renderedLines.get(progress.caseId) !== rendered) {
          renderedLines.set(progress.caseId, rendered);
          renderLive([...renderedLines.values()].join(""));
        }
      }
    });
    if (isErr(remote)) throw new Error(`${remote.error.code}: ${remote.error.message}`);
    selected.forEach(item => {
      const line = remote.value[item.caseId];
      records.push({ type: "case", caseId: item.caseId, mode: "steering", line: line ?? null, ...(line?.targetSession === undefined ? {} : { targetSession: line.targetSession }) });
    });
    renderLive([...renderedLines.values()].join(""), true);
    selected.forEach(item => {
      const line = remote.value[item.caseId];
      if (line?.targetSession !== undefined) process.stdout.write(renderPatternTargetReferences(item.caseId, line.targetSession));
      else if (line !== undefined) process.stdout.write(renderPatternReference(line));
    });
  } else {
    const paths = loadLocalEnginePaths();
    for (const item of selected) {
      const createSteering = () => {
        const providers = createWindowsCstalStylePathProviders(chess, paths, { opponent: "maia3", maia3Elo });
        const patricia = paths.patriciaPath === undefined ? undefined : createPatriciaCandidateGenerator(chess, paths, 8);
        const generator = createWindowsCstalPatternCandidateGenerator(chess, paths, { opponent: "maia3", maia3Elo }, 8, patricia);
        const tacticalGate = createWindowsCstalTacticalGate(chess, paths, { opponent: "maia3", maia3Elo });
        return { providers, generator, tacticalGate };
      };
      const discoveryProviders = createSteering();
      const liveRenderer = createLiveRenderer();
      const renderLive = (text: string, final = false): void => liveRenderer.render(text, final);
      renderLive(renderPatternDiscoveryStart(item.caseId, item.position));
      try {
        const session = await generatePatternTargetSession({
          discovery: { chess, start: item.position, attackerSide: item.position.sideToMove, generator: discoveryProviders.generator, tacticalGate: discoveryProviders.tacticalGate, maia: discoveryProviders.providers.maia, lineId: `pattern-discovery-${item.caseId}`, horizon: item.horizon, cache: patternCache },
          runTarget: async ({ target, remainingHorizonPlies }, onProgress) => {
            try {
              const horizon = makeScenarioHorizon(remainingHorizonPlies);
              if (isErr(horizon)) return horizon;
              return await generatePatternSteeredTalPath({ chess, start: target.position, attackerSide: target.position.sideToMove, generator: discoveryProviders.generator, tacticalGate: discoveryProviders.tacticalGate, maia: discoveryProviders.providers.maia, lineId: `pattern-target-${item.caseId}-${target.targetFamily}`, horizon: horizon.value, cache: patternCache, targetFamily: target.targetFamily, onProgress });
            } catch (error) {
              return { tag: "Err" as const, error: { code: "PROVIDER_UNAVAILABLE" as const, path: `patternTarget.${item.caseId}.${target.targetFamily}`, message: error instanceof Error ? error.message : String(error) } };
            }
          },
          onProgress: current => renderLive(renderPatternTargetSession(item.caseId, current))
        });
        if (isErr(session)) throw new Error(`${item.caseId}: ${session.error.code}: ${session.error.message}`);
        records.push({ type: "case", caseId: item.caseId, mode: "steering", discovery: session.value.discovery, targets: session.value.targets });
        renderLive(renderPatternTargetSession(item.caseId, session.value), true);
        process.stdout.write(renderPatternTargetReferences(item.caseId, session.value));
      } finally {
        discoveryProviders.generator.dispose?.();
        discoveryProviders.tacticalGate.dispose?.();
        discoveryProviders.providers.maia.dispose?.();
        discoveryProviders.providers.styleEngines.forEach(engine => engine.provideMove.dispose?.());
      }
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
