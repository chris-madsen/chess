import { parsePatternDataset } from "../src/application/experiments/pattern-dataset.ts";
import { pairedDifference95, summarizePatternExperiment } from "../src/application/experiments/pattern-report.ts";
import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";

const chess = createChessJsRulesAdapter();
const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("dataset parser freezes a valid JSONL case", () => {
  const result = parsePatternDataset(chess, JSON.stringify({
    caseId: "control-0001",
    split: "evaluation",
    fen: startFen,
    family: "ANASTASIA",
    source: { kind: "fixture", reference: "local-test", license: "test" }
  }), 8, 8);

  expect(result.tag).toBe("Ok");
  expect(result.value).toHaveLength(1);
  expect(result.value[0].position.fen).toBe(startFen);
});

test("dataset parser rejects malformed JSONL before engine work", () => {
  const result = parsePatternDataset(chess, "{not-json}", 8, 8);
  expect(result.tag).toBe("Err");
  expect(result.error.path).toBe("dataset.line.1");
});

test("paired confidence interval is deterministic", () => {
  const interval = pairedDifference95([false, false, true, false], [true, false, true, true]);
  expect(interval.mean).toBe(0.5);
  expect(interval.lower95).toBeLessThan(interval.mean);
  expect(interval.upper95).toBeGreaterThan(interval.mean);
});

test("report stays inconclusive until the required corpus and verifier exist", () => {
  const report = summarizePatternExperiment("test-v1", []);
  expect(report.status).toBe("INCONCLUSIVE");
  expect(report.reason).toContain("300");
});
