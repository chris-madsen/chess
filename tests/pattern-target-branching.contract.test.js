import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { evaluatePatternSteeringCandidates } from "../src/application/use-cases/pattern-steering.ts";
import { deduplicatePatternTargets, rankPatternTargets, registerPatternTarget } from "../src/application/use-cases/pattern-target-branching.ts";
import { makeRequestId, maiaProvider } from "../src/domain/index.ts";

const chess = createChessJsRulesAdapter();
const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};
const start = mustOk(chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));
const candidate = (request, uci, name = "cstal-test") => {
  const move = chess.parseLegalMove(request.position, uci);
  if (move.tag === "Err") return move;
  return { tag: "Ok", value: [{ tag: "CandidateSeed", move: move.value, provenance: {
    source: "LOCAL_STYLE_ENGINE", provider: { name, displayName: name }, status: "ENGINE_GENERATED",
    requestId: makeRequestId(`${name}-${request.lineId}`), inputPositionHash: request.position.hash, configuration: {}
  } }] };
};

test("fixed target keeps every evaluated candidate on one pattern family", async () => {
  const result = mustOk(await evaluatePatternSteeringCandidates(
    chess,
    start,
    async request => {
      const first = candidate(request, "e2e4");
      const second = candidate(request, "d2d4");
      if (first.tag === "Err" || second.tag === "Err") return first.tag === "Err" ? first : second;
      return { tag: "Ok", value: [...first.value, ...second.value] };
    },
    async request => ({ tag: "Ok", value: request.candidates.map(seed => ({ seed, accepted: true })) }),
    async request => {
      const move = chess.parseLegalMove(request.position, "e7e5");
      if (move.tag === "Err") return move;
      return { tag: "Ok", value: { move: move.value, provenance: { source: "MAIA", provider: maiaProvider("test"), status: "MODELED_LOCAL", requestId: makeRequestId("maia-fixed-target"), inputPositionHash: request.position.hash, configuration: {} } } };
    },
    "fixed-target",
    2,
    true,
    undefined,
    "MORPHYS"
  ));
  expect(result.trace.candidates.every(candidateItem => candidateItem.targetFamily === "MORPHYS")).toBe(true);
  expect(result.selected.targetFamily).toBe("MORPHYS");
});

test("target registration trusts discovery calibration, deduplicates, and caps at three", () => {
  const position = start;
  const event = family => ({ targetFamily: family, affinity: 0.4, position, prefixPlies: [] });
  expect(registerPatternTarget([], event("BALESTRA")).accepted).toBe(true);
  let targets = [];
  for (const family of ["BALESTRA", "EPAULETTE", "MORPHYS", "BACK_RANK", "DOVETAIL"]) {
    targets = [...registerPatternTarget(targets, event(family)).targets];
  }
  expect(targets.map(target => target.targetFamily)).toEqual(["BALESTRA", "EPAULETTE", "MORPHYS"]);
  expect(registerPatternTarget(targets, event("MORPHYS")).accepted).toBe(false);
});

test("final target ranking keeps the three shortest terminal continuations", () => {
  const targets = [
    { targetFamily: "ANASTASIA", line: { status: "Terminal", plies: Array(18).fill({}) } },
    { targetFamily: "ARABIAN", line: { status: "Terminal", plies: Array(12).fill({}) } },
    { targetFamily: "BACK_RANK", line: { status: "Terminal", plies: Array(15).fill({}) } },
    { targetFamily: "BODEN", line: { status: "Terminal", plies: Array(6).fill({}) } },
    { targetFamily: "SMOTHERED", line: { status: "Incomplete", plies: Array(2).fill({}) } }
  ];
  expect(rankPatternTargets(targets).map(target => target.targetFamily)).toEqual(["BODEN", "ARABIAN", "BACK_RANK"]);
});

test("final target ranking prefers real HumanPath checkmate over generic terminal", () => {
  const targets = [
    { targetFamily: "ANASTASIA", humanPathMate: false, line: { status: "Terminal", plies: Array(2).fill({}) } },
    { targetFamily: "ARABIAN", humanPathMate: true, line: { status: "Terminal", plies: Array(6).fill({}) } },
    { targetFamily: "BACK_RANK", line: { status: "Incomplete", plies: Array(1).fill({}) } }
  ];
  expect(rankPatternTargets(targets).map(target => target.targetFamily)).toEqual(["ARABIAN", "ANASTASIA", "BACK_RANK"]);
});

test("final target ranking uses full root-to-terminal length, not only the target tail", () => {
  const targets = [
    { targetFamily: "ANASTASIA", humanPathMate: true, fullRootToTerminalPlies: 46, line: { status: "Terminal", plies: Array(6).fill({}) } },
    { targetFamily: "ARABIAN", humanPathMate: true, fullRootToTerminalPlies: 30, line: { status: "Terminal", plies: Array(20).fill({}) } }
  ];
  expect(rankPatternTargets(targets).map(target => target.targetFamily)).toEqual(["ARABIAN", "ANASTASIA"]);
});

test("identical full lines collapse into one target with aliases", () => {
  const line = { status: "Terminal", plies: [{ move: { uci: "e2e4" } }, { move: { uci: "e7e5" } }] };
  const unique = deduplicatePatternTargets([
    { targetFamily: "CORNER", triggerAffinity: 0.97, prefixPlies: [], line },
    { targetFamily: "KILL_BOX", triggerAffinity: 0.98, prefixPlies: [], line },
    { targetFamily: "TRIANGLE", triggerAffinity: 0.97, prefixPlies: [], line }
  ]);
  expect(unique).toHaveLength(1);
  expect(unique[0].targetFamily).toBe("KILL_BOX");
  expect(unique[0].alsoMatches).toEqual(["CORNER", "TRIANGLE"]);
});
