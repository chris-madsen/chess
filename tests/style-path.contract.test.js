import {
  createChessJsRulesAdapter,
  generateStylePaths
} from "../src/wiring/index.ts";
import {
  domainError,
  isErr,
  makeRequestId,
  makeScenarioHorizon,
  maiaProvider,
  localStyleEngineProvider
} from "../src/domain/index.ts";

const chess = createChessJsRulesAdapter();
const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const rawLine = "1. e4 c5 2. Nc3 d6 3. g3 g6 4. Bg2 Bg7 5. h3 Nf6 6. Nge2 O-O 7. O-O Nc6 8. Kh2 a6 9. d3 b5 10. f4 Bb7 11. a3 Qc7 12. g4 e6 13. Ng3 Nd4 14. f5 exf5 15. gxf5 d5 16. Bf4 Qd7";

const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

const provenance = (source, provider, position, requestId = "request-1") => ({
  source,
  provider,
  status: source === "MAIA" ? "MODELED_LOCAL" : "ENGINE_GENERATED",
  requestId: makeRequestId(requestId),
  inputPositionHash: position.hash,
  configuration: { test: true }
});

const providerFromMoves = (source, providerIdentity, moves, requestId) => {
  const calls = [];
  const provider = async request => {
    calls.push(request);
    const rawMove = moves[request.ply];
    if (rawMove === undefined) {
      return { tag: "Err", error: domainError("PROVIDER_MALFORMED_OUTPUT", providerIdentity.name, "missing scripted move") };
    }
    const parsed = chess.parseLegalMove(request.position, rawMove);
    if (isErr(parsed)) {
      return parsed;
    }
    return {
      tag: "Ok",
      value: {
        move: parsed.value,
        provenance: provenance(source, providerIdentity, request.position, `${requestId}-${request.ply}`)
      }
    };
  };
  provider.calls = calls;
  return provider;
};

const fakeStyleEngine = (key, displayName, moves, configuration = { test: true }) => ({
  key,
  source: "LOCAL_STYLE_ENGINE",
  identity: localStyleEngineProvider(key, displayName, "test"),
  configuration,
  provideMove: providerFromMoves("LOCAL_STYLE_ENGINE", localStyleEngineProvider(key, displayName, "test"), moves, key)
});

test("local StylePath FEN input creates three engine lines", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const maia = providerFromMoves("MAIA", maiaProvider(), { 2: "e7e5" }, "maia");
  const result = await generateStylePaths(chess, {
    maia,
    styleEngines: [
      fakeStyleEngine("patricia", "Patricia", { 1: "e2e4" }),
      fakeStyleEngine("jackal", "Jackal", { 1: "d2d4" }),
      fakeStyleEngine("seer", "Seer", { 1: "g1f3" })
    ]
  }, {
    lineId: "style-start",
    start: position,
    horizon: mustOk(makeScenarioHorizon(1))
  });
  const lines = mustOk(result);
  expect(lines).toHaveLength(3);
  expect(lines.map(line => line.line.label)).toEqual(["Patricia StylePath", "Jackal StylePath", "Seer StylePath"]);
  expect(lines.every(line => line.line.mode === "StylePath")).toBe(true);
});


test("local StylePath honors per-engine style depth override", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const style = fakeStyleEngine("jackal", "Jackal", { 1: "e2e4" }, { test: true, styleDepth: 10 });
  const maia = providerFromMoves("MAIA", maiaProvider(), { 2: "e7e5" }, "maia");
  const lines = mustOk(await generateStylePaths(chess, {
    maia,
    styleEngines: [style]
  }, {
    lineId: "style-depth-override",
    start: position,
    horizon: mustOk(makeScenarioHorizon(1)),
    styleDepth: 13
  }));
  expect(lines[0].styleDepth).toBe(10);
  expect(style.provideMove.calls[0].searchLimit).toEqual({ tag: "Depth", depth: 10 });
});

test("RAW SAN file text reaches expected final position and side-to-move", () => {
  const rawPosition = mustOk(chess.ingestRawGame(rawLine));
  const fenPosition = mustOk(chess.ingestPosition("r4rk1/1b1q1pbp/p4np1/1ppp1P2/3nPB2/P1NP2NP/1PP3BK/R2Q1R2 w - - 2 17"));
  expect(String(rawPosition.fen)).toBe(String(fenPosition.fen));
  expect(rawPosition.sideToMove).toBe("white");
});

test("local StylePath source order is style engine, Maia, style engine, Maia", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const style = fakeStyleEngine("patricia", "Patricia", { 1: "e2e4", 3: "g1f3" });
  const maia = providerFromMoves("MAIA", maiaProvider(), { 2: "e7e5", 4: "b8c6" }, "maia");
  const lines = mustOk(await generateStylePaths(chess, {
    maia,
    styleEngines: [style]
  }, {
    lineId: "style-order",
    start: position,
    horizon: mustOk(makeScenarioHorizon(4))
  }));
  const line = lines[0].line;
  expect(line.status).toBe("Complete");
  expect(line.plies.map(ply => ply.provenance.source)).toEqual(["LOCAL_STYLE_ENGINE", "MAIA", "LOCAL_STYLE_ENGINE", "MAIA"]);
  expect(style.provideMove.calls.map(call => call.position.sideToMove)).toEqual(["white", "white"]);
  expect(maia.calls.map(call => call.position.sideToMove)).toEqual(["black", "black"]);
});

test("one style engine timeout creates one incomplete line without hiding other lines", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const failing = {
    key: "patricia",
    source: "LOCAL_STYLE_ENGINE",
    identity: localStyleEngineProvider("patricia", "Patricia", "test"),
    configuration: {},
    provideMove: async () => ({ tag: "Err", error: domainError("PROVIDER_TIMEOUT", "patricia", "timeout") })
  };
  const okEngine = fakeStyleEngine("seer", "Seer", { 1: "e2e4" });
  const maia = providerFromMoves("MAIA", maiaProvider(), { 2: "e7e5" }, "maia");
  const lines = mustOk(await generateStylePaths(chess, {
    maia,
    styleEngines: [failing, okEngine]
  }, {
    lineId: "style-isolated-failure",
    start: position,
    horizon: mustOk(makeScenarioHorizon(1))
  }));
  expect(lines.map(line => line.line.status)).toEqual(["Incomplete", "Complete"]);
  expect(lines[0].line.plies).toHaveLength(0);
  expect(lines[0].line.error.code).toBe("PROVIDER_TIMEOUT");
});

test("invalid RAW SAN rejects before providers", async () => {
  const result = chess.ingestRawGame("1. e4 e5 2. IllegalMove");
  expect(result.tag).toBe("Err");
  expect(result.error.code).toBe("INVALID_RAW_GAME");
});
