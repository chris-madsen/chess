import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { candidateGeneratorFromProviders, composeCandidateGenerators, generatePatternSteeredTalPath, runSteeredRollout, runSteeredRolloutArtifact } from "../src/wiring/index.ts";
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
const acceptAll = async request => ({ tag: "Ok", value: request.candidates.map(seed => ({ seed, accepted: true })) });

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

test("Tal gate filters Patricia but never vetoes trusted CSTal candidates", async () => {
  const cstal = provider("e2e4", "LOCAL_STYLE_ENGINE", { name: "cstal-absurd", displayName: "CSTal ABSURD" });
  const patricia = provider("d2d4", "LOCAL_STYLE_ENGINE", { name: "patricia", displayName: "Patricia" });
  const generator = async request => {
    const absurd = await cstal(request);
    const broad = await patricia(request);
    if (absurd.tag === "Err") return absurd;
    if (broad.tag === "Err") return broad;
    return { tag: "Ok", value: [absurd.value, broad.value] };
  };
  const seenByGate = [];
  const rejectExternal = async request => {
    seenByGate.push(...request.candidates);
    return { tag: "Ok", value: request.candidates.map(seed => ({ seed, accepted: false, reason: "REJECTED_BY_TAL_GATE" })) };
  };
  const maia = provider("e7e5", "MAIA", maiaProvider("test"));
  const decision = mustOk(await evaluatePatternSteeringCandidates(
    chess,
    start,
    generator,
    rejectExternal,
    maia,
    "source-aware-gate",
    2
  ));

  expect(seenByGate.map(seed => seed.provenance.provider.name)).toEqual(["patricia"]);
  expect(decision.selected.seed.provenance.provider.name).toBe("cstal-absurd");
  expect(decision.trace.candidates.some(candidate => candidate.uci === "d2d4")).toBe(false);
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

test("mandatory CSTal candidates are reserved against Patricia starvation", async () => {
  const make = (uci, name) => async request => {
    const move = chess.parseLegalMove(request.position, uci);
    return move.tag === "Err" ? move : { tag: "Ok", value: [{ tag: "CandidateSeed", move: move.value, provenance: {
      source: "LOCAL_STYLE_ENGINE", provider: { name, displayName: name }, status: "ENGINE_GENERATED",
      requestId: makeRequestId(`${name}-${request.lineId}`), inputPositionHash: request.position.hash, configuration: {}
    } }] };
  };
  const result = mustOk(await composeCandidateGenerators(chess, [
    { generator: make("e2e4", "patricia"), budget: 2 },
    { generator: make("c2c4", "cstal-absurd"), budget: 1, mandatory: true },
    { generator: make("d2d4", "cstal-extreme"), budget: 1, mandatory: true }
  ])({ position: start, lineId: "mandatory", limit: 3 }));
  expect(result.map(candidate => String(candidate.move.uci))).toEqual(["c2c4", "d2d4", "e2e4"]);
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
    acceptAll,
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
  const decision = mustOk(await evaluatePatternSteeringCandidates(chess, start, async () => ({ tag: "Ok", value: [{ tag: "CandidateSeed", move: seed.move, provenance: seed.provenance }] }), acceptAll, maia, "artifact", 2));
  const artifact = mustOk(await runSteeredRolloutArtifact({ chess, start, decision, lineId: "artifact", providers: { maia, stockfish }, horizon: 3 }, async request => ({
    tag: "Ok",
    value: { status: "NOT_VERIFIED", provider: "test-verifier", limits: { depth: 1 }, terminalPositionHash: String(request.terminalPosition.hash) }
  })));
  expect(artifact.decision.selected.seed.move.uci).toBe("e2e4");
  expect(artifact.forcedMate.status).toBe("NOT_VERIFIED");
});

test("PatternSteeredTalPath repeats Tal-gated attacker plies around Maia plies", async () => {
  let gateCalls = 0;
  let maiaCalls = 0;
  const seed = (request, uci) => {
    const move = chess.parseLegalMove(request.position, uci);
    if (move.tag === "Err") return move;
    return { tag: "Ok", value: [{ tag: "CandidateSeed", move: move.value, provenance: {
      source: "LOCAL_STYLE_ENGINE", provider: { name: "cstal-test", displayName: "CSTal test", version: "test" }, status: "ENGINE_GENERATED",
      requestId: makeRequestId(`tal-${request.ply}`), inputPositionHash: request.position.hash, configuration: { role: "candidate" }
    } }] };
  };
  const generator = async request => {
    const preferred = request.position.hash === start.hash ? "e2e4" : ["g1f3", "c2c4", "b1c3"].find(uci => chess.parseLegalMove(request.position, uci).tag === "Ok") ?? String(request.position.legalMoves[0]?.uci);
    return seed(request, preferred);
  };
  const gate = async request => { gateCalls += 1; return { tag: "Ok", value: request.candidates.map(candidate => ({ seed: candidate, accepted: true })) }; };
  const maia = async request => {
    maiaCalls += 1;
    const rawMove = ["e7e5", "d7d5", "c7c5", "g8f6"].find(uci => chess.parseLegalMove(request.position, uci).tag === "Ok") ?? String(request.position.legalMoves[0]?.uci);
    const move = chess.parseLegalMove(request.position, rawMove);
    if (move.tag === "Err") return move;
    return { tag: "Ok", value: { move: move.value, provenance: { source: "MAIA", provider: maiaProvider("test"), status: "MODELED_LOCAL", requestId: makeRequestId(`maia-path-${maiaCalls}`), inputPositionHash: request.position.hash, configuration: {} } } };
  };
  const line = mustOk(await generatePatternSteeredTalPath({ chess, start, attackerSide: "white", generator, tacticalGate: gate, maia, lineId: "iterative", horizon: 5, candidateLimit: 2 }));
  expect(line.plies).toHaveLength(5);
  expect(line.plies.map(ply => ply.provenance.source)).toEqual(["LOCAL_STYLE_ENGINE", "MAIA", "LOCAL_STYLE_ENGINE", "MAIA", "LOCAL_STYLE_ENGINE"]);
  expect(gateCalls).toBe(3);
  expect(maiaCalls).toBe(2);
});

test("checkmating candidate is terminal and never calls Maia", async () => {
  const mateStart = mustOk(chess.ingestPosition("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1"));
  const line = mustOk(await generatePatternSteeredTalPath({
    chess,
    start: mateStart,
    attackerSide: "white",
    generator: async request => {
      const move = chess.parseLegalMove(request.position, "f7e8");
      if (move.tag === "Err") return move;
      return { tag: "Ok", value: [{ tag: "CandidateSeed", move: move.value, provenance: {
        source: "LOCAL_STYLE_ENGINE", provider: { name: "cstal-test", displayName: "CSTal test" }, status: "ENGINE_GENERATED",
        requestId: makeRequestId("mate-candidate"), inputPositionHash: request.position.hash, configuration: {}
      } }] };
    },
    tacticalGate: async request => ({ tag: "Ok", value: request.candidates.map(seed => ({ seed, accepted: true, talScore: { kind: "mate", value: 1, bound: "exact" } })) }),
    maia: async () => ({ tag: "Err", error: { code: "PROVIDER_MALFORMED_OUTPUT", path: "test.maia", message: "Maia must not be called after mate" } }),
    lineId: "mate-terminal",
    horizon: 2
  }));
  expect(line.status).toBe("Terminal");
  expect(line.plies).toHaveLength(1);
  expect(line.plies[0].move.san).toBe("Qe8#");
});
