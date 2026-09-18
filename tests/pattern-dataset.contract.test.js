import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { parsePatternDataset } from "../src/application/experiments/pattern-dataset.ts";

const chess = createChessJsRulesAdapter();

const sourceFen = "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1";
const sourceHash = String(chess.ingestPosition(sourceFen).value.hash);

test("dataset ingest preserves trajectory and ground truth", () => {
  const raw = {
    caseId: "trajectory-0001",
    datasetVersion: "test-v2",
    split: "evaluation",
    exampleKind: "positive",
    fen: sourceFen,
    family: "BACK_RANK",
    sourcePositionHash: sourceHash,
    source: { kind: "fixture", reference: "test" },
    solutionMoves: [],
    trajectory: [{ ply: 0, fen: sourceFen, distanceToTerminal: 0 }],
    expected: { terminalMate: true, mateLength: 0, terminalFamily: "BACK_RANK" }
  };
  const result = parsePatternDataset(chess, JSON.stringify(raw), 1, 1);
  expect(result.tag).toBe("Ok");
  expect(result.value[0].solutionMoves).toEqual([]);
  expect(result.value[0].trajectory).toEqual(raw.trajectory);
  expect(result.value[0].expected).toEqual(raw.expected);
});

test("dataset ingest normalizes legacy solution move strings", () => {
  const raw = {
    caseId: "legacy-0001",
    datasetVersion: "test-v1",
    split: "calibration",
    exampleKind: "control",
    fen: sourceFen,
    family: "ANASTASIA",
    sourcePositionHash: sourceHash,
    source: { kind: "fixture", reference: "test" },
    solutionMoves: "e8e7 g7e5"
  };
  const result = parsePatternDataset(chess, JSON.stringify(raw), 1, 1);
  expect(result.tag).toBe("Ok");
  expect(result.value[0].solutionMoves).toEqual(["e8e7", "g7e5"]);
});
