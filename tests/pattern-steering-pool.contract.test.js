import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { candidateGeneratorFromProviders, composeCandidateGenerators, runSteeredRollout, runSteeredRolloutArtifact } from "../src/wiring/index.ts";
import { evaluatePatternSteeringCandidates } from "../src/application/use-cases/pattern-steering.ts";
import { makeRequestId, maiaProvider, stockfishProvider } from "../src/domain/index.ts";

const chess = createChessJsRulesAdapter();
const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};
const start = mustOk(chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));
const provider = (uci, source, identity) => async request => {
  const move = chess.parseLegalMove(request.position, uci);
  if (move.tag === "Err") return move;
  return { tag: "Ok", value: { move: move.value, provenance: {
    source, provider: identity, status: source === "MAIA" ? "MODELED_LOCAL" : "ENGINE_GENERATED",
    requestId: makeRequestId(`${identity.name}-${request.ply}`), inputPositionHash: request.position.hash, configuration: {}
  } } };
};

test("candidate pool deduplicates legal provider moves and keeps provenance", async () => {
  const generator = candidateGeneratorFromProviders(chess, [
    provider("e2e4", "LOCAL_STYLE_ENGINE", { name: "patricia", displayName: "Patricia" }),
    provider("e2e4", "LOCAL_STYLE_ENGINE", { name: "absurd", displayName: "ABSURD" }),
    provider("d2d4", "LOCAL_STYLE_ENGINE", { name: "extreme", displayName: "EXTREME" })
  ]);
  const result = mustOk(await generator({ position: start, lineId: "pool", limit: 3 }));
  expect(result.map(candidate => String(candidate.move.uci))).toEqual(["e2e4", "d2d4"]);
  expect(result.every(candidate => candidate.provenance.inputPositionHash === start.hash)).toBe(true);
});

test("composed candidate pool takes Patricia-style roots before style-engine roots", async () => {
  const make = (uci, name) => async request => {
    const move = chess.parseLegalMove(request.position, uci);
    return move.tag === "Err" ? move : { tag: "Ok", value: [{ tag: "CandidateSeed", move: move.value, provenance: {
      source: "LOCAL_STYLE_ENGINE", provider: { name, displayName: name }, status: "ENGINE_GENERATED",
      requestId: makeRequestId(`${name}-${request.lineId}`), inputPositionHash: request.position.hash, configuration: {}
    } }] };
  };
  const result = mustOk(await composeCandidateGenerators(chess, [make("e2e4", "patricia-multipv"), make("e2e4", "cstal-absurd"), make("d2d4", "cstal-extreme")])({ position: start, lineId: "compose", limit: 3 }));
  expect(result.map(candidate => String(candidate.move.uci))).toEqual(["e2e4", "d2d4"]);
  expect(result[0].provenance.provider.name).toBe("patricia-multipv");
});

test("steered rollout delegates subsequent plies to HumanPath after selection", async () => {
  const maia = provider("e7e5", "MAIA", maiaProvider("test"));
  const stockfish = provider("g1f3", "STOCKFISH", stockfishProvider("test"));
  const seedProvider = provider("e2e4", "LOCAL_STYLE_ENGINE", { name: "patricia", displayName: "Patricia" });
  const seed = mustOk(await seedProvider({ position: start, lineId: "rollout", ply: 1 }));
  const decision = mustOk(await evaluatePatternSteeringCandidates(
    chess,
    start,
    async () => ({ tag: "Ok", value: [{ tag: "CandidateSeed", move: seed.move, provenance: seed.provenance }] }),
    maia,
    "rollout",
    2
  ));
  const line = mustOk(await runSteeredRollout({
    chess, start, decision, lineId: "rollout", providers: { maia, stockfish }, horizon: 3
  }));
  expect(line.plies).toHaveLength(3);
  expect(line.plies[0].provenance.inputPositionHash).toBe(start.hash);
  expect(line.plies[1].provenance.source).toBe("MAIA");
  expect(line.plies[2].provenance.source).toBe("STOCKFISH");
});

test("steered rollout artifact keeps independent forced-mate verification separate", async () => {
  const maia = provider("e7e5", "MAIA", maiaProvider("test"));
  const stockfish = provider("g1f3", "STOCKFISH", stockfishProvider("test"));
  const seedProvider = provider("e2e4", "LOCAL_STYLE_ENGINE", { name: "patricia", displayName: "Patricia" });
  const seed = mustOk(await seedProvider({ position: start, lineId: "artifact", ply: 1 }));
  const decision = mustOk(await evaluatePatternSteeringCandidates(chess, start, async () => ({ tag: "Ok", value: [{ tag: "CandidateSeed", move: seed.move, provenance: seed.provenance }] }), maia, "artifact", 2));
  const artifact = mustOk(await runSteeredRolloutArtifact({ chess, start, decision, lineId: "artifact", providers: { maia, stockfish }, horizon: 3 }, async request => ({
    tag: "Ok",
    value: { status: "NOT_VERIFIED", provider: "test-verifier", limits: { depth: 1 }, terminalPositionHash: String(request.terminalPosition.hash) }
  })));
  expect(artifact.decision.selected.seed.move.uci).toBe("e2e4");
  expect(artifact.forcedMate.status).toBe("NOT_VERIFIED");
});
