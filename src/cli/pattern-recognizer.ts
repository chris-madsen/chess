#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { parsePatternDataset } from "../application/experiments/pattern-dataset";
import { recognizePatternCase, summarizePatternRecognition } from "../application/experiments/pattern-recognizer";
import { isErr } from "../domain/shared/result";

const valueAfter = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};

const main = (): void => {
  const args = process.argv.slice(2);
  const datasetPath = valueAfter(args, "--dataset") ?? "datasets/pattern-mvp-lichess.jsonl";
  if (!existsSync(datasetPath)) throw new Error(`Dataset does not exist: ${datasetPath}`);
  const outputPath = valueAfter(args, "--out") ?? `.local/pattern-recognizer-${Date.now()}.jsonl`;
  const chess = createChessJsRulesAdapter();
  const dataset = parsePatternDataset(chess, readFileSync(datasetPath, "utf8"), 8, 8);
  if (isErr(dataset)) throw new Error(`${dataset.error.code}: ${dataset.error.message}`);
  const results = dataset.value.map(experimentCase => {
    const result = recognizePatternCase(chess, experimentCase, 8);
    if (isErr(result)) throw new Error(`${experimentCase.caseId}: ${result.error.code}: ${result.error.message}`);
    process.stdout.write(`${experimentCase.caseId}: top=${result.value.top1Family ?? "none"} target=${result.value.family}:${result.value.target.similarity.toFixed(3)}\n`);
    return result.value;
  });
  const report = summarizePatternRecognition(dataset.value[0]?.datasetVersion ?? "unknown", results);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${results.map(result => JSON.stringify({ type: "case", ...result })).join("\n")}\n${JSON.stringify({ type: "summary", report })}\n`, "utf8");
  process.stdout.write(`summary: ${JSON.stringify(report)}; artifact=${outputPath}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
