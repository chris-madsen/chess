import { Chess } from "chess.js";
import { controlledHardNegative } from "../scripts/pattern-hard-negative.js";

test("controlled hard negative removes the target-family critical piece", () => {
  const source = "4r1k1/5ppp/p1p5/p1n1RP2/8/2P2N1P/2P3P1/3R2K1 b - - 0 21";
  const result = controlledHardNegative(source, "BACK_RANK");
  expect(result).toBeDefined();
  expect(result.transformation).toBe("REMOVE_CRITICAL_PIECE");
  expect(result.piece.endsWith("p")).toBe(true);
  expect(result.fen).not.toBe(source);
  expect(new Chess(result.fen).isCheckmate()).toBe(false);
});
