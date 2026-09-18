import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { evaluatePatternSteeringCandidates } from "../src/wiring/index.ts";
import { makeCandidateSeed } from "../src/domain/scenario-lines/candidate-seed.ts";
import { makeRequestId, maiaProvider, playerProvider } from "../src/domain/index.ts";

const chess = createChessJsRulesAdapter();
const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

const start = mustOk(chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));
const seedFor = (uci, index) => makeCandidateSeed(mustOk(chess.parseLegalMove(start, uci)), {
  source: "PLAYER_IDEA",
  provider: playerProvider,
  status: "PLAYER_ENTERED",
  requestId: makeRequestId(`seed-${index}`),
  inputPositionHash: start.hash,
  configuration: {}
}).value;

test("Pattern steering evaluates candidates before selecting a move and preserves attacker side", async () => {
  const result = mustOk(await evaluatePatternSteeringCandidates(
    chess,
    start,
    async () => ({ tag: "Ok", value: [seedFor("e2e4", 1), seedFor("d2d4", 2)] }),
    async request => {
      const rawMove = String(request.position.fen).includes("4P3") ? "e7e5" : "d7d5";
      const move = chess.parseLegalMove(request.position, rawMove);
      return move.tag === "Err" ? move : {
        tag: "Ok",
        value: {
          move: move.value,
          provenance: {
            source: "MAIA",
            provider: maiaProvider("test"),
            status: "MODELED_LOCAL",
            requestId: makeRequestId(`maia-${request.ply}`),
            inputPositionHash: request.position.hash,
            configuration: { elo: 1800 }
          }
        }
      };
    },
    "steering-test",
    5
  ));
  expect(result.attackerSide).toBe("white");
  expect(result.candidates).toHaveLength(2);
  expect(result.selected.seed.provenance.inputPositionHash).toBe(start.hash);
  expect(result.selected.afterPosition.sideToMove).toBe("black");
});

test("Pattern steering rejects candidate provenance from another position", async () => {
  const other = mustOk(chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"));
  const move = mustOk(chess.parseLegalMove(start, "e2e4"));
  const result = await evaluatePatternSteeringCandidates(
    chess,
    start,
    async () => ({ tag: "Ok", value: [{ tag: "CandidateSeed", move, provenance: { source: "PLAYER_IDEA", provider: playerProvider, status: "PLAYER_ENTERED", requestId: makeRequestId("bad-seed"), inputPositionHash: other.hash, configuration: {} } }] }),
    async () => ({ tag: "Err", error: { code: "PROVIDER_MALFORMED_OUTPUT", path: "test", message: "not reached" } }),
    "steering-invalid",
    5
  );
  expect(result.tag).toBe("Err");
  expect(result.error.code).toBe("MISSING_PROVENANCE");
});
