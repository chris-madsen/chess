import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { evaluatePatternSteeringCandidates, selectPatternSteeringCandidate } from "../src/wiring/index.ts";
import { makeCandidateSeed } from "../src/domain/scenario-lines/candidate-seed.ts";
import { makeRequestId, maiaProvider, playerProvider } from "../src/domain/index.ts";
import { createInMemoryAnalysisCache } from "../src/adapters/cache/in-memory-analysis-cache.ts";

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
const acceptAll = async request => ({ tag: "Ok", value: request.candidates.map(seed => ({ seed, accepted: true })) });

test("Pattern steering evaluates candidates before selecting a move and preserves attacker side", async () => {
  const result = mustOk(await evaluatePatternSteeringCandidates(
    chess,
    start,
    async () => ({ tag: "Ok", value: [seedFor("e2e4", 1), seedFor("d2d4", 2)] }),
    acceptAll,
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

test("Pattern steering never reuses a Maia response from the analysis cache", async () => {
  const cache = createInMemoryAnalysisCache();
  let maiaCalls = 0;
  const generator = async () => ({ tag: "Ok", value: [seedFor("e2e4", 1)] });
  const maia = async request => {
    maiaCalls += 1;
    const move = chess.parseLegalMove(request.position, "e7e5");
    return move.tag === "Err" ? move : { tag: "Ok", value: {
      move: move.value,
      provenance: {
        source: "MAIA",
        provider: maiaProvider("test"),
        status: "MODELED_LOCAL",
        requestId: makeRequestId(`maia-cache-test-${maiaCalls}`),
        inputPositionHash: request.position.hash,
        configuration: { elo: maiaCalls === 1 ? 600 : 2300 }
      }
    } };
  };

  const first = await evaluatePatternSteeringCandidates(chess, start, generator, acceptAll, maia, "maia-cache-test", 1, true, cache);
  const second = await evaluatePatternSteeringCandidates(chess, start, generator, acceptAll, maia, "maia-cache-test", 1, true, cache);

  expect(first.tag).toBe("Ok");
  expect(second.tag).toBe("Ok");
  expect(maiaCalls).toBe(2);
  expect(second.value.selected.responseProvenance.configuration.elo).toBe(2300);
});

test("Pattern steering rejects candidate provenance from another position", async () => {
  const other = mustOk(chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"));
  const move = mustOk(chess.parseLegalMove(start, "e2e4"));
  const result = await evaluatePatternSteeringCandidates(
    chess,
    start,
    async () => ({ tag: "Ok", value: [{ tag: "CandidateSeed", move, provenance: { source: "PLAYER_IDEA", provider: playerProvider, status: "PLAYER_ENTERED", requestId: makeRequestId("bad-seed"), inputPositionHash: other.hash, configuration: {} } }] }),
    acceptAll,
    async () => ({ tag: "Err", error: { code: "PROVIDER_MALFORMED_OUTPUT", path: "test", message: "not reached" } }),
    "steering-invalid",
    5
  );
  expect(result.tag).toBe("Err");
  expect(result.error.code).toBe("MISSING_PROVENANCE");
});

test("Tal tactical veto removes a candidate before Pattern ranking", async () => {
  const gate = async request => ({ tag: "Ok", value: request.candidates.map(seed => ({
    seed,
    accepted: String(seed.move.uci) === "d2d4",
    ...(String(seed.move.uci) === "e2e4" ? { reason: "TAL_TACTICAL_VETO" } : {})
  })) });
  const result = mustOk(await evaluatePatternSteeringCandidates(
    chess,
    start,
    async () => ({ tag: "Ok", value: [seedFor("e2e4", 1), seedFor("d2d4", 2)] }),
    gate,
    async request => {
      const move = chess.parseLegalMove(request.position, String(request.position.fen).includes("P3") ? "e7e5" : "d7d5");
      return move.tag === "Err" ? move : { tag: "Ok", value: { move: move.value, provenance: {
        source: "MAIA", provider: maiaProvider("test"), status: "MODELED_LOCAL", requestId: makeRequestId("veto-maia"), inputPositionHash: request.position.hash, configuration: {}
      } } };
    },
    "steering-veto",
    5
  ));
  expect(result.candidates.map(candidate => String(candidate.seed.move.uci))).toEqual(["d2d4"]);
  expect(result.selected.tactical.accepted).toBe(true);
});

const steeringCandidate = (uci, afterResponseScore, patternDelta) => ({
  seed: seedFor(uci, uci.length),
  tactical: { seed: seedFor(uci, uci.length), accepted: true },
  afterPosition: start,
  beforeFamilies: [],
  afterFamilies: [],
  postResponseFamilies: [],
  targetFamily: "ANASTASIA",
  beforeScore: afterResponseScore - patternDelta,
  afterCandidateScore: afterResponseScore,
  afterResponseScore,
  patternDelta,
  progress: patternDelta
});

test("steering selects low-affinity attractor progress instead of requiring a display threshold", () => {
  const selected = mustOk(selectPatternSteeringCandidate([
    steeringCandidate("e2e4", 0.19, 0.11),
    steeringCandidate("d2d4", 0.11, 0.03)
  ]));
  expect(selected.seed.move.uci).toBe("e2e4");
  expect(selected.afterResponseScore).toBeLessThan(0.25);
});

test("steering primary policy prefers final affinity over raw delta", () => {
  const selected = mustOk(selectPatternSteeringCandidate([
    steeringCandidate("e2e4", 0.80, 0.10),
    steeringCandidate("d2d4", 0.25, 0.20)
  ]));
  expect(selected.seed.move.uci).toBe("e2e4");
});

test("all negative attractor deltas still return the best Tal-safe candidate", () => {
  const selected = mustOk(selectPatternSteeringCandidate([
    steeringCandidate("e2e4", 0.18, -0.04),
    steeringCandidate("d2d4", 0.16, -0.08)
  ]));
  expect(selected.seed.move.uci).toBe("e2e4");
});
