import { defaultPatternHorizonMoves } from "../src/cli/pattern-steering-options.ts";

test("raw-game pattern steering defaults to a long mate-search horizon", () => {
  expect(defaultPatternHorizonMoves("game.txt")).toBe(80);
  expect(defaultPatternHorizonMoves(undefined)).toBe(8);
});
