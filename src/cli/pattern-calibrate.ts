#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { ingestPatternDatasetEntry, type PatternDatasetEntry } from "../application/experiments/pattern-dataset";
import { extractPatternPositionContext, makePatternAnalysisContext, type PatternAnalysisContext } from "../domain/patterns/context";
import { retrievePatternFamilies } from "../domain/patterns/matchers";
import { PATTERN_FAMILY_IDS, type PatternFamilyId } from "../domain/patterns/pattern";
import { isErr } from "../domain/shared/result";

type NearScore = Readonly<{ score: number; distanceToTerminal?: number; caseId: string }>;
type Scores = { positive: number[]; positiveNear: NearScore[]; hardNegative: number[]; control: number[] };
type FamilyCalibration = { status: "CALIBRATED" | "WEAK_SEPARATION" | "UNAVAILABLE"; reason?: string; positiveCount: number; hardNegativeCount: number; controlCount: number; presenceThreshold?: number; targetTrigger?: number; points?: readonly (readonly [number, number])[] };
const round = (value: number): number => Number(Math.max(0, Math.min(1, value)).toFixed(4));
const quantile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))] ?? 0;
};
const rate = (n: number, d: number): number => d === 0 ? 0 : n / d;

const analysisFor = (chess: ReturnType<typeof createChessJsRulesAdapter>, entry: PatternDatasetEntry): PatternAnalysisContext => {
  const startPly = entry.trajectoryStartPly ?? (entry.trajectory?.some(state => state.ply === 1) === true ? 1 : 0);
  const start = chess.ingestPosition(entry.trajectory?.find(state => state.ply === startPly)?.fen ?? entry.fen);
  if (isErr(start)) throw new Error(`Invalid calibration start for ${entry.caseId}: ${start.error.message}`);
  return makePatternAnalysisContext(entry.attackerSide ?? start.value.sideToMove);
};
const scoreAt = (chess: ReturnType<typeof createChessJsRulesAdapter>, fen: string, family: PatternFamilyId, analysis: PatternAnalysisContext): number => {
  const position = chess.ingestPosition(fen);
  if (isErr(position)) return 0;
  const facts = chess.computeFacts(position.value);
  if (isErr(facts)) return 0;
  const context = extractPatternPositionContext(position.value, facts.value, analysis);
  return retrievePatternFamilies(context, 34).find(item => item.family === family)?.similarity ?? 0;
};
const caseScores = (chess: ReturnType<typeof createChessJsRulesAdapter>, entry: PatternDatasetEntry): readonly Readonly<{ score: number; distanceToTerminal?: number }>[] => {
  const analysis = analysisFor(chess, entry);
  const startPly = entry.trajectoryStartPly ?? (entry.trajectory?.some(state => state.ply === 1) === true ? 1 : 0);
  const states = entry.trajectory?.filter(state => state.ply >= startPly) ?? [];
  return states.length === 0 ? [{ score: scoreAt(chess, entry.fen, entry.family, analysis) }] : states.map(state => ({ score: scoreAt(chess, state.fen, entry.family, analysis), distanceToTerminal: state.distanceToTerminal }));
};
const candidatesFor = (scores: Scores): readonly number[] => [...new Set([0, 1, ...scores.positive, ...scores.hardNegative, ...scores.control])].sort((a, b) => a - b);
const metrics = (scores: Scores, threshold: number): Readonly<{ precision: number; recall: number; f1: number }> => {
  const tp = scores.positive.filter(value => value >= threshold).length;
  const fp = [...scores.hardNegative, ...scores.control].filter(value => value >= threshold).length;
  const fn = scores.positive.length - tp;
  const precision = rate(tp, tp + fp);
  const recall = rate(tp, tp + fn);
  return { precision, recall, f1: precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall) };
};
const presenceFor = (scores: Scores): number => {
  const candidates = candidatesFor(scores).map(threshold => ({ threshold, ...metrics(scores, threshold) }));
  const precise = candidates.filter(item => item.precision >= 0.95);
  const best = (precise.length > 0 ? precise.sort((a, b) => b.recall - a.recall || a.threshold - b.threshold) : candidates.sort((a, b) => b.f1 - a.f1 || a.threshold - b.threshold))[0];
  return round(best?.threshold ?? 0);
};
const targetFor = (scores: Scores): number => {
  if (scores.positive.length === 0) return 0;
  const negativeCeiling = Math.max(quantile(scores.hardNegative, 0.95), quantile(scores.control, 0.95));
  const basinPositive = scores.positiveNear.length === 0 ? scores.positive : scores.positiveNear.map(item => item.score);
  return round(Math.max(quantile(basinPositive, 0.75), negativeCeiling + (negativeCeiling < 1 ? 0.001 : 0)));
};
const pointsFor = (scores: Scores): readonly (readonly [number, number])[] => {
  if (scores.positive.length === 0) return [];
  const all = [...new Set([0, 1, ...scores.positive, ...scores.hardNegative, ...scores.control])].sort((a, b) => a - b);
  const negativeCount = scores.hardNegative.length + scores.control.length;
  const prior = rate(scores.positive.length, scores.positive.length + negativeCount);
  const values = all.map(raw => {
    if (raw === 0) return 0;
    const positive = scores.positive.filter(value => value >= raw).length;
    const negative = [...scores.hardNegative, ...scores.control].filter(value => value >= raw).length;
    const precision = positive + negative === 0 ? 0 : positive / (positive + negative);
    const evidence = prior >= 1 ? 0 : Math.max(0, (precision - prior) / (1 - prior));
    return evidence;
  });
  const blocks: Array<{ start: number; end: number; value: number }> = [];
  values.forEach((value, index) => {
    blocks.push({ start: index, end: index, value });
    while (blocks.length >= 2 && blocks.at(-2)!.value > blocks.at(-1)!.value) {
      const right = blocks.pop()!;
      const left = blocks.pop()!;
      const count = right.end - left.start + 1;
      blocks.push({ start: left.start, end: right.end, value: (left.value * (left.end - left.start + 1) + right.value * (right.end - right.start + 1)) / count });
    }
  });
  return all.map((raw, index) => [round(raw), round(blocks.find(block => index >= block.start && index <= block.end)?.value ?? 0)] as const);
};
const generatedSource = (families: Readonly<Record<string, FamilyCalibration>>, metadata: Readonly<{ modelVersion: string; datasetVersion: string; calibrationSha256: string }>): string => {
  const body = JSON.stringify(families, null, 2);
  const datasetVersion = metadata.datasetVersion.replace(/^lichess-/iu, "");
  return `/* Generated by npm run pattern:calibrate. */\nimport type { PatternFamilyId } from "./pattern";\nexport type PatternCalibration = Readonly<{ status: "CALIBRATED" | "WEAK_SEPARATION" | "UNAVAILABLE"; reason?: string; positiveCount: number; hardNegativeCount: number; controlCount: number; presenceThreshold?: number; targetTrigger?: number; points?: readonly (readonly [number, number])[] }>;\nexport const PATTERN_CALIBRATION_MODEL_VERSION = ${JSON.stringify(metadata.modelVersion)};\nexport const PATTERN_CALIBRATION_DATASET_VERSION = ${JSON.stringify(datasetVersion)};\nexport const PATTERN_CALIBRATION_SHA256 = ${JSON.stringify(metadata.calibrationSha256)};\nexport const PATTERN_CALIBRATION: Readonly<Partial<Record<PatternFamilyId, PatternCalibration>>> = ${body};\n`;
};

const main = (): void => {
  const datasetPath = process.argv[2] ?? "datasets/pattern-mvp-lichess.jsonl";
  const outputPath = process.argv[3] ?? "src/domain/patterns/pattern-calibration.json";
  const generatedPath = process.argv[4] ?? "src/domain/patterns/pattern-calibration.generated.ts";
  const chess = createChessJsRulesAdapter();
  const scores = new Map<PatternFamilyId, Scores>(PATTERN_FAMILY_IDS.map(family => [family, { positive: [], positiveNear: [], hardNegative: [], control: [] }]));
  let datasetVersion = "unknown";
  let calibrationCases = 0;
  for (const [index, line] of readFileSync(datasetPath, "utf8").split(/\r?\n/u).map(value => value.trim()).filter(Boolean).entries()) {
    const parsed = ingestPatternDatasetEntry(JSON.parse(line) as unknown, `dataset.line.${index + 1}`);
    if (isErr(parsed)) throw new Error(`${parsed.error.code}: ${parsed.error.message}`);
    const entry = parsed.value;
    if (entry.split !== "calibration") continue;
    datasetVersion = entry.datasetVersion;
    calibrationCases += 1;
    const bucket = scores.get(entry.family)!;
    const caseScoresValue = caseScores(chess, entry);
    const maximum = Math.max(...caseScoresValue.map(item => item.score));
    bucket[entry.exampleKind === "positive" ? "positive" : entry.exampleKind === "hard_negative" ? "hardNegative" : "control"].push(maximum);
    if (entry.exampleKind === "positive") {
      for (const nearScore of caseScoresValue.filter(item => item.distanceToTerminal !== undefined && item.distanceToTerminal <= 4)) {
        bucket.positiveNear.push({ ...nearScore, caseId: entry.caseId });
      }
    }
  }
  const families: Record<string, FamilyCalibration> = {};
  for (const family of PATTERN_FAMILY_IDS) {
    const bucket = scores.get(family)!;
    families[family] = bucket.positive.length === 0
      ? { status: "UNAVAILABLE", reason: "no verified calibration fixtures", positiveCount: 0, hardNegativeCount: bucket.hardNegative.length, controlCount: bucket.control.length }
      : (() => { const presenceThreshold = presenceFor(bucket); return { status: presenceThreshold === 0 ? "WEAK_SEPARATION" as const : "CALIBRATED" as const, ...(presenceThreshold === 0 ? { reason: "no high-precision operating point" } : {}), positiveCount: bucket.positive.length, hardNegativeCount: bucket.hardNegative.length, controlCount: bucket.control.length, presenceThreshold, targetTrigger: Math.max(presenceThreshold, targetFor(bucket)), points: pointsFor(bucket) }; })();
  }
  const artifact = { modelVersion: "mate-geometry-v2-calibration-v4-prior-adjusted", datasetVersion, split: "calibration", calibrationCases, method: "stable attacker side; state-level positive-near basin; prior-adjusted positive/hard-negative/control evidence map", families };
  const artifactText = `${JSON.stringify(artifact, null, 2)}\n`;
  const calibrationSha256 = createHash("sha256").update(artifactText, "utf8").digest("hex");
  writeFileSync(outputPath, artifactText, "utf8");
  writeFileSync(generatedPath, generatedSource(families, { modelVersion: artifact.modelVersion, datasetVersion: artifact.datasetVersion, calibrationSha256 }), "utf8");
  process.stdout.write(`pattern calibration written to ${outputPath} and ${generatedPath} (${calibrationCases} calibration cases)\n`);
};
main();
