import { parseUciMultiPvRootMove, parseUciScore } from "../src/adapters/uci/uci-engine-adapter.ts";

test("UCI MultiPV parser extracts only numbered root PV moves", () => {
  expect(parseUciMultiPvRootMove("info depth 18 multipv 2 score cp 31 nodes 42 pv d2d4 d7d5")).toEqual({ index: 2, move: "d2d4" });
  expect(parseUciMultiPvRootMove("info depth 18 score cp 31 pv e2e4")).toBeUndefined();
  expect(parseUciMultiPvRootMove("bestmove e2e4")).toBeUndefined();
});

test("UCI tactical parser keeps centipawn and mate scores typed", () => {
  expect(parseUciScore("info depth 18 score cp -72 pv e2e4")).toEqual({ kind: "centipawns", value: -72 });
  expect(parseUciScore("info depth 22 score mate 3 pv e2e4")).toEqual({ kind: "mate", value: 3 });
  expect(parseUciScore("info depth 18 pv e2e4")).toBeUndefined();
});
