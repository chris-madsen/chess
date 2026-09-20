import { defaultPatternHorizonMoves } from "../src/cli/pattern-steering-options.ts";

test("raw-game pattern steering uses the normal StylePath conversion horizon", () => {
  expect(defaultPatternHorizonMoves("game.txt")).toBe(34);
  expect(defaultPatternHorizonMoves(undefined)).toBe(8);
});
