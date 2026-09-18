import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { MATE_PATTERN_SOURCE_CATALOG } from "../src/application/experiments/mate-pattern-catalog.ts";
import { STEERABLE_PATTERN_FAMILY_IDS } from "../src/domain/patterns/pattern.ts";

const chess = createChessJsRulesAdapter();

test("every steerable mate pattern has a local reference example", () => {
  const references = MATE_PATTERN_SOURCE_CATALOG.filter(item => item.reference !== undefined);
  expect(references.map(item => item.family).sort()).toEqual([...STEERABLE_PATTERN_FAMILY_IDS].sort());
});

test("reference solution moves are legal from their FEN and PGN preserves black starts", () => {
  for (const item of MATE_PATTERN_SOURCE_CATALOG.filter(candidate => candidate.reference !== undefined)) {
    const reference = item.reference;
    const position = chess.ingestPosition(reference.fen);
    expect(position.tag).toBe("Ok");
    let current = position.value;
    for (const uci of reference.solutionMoves) {
      const move = chess.parseLegalMove(current, uci);
      expect(move.tag).toBe("Ok");
      const next = chess.applyMove(current, move.value);
      expect(next.tag).toBe("Ok");
      current = next.value;
    }
    expect(reference.pgn).toContain(`[FEN "${reference.fen}"]`);
    expect(reference.pgn).toContain("[Pattern ");
  }
  const anastasia = MATE_PATTERN_SOURCE_CATALOG.find(item => item.family === "ANASTASIA").reference;
  expect(anastasia.pgn).toContain("22... Kxh7 23. Rh1#");
});
