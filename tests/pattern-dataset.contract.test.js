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

test("dataset uses trajectory ply 1 as the actual puzzle start", () => {
  const actualSourceFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const source = chess.ingestPosition(actualSourceFen).value;
  const move = chess.parseLegalMove(source, "e2e4");
  const after = chess.applyMove(source, move.value).value;
  const raw = {
    caseId: "actual-start-0001",
    datasetVersion: "test-v2",
    split: "evaluation",
    exampleKind: "positive",
    fen: actualSourceFen,
    family: "BACK_RANK",
    sourcePositionHash: String(source.hash),
    source: { kind: "fixture", reference: "test" },
    trajectory: [{ ply: 0, fen: actualSourceFen, distanceToTerminal: 1 }, { ply: 1, fen: String(after.fen), distanceToTerminal: 0 }]
  };
  const result = parsePatternDataset(chess, JSON.stringify(raw), 1, 1);
  expect(result.tag).toBe("Ok");
  expect(String(result.value[0].position.fen)).toBe(String(after.fen));
});
