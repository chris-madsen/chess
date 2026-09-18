import { parseUciMultiPvRootMove, parseUciScore, createUciPostMoveTacticalGate, createUciTacticalGate, compareEngineScoresForAttacker, normalizeScoreToAttacker } from "../src/adapters/uci/uci-engine-adapter.ts";
import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { makeCandidateSeed } from "../src/domain/scenario-lines/candidate-seed.ts";
import { makeRequestId, localStyleEngineProvider } from "../src/domain/index.ts";

test("UCI MultiPV parser extracts only numbered root PV moves", () => {
  expect(parseUciMultiPvRootMove("info depth 18 multipv 2 score cp 31 nodes 42 pv d2d4 d7d5")).toEqual({ index: 2, move: "d2d4" });
  expect(parseUciMultiPvRootMove("info depth 18 score cp 31 pv e2e4")).toBeUndefined();
  expect(parseUciMultiPvRootMove("bestmove e2e4")).toBeUndefined();
});

test("UCI tactical parser keeps centipawn and mate scores typed", () => {
  expect(parseUciScore("info depth 18 score cp -72 pv e2e4")).toEqual({ kind: "centipawns", value: -72, bound: "exact" });
  expect(parseUciScore("info depth 22 score mate 3 pv e2e4")).toEqual({ kind: "mate", value: 3, bound: "exact" });
  expect(parseUciScore("info depth 22 score cp 40 lowerbound pv e2e4")).toEqual({ kind: "centipawns", value: 40, bound: "lower" });
  expect(parseUciScore("info depth 18 pv e2e4")).toBeUndefined();
});

test("tactical gate rejects an engine that does not honor searchmoves", async () => {
  const chess = createChessJsRulesAdapter();
  const position = chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  expect(position.tag).toBe("Ok");
  const move = chess.parseLegalMove(position.value, "e2e4");
  expect(move.tag).toBe("Ok");
  const seed = makeCandidateSeed(move.value, {
    source: "LOCAL_STYLE_ENGINE",
    provider: localStyleEngineProvider("cstal-test", "CSTal test", "test"),
    status: "ENGINE_GENERATED",
    requestId: makeRequestId("searchmoves-test"),
    inputPositionHash: position.value.hash,
    configuration: {}
  });
  expect(seed.tag).toBe("Ok");
  const script = "process.stdin.setEncoding('utf8'); process.stdin.on('data', data => { for (const line of data.split(/\\r?\\n/u)) { if (line === 'uci') process.stdout.write('uciok\\n'); else if (line === 'isready') process.stdout.write('readyok\\n'); else if (line.startsWith('go ')) process.stdout.write('info depth 1 score cp 100 pv d2d4\\nbestmove d2d4\\n'); } });";
  const gate = createUciTacticalGate(chess, {
    key: "cstal-test",
    command: process.execPath,
    args: ["-e", script],
    identity: localStyleEngineProvider("cstal-test", "CSTal test", "test"),
    source: "LOCAL_STYLE_ENGINE",
    options: [],
    limit: { tag: "Depth", depth: 1 },
    timeoutMs: 2_000,
    configuration: {},
    supportsSearchMoves: true
  }, { allowedLossCentipawns: 100, minCentipawns: -150 });
  try {
    const result = await gate({ position: position.value, candidates: [seed.value], lineId: "searchmoves-test" });
    expect(result.tag).toBe("Err");
    expect(result.error.code).toBe("PROVIDER_MALFORMED_OUTPUT");
  } finally {
    gate.dispose?.();
  }
});

test("post-move Tal gate evaluates the position after the candidate without searchmoves", async () => {
  const chess = createChessJsRulesAdapter();
  const position = chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  expect(position.tag).toBe("Ok");
  const move = chess.parseLegalMove(position.value, "e2e4");
  expect(move.tag).toBe("Ok");
  const seed = makeCandidateSeed(move.value, {
    source: "LOCAL_STYLE_ENGINE",
    provider: localStyleEngineProvider("cstal-test", "CSTal test", "test"),
    status: "ENGINE_GENERATED",
    requestId: makeRequestId("post-move-test"),
    inputPositionHash: position.value.hash,
    configuration: {}
  });
  expect(seed.tag).toBe("Ok");
  const script = "process.stdin.setEncoding('utf8'); process.stdin.on('data', data => { for (const line of data.split(/\\r?\\n/u)) { if (line === 'uci') process.stdout.write('uciok\\n'); else if (line === 'isready') process.stdout.write('readyok\\n'); else if (line.startsWith('position ')) process.stdout.write('info string ' + line + '\\n'); else if (line.startsWith('go ')) process.stdout.write('info depth 1 score cp -120 pv d7d5\\nbestmove d7d5\\n'); } });";
  const gate = createUciPostMoveTacticalGate(chess, {
    key: "cstal-test",
    command: process.execPath,
    args: ["-e", script],
    identity: localStyleEngineProvider("cstal-test", "CSTal test", "test"),
    source: "LOCAL_STYLE_ENGINE",
    options: [],
    limit: { tag: "Depth", depth: 1 },
    timeoutMs: 2_000,
    configuration: {},
    searchMovesCapability: "UNSUPPORTED",
    scorePerspective: "SIDE_TO_MOVE"
  }, { allowedLossCentipawns: 100, minCentipawns: -150 });
  try {
    const result = await gate({ position: position.value, attackerSide: "white", candidates: [seed.value], lineId: "post-move-test" });
    expect(result.tag).toBe("Ok");
    expect(result.value[0].accepted).toBe(true);
    expect(result.value[0].talScore).toMatchObject({ kind: "centipawns", value: 120 });
  } finally {
    gate.dispose?.();
  }
});

test("attacker score normalization and mate ordering are explicit", () => {
  expect(normalizeScoreToAttacker({ kind: "centipawns", value: -120, bound: "exact" }, "SIDE_TO_MOVE", "black", "white")).toMatchObject({ kind: "centipawns", value: 120 });
  expect(normalizeScoreToAttacker({ kind: "mate", value: -2, bound: "exact" }, "SIDE_TO_MOVE", "black", "white")).toMatchObject({ kind: "mate", value: 2 });
  expect(compareEngineScoresForAttacker({ kind: "mate", value: 1 }, { kind: "mate", value: 3 })).toBeGreaterThan(0);
  expect(compareEngineScoresForAttacker({ kind: "mate", value: -5 }, { kind: "mate", value: -2 })).toBeGreaterThan(0);
  expect(compareEngineScoresForAttacker({ kind: "mate", value: 1 }, { kind: "centipawns", value: 1000 })).toBeGreaterThan(0);
});
