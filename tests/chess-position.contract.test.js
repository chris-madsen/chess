import { createChessJsRulesAdapter } from "../src/wiring/index.ts";

const chess = createChessJsRulesAdapter();
const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

test("position intelligence validates FEN and computes side to move", () => {
  const position = mustOk(chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));
  expect(position.sideToMove).toBe("white");
  expect(position.legalMoves.length).toBe(20);
});

test("position intelligence parses SAN and UCI legal moves", () => {
  const position = mustOk(chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));
  expect(chess.parseLegalMove(position, "e4").tag).toBe("Ok");
  expect(chess.parseLegalMove(position, "e2e4").tag).toBe("Ok");
  expect(chess.parseLegalMove(position, "e2e5").tag).toBe("Err");
});

test("position facts include material checks captures and terminal status", () => {
  const position = mustOk(chess.ingestPosition("4k3/8/8/8/8/8/8/4K2r w - - 0 1"));
  const facts = mustOk(chess.computeFacts(position));
  expect(facts.isCheck).toBe(true);
  expect(facts.isTerminal).toBe(false);
  expect(facts.material.white.k).toBe(1);
});

test("position facts include legal captures", () => {
  const position = mustOk(chess.ingestPosition("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2"));
  const facts = mustOk(chess.computeFacts(position));
  expect(facts.legalCaptures.length).toBeGreaterThan(0);
});

test("position facts detect checkmate terminal state", () => {
  const position = mustOk(chess.ingestPosition("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"));
  const facts = mustOk(chess.computeFacts(position));
  expect(facts.isCheckmate).toBe(true);
  expect(facts.isTerminal).toBe(true);
});
