#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { ingestPatternDatasetEntry, type PatternDatasetEntry } from "../application/experiments/pattern-dataset";
import { extractPatternPositionContext, makePatternAnalysisContext } from "../domain/patterns/context";
import { retrievePatternFamilies } from "../domain/patterns/matchers";
import { PATTERN_FAMILY_IDS, type PatternFamilyId } from "../domain/patterns/pattern";
import { isErr } from "../domain/shared/result";

type Scores = { positive: number[]; negative: number[] };

const scoreAt = (chess: ReturnType<typeof createChessJsRulesAdapter>, fen: string, family: PatternFamilyId): number => {
  const position = chess.ingestPosition(fen);
  if (isErr(position)) return 0;
  const facts = chess.computeFacts(position.value);
  if (isErr(facts)) return 0;
  const context = extractPatternPositionContext(position.value, facts.value, makePatternAnalysisContext(position.value.sideToMove));
  return retrievePatternFamilies(context, 34).find(item => item.family === family)?.similarity ?? 0;
};

const maxCaseScore = (chess: ReturnType<typeof createChessJsRulesAdapter>, entry: PatternDatasetEntry): number => {
  const states = entry.trajectory?.map(state => state.fen) ?? [entry.fen];
  return Math.max(...states.map(fen => scoreAt(chess, fen, entry.family)));
};

const bestThreshold = (scores: Scores): number => Number(Math.max(0.05, Math.max(...scores.positive, 0) * 0.95).toFixed(3));

const main = (): void => {
  const datasetPath = process.argv[2] ?? "datasets/pattern-mvp-lichess.jsonl";
  const outputPath = process.argv[3] ?? "src/domain/patterns/pattern-calibration.json";
  const chess = createChessJsRulesAdapter();
  const scores = new Map<PatternFamilyId, Scores>(PATTERN_FAMILY_IDS.map(family => [family, { positive: [], negative: [] }]));
  let datasetVersion = "unknown";
  let calibrationCases = 0;
  for (const [index, line] of readFileSync(datasetPath, "utf8").split(/\r?\n/u).map(value => value.trim()).filter(Boolean).entries()) {
    const parsed: unknown = JSON.parse(line);
    const entry = ingestPatternDatasetEntry(parsed, `dataset.line.${index + 1}`);
    if (isErr(entry)) throw new Error(`${entry.error.code}: ${entry.error.message}`);
    if (entry.value.split !== "calibration" || entry.value.exampleKind === "control") continue;
    datasetVersion = entry.value.datasetVersion;
    calibrationCases += 1;
    const bucket = scores.get(entry.value.family)!;
    const score = maxCaseScore(chess, entry.value);
    (entry.value.exampleKind === "positive" ? bucket.positive : bucket.negative).push(score);
  }
  const families = Object.fromEntries(PATTERN_FAMILY_IDS.map(family => {
    const bucket = scores.get(family)!;
    const targetTrigger = bestThreshold(bucket);
    return [family, {
      presenceThreshold: Number((targetTrigger * 0.75).toFixed(3)),
      targetTrigger,
      positiveCount: bucket.positive.length,
      hardNegativeCount: bucket.negative.length
    }];
  }));
  writeFileSync(outputPath, `${JSON.stringify({ modelVersion: "mate-geometry-v2-calibration-v1", datasetVersion, split: "calibration", calibrationCases, method: "per-family maximum positive trajectory score with 5% calibration margin", families }, null, 2)}\n`, "utf8");
  process.stdout.write(`pattern calibration written to ${outputPath} (${calibrationCases} calibration cases)\n`);
};

main();
