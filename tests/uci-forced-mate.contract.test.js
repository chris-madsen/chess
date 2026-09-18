import { parseUciMateScore } from "../src/wiring/index.ts";

test("UCI forced-mate parser accepts positive and negative mate scores", () => {
  expect(parseUciMateScore("info depth 18 score mate 3 pv e2e4")).toBe(3);
  expect(parseUciMateScore("info depth 18 score mate -2 pv e7e5")).toBe(-2);
  expect(parseUciMateScore("info depth 18 score cp 42 pv e2e4")).toBeUndefined();
});
