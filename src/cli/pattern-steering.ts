#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { parsePatternDataset } from "../application/experiments/pattern-dataset";
import { generatePatternSteeredTalPath } from "../application/use-cases/pattern-steered-tal-path";
import { generateStylePaths } from "../application/use-cases/style-path";
import { analyzeLessonLine } from "../application/use-cases/analyze-combination";
import { isErr } from "../domain/shared/result";
import { makeScenarioHorizon } from "../domain/chess/value-objects";
import { createInMemoryAnalysisCache } from "../adapters/cache/in-memory-analysis-cache";
import { createForcedMateVerifier, createPatriciaCandidateGenerator, createUciForcedMateProofProvider, createWindowsCstalPatternCandidateGenerator, createWindowsCstalStylePathProviders, createWindowsCstalTacticalGate, fetchRemotePatternSteeringBatch, fetchRemoteStylePaths, generatePatternTargetSession, loadLocalEnginePaths, makeRemoteStylePathConfig } from "../wiring/index";
import { renderLessonComparison, renderPatternDiscoveryStart, renderPatternProgressStatus, renderPatternReference, renderPatternRemoteFrame, renderPatternSteeringLine, renderPatternTargetReferences, renderPatternTargetSession } from "./pattern-steering-render";
import { defaultPatternHorizonMoves } from "./pattern-steering-options";
import { createLiveTerminalRenderer } from "./live-terminal-renderer";

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
    const liveRenderer = createLiveTerminalRenderer();
    const renderLive = (text: string, final = false): void => liveRenderer.render(text, final);
    const startedAt = Date.now();
    let completed = 0;
    const renderProgress = (): void => renderLive(renderPatternRemoteFrame(
      [...renderedLines.values()],
      renderPatternProgressStatus(selected[0]?.caseId ?? "pattern", completed, selected.length, Math.floor((Date.now() - startedAt) / 1000))
    ));
    selected.forEach(item => renderedLines.set(item.caseId, renderPatternDiscoveryStart(item.caseId, item.position)));
    renderLive([...renderedLines.values()].join(""));
    renderProgress();
    const progressTimer = setInterval(renderProgress, 2_000);
    let remote;
    try {
      remote = await fetchRemotePatternSteeringBatch(chess, selected.map(item => ({ caseId: item.caseId, position: item.position, ...( "rawGame" in item && item.rawGame !== undefined ? { rawGame: item.rawGame } : {}) })), selected[0]?.horizon ?? cases!.value[0]!.horizon, config.value, concurrency, progress => {
        completed = progress.completed;
      if (progress.caseId !== undefined && progress.line !== undefined) {
        const rendered = progress.session === undefined
          ? renderPatternSteeringLine(progress.caseId, progress.line)
          : renderPatternTargetSession(progress.caseId, progress.session);
        if (renderedLines.get(progress.caseId) !== rendered) {
          renderedLines.set(progress.caseId, rendered);
        }
      }
      renderProgress();
      });
    } finally {
      clearInterval(progressTimer);
    }
    if (isErr(remote)) throw new Error(`${remote.error.code}: ${remote.error.message}`);
    renderLive([...renderedLines.values()].join(""), true);
    const baselineViews: Readonly<{ label: string; line: import("../domain/scenario-lines/scenario-line").ScenarioLine; profile: ReturnType<typeof analyzeLessonLine>; fullLineSignature?: string }>[] = [];
    if (rawCase !== undefined) {
      const baseline = await fetchRemoteStylePaths(chess, rawCase.position, rawCase.horizon, config.value, 14, rawCase.rawGame);
      if (!isErr(baseline)) {
        baseline.value.forEach(item => baselineViews.push({ label: item.line.label, line: item.line, profile: analyzeLessonLine(chess, item.line, { lineId: item.engineKey, fullRootToTerminalPlies: item.line.plies.length }), fullLineSignature: item.line.plies.map(ply => String(ply.move.uci)).join(" ") }));
      }
    }
    selected.forEach(item => {
      const line = remote.value[item.caseId];
      records.push({ type: "case", caseId: item.caseId, mode: "steering", line: line ?? null, ...(line?.targetSession === undefined ? {} : { targetSession: line.targetSession }), ...(item.caseId === "raw-game" && baselineViews.length === 0 ? {} : item.caseId === "raw-game" ? { baseline: baselineViews } : {}) });
      if (line?.targetSession !== undefined) process.stdout.write(renderPatternTargetReferences(item.caseId, line.targetSession));
      else if (line !== undefined) process.stdout.write(renderPatternReference(line));
      if (item.caseId === "raw-game" && line?.targetSession !== undefined) {
        const target = line.targetSession.targets.find(candidate => candidate.lessonProfile !== undefined && candidate.line !== undefined);
        if (target?.line !== undefined && target.lessonProfile !== undefined) {
          const fullLine = { ...target.line, start: line.targetSession.discovery.start, plies: [...target.prefixPlies, ...target.line.plies] };
          process.stdout.write(renderLessonComparison(item.caseId, { label: `Target ${target.targetFamily}`, line: fullLine, profile: target.lessonProfile, ...(target.fullLineSignature === undefined ? {} : { fullLineSignature: target.fullLineSignature }) }, baselineViews));
        }
      }
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
      const forcedMateVerifier = paths.stockfish19Path === undefined ? undefined : createForcedMateVerifier(chess, createUciForcedMateProofProvider({
        key: "stockfish19-pattern-target-proof",
        command: paths.stockfish19Path,
        options: [{ name: "Threads", value: 2 }, { name: "Hash", value: 1024 }],
        mateMoves: 20,
        timeoutMs: 300_000
      }));
      const liveRenderer = createLiveTerminalRenderer();
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
          ...(forcedMateVerifier === undefined ? {} : { verifyForcedMate: forcedMateVerifier }),
          onProgress: current => renderLive(renderPatternTargetSession(item.caseId, current))
        });
        if (isErr(session)) throw new Error(`${item.caseId}: ${session.error.code}: ${session.error.message}`);
        const baselineViews: Readonly<{ label: string; line: import("../domain/scenario-lines/scenario-line").ScenarioLine; profile: ReturnType<typeof analyzeLessonLine>; fullLineSignature?: string }>[] = [];
        if (rawCase !== undefined) {
          const baselineProviders = createWindowsCstalStylePathProviders(chess, paths, { opponent: "maia3", maia3Elo });
          try {
            const baseline = await generateStylePaths(chess, baselineProviders, { start: item.position, horizon: item.horizon, lineId: `pattern-baseline-${item.caseId}` });
            if (!isErr(baseline)) baseline.value.forEach(item => baselineViews.push({ label: item.line.label, line: item.line, profile: analyzeLessonLine(chess, item.line, { lineId: item.engineKey, fullRootToTerminalPlies: item.line.plies.length }), fullLineSignature: item.line.plies.map(ply => String(ply.move.uci)).join(" ") }));
          } finally {
            baselineProviders.maia.dispose?.();
            baselineProviders.styleEngines.forEach(engine => engine.provideMove.dispose?.());
          }
        }
        records.push({ type: "case", caseId: item.caseId, mode: "steering", discovery: session.value.discovery, targets: session.value.targets, ...(baselineViews.length === 0 ? {} : { baseline: baselineViews } ) });
        renderLive(renderPatternTargetSession(item.caseId, session.value), true);
        process.stdout.write(renderPatternTargetReferences(item.caseId, session.value));
        if (rawCase !== undefined) {
          const target = session.value.targets.find(candidate => candidate.lessonProfile !== undefined && candidate.line !== undefined);
          if (target?.line !== undefined && target.lessonProfile !== undefined) {
            const fullLine = { ...target.line, start: session.value.discovery.start, plies: [...target.prefixPlies, ...target.line.plies] };
            process.stdout.write(renderLessonComparison(item.caseId, { label: `Target ${target.targetFamily}`, line: fullLine, profile: target.lessonProfile, ...(target.fullLineSignature === undefined ? {} : { fullLineSignature: target.fullLineSignature }) }, baselineViews));
          }
        }
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
