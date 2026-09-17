import {
  analyzeStyleLinesApi,
  startStyleLinesApiServer
} from "../src/api/style-lines-http.ts";
import { createChessJsRulesAdapter } from "../src/wiring/index.ts";
import {
  domainError,
  isErr,
  localStyleEngineProvider,
  maiaProvider,
  makeRequestId
} from "../src/domain/index.ts";

const chess = createChessJsRulesAdapter();
const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

const providerFromMoves = (source, providerIdentity, moves, calls = []) => async request => {
  calls.push(request);
  const rawMove = moves[request.ply];
  if (rawMove === undefined) {
    return { tag: "Err", error: domainError("PROVIDER_MALFORMED_OUTPUT", providerIdentity.name, "missing scripted move") };
  }
  const parsed = chess.parseLegalMove(request.position, rawMove);
  if (isErr(parsed)) return parsed;
  return {
    tag: "Ok",
    value: {
      move: parsed.value,
      provenance: {
        source,
        provider: providerIdentity,
        status: source === "MAIA" ? "MODELED_LOCAL" : "ENGINE_GENERATED",
        requestId: makeRequestId(`${providerIdentity.name}-${request.ply}`),
        inputPositionHash: request.position.hash,
        configuration: { test: true }
      }
    }
  };
};

const testPorts = (calls = []) => ({
  chess,
  providers: {
    maia: providerFromMoves("MAIA", maiaProvider("test-maia"), { 2: "e7e5" }, calls),
    styleEngines: [{
      key: "cstal-absurd-maia3",
      source: "LOCAL_STYLE_ENGINE",
      identity: localStyleEngineProvider("cstal-absurd", "CSTal ABSURD", "test"),
      configuration: { styleDepth: 14 },
      label: "CSTal ABSURD vs Maia3 79M StylePath",
      provideMove: providerFromMoves("LOCAL_STYLE_ENGINE", localStyleEngineProvider("cstal-absurd", "CSTal ABSURD", "test"), { 1: "e2e4" }, calls)
    }]
  },
  nowIso: () => "2026-09-17T12:00:00.000Z"
});

test("StylePath API returns structured CSTal and Maia lines with provenance", async () => {
  const result = await analyzeStyleLinesApi({
    fen: startFen,
    horizonMoves: 1,
    includeRenderedText: true
  }, testPorts());
  const body = mustOk(result);

  expect(body.generatedAtIso).toBe("2026-09-17T12:00:00.000Z");
  expect(body.position.sideToMove).toBe("white");
  expect(body.settings).toEqual({ horizonMoves: 1, styleDepth: 13 });
  expect(body.lines).toHaveLength(1);
  expect(body.lines[0].label).toBe("CSTal ABSURD vs Maia3 79M StylePath");
  expect(body.lines[0].styleDepth).toBe(14);
  expect(body.lines[0].plies[0]).toMatchObject({
    index: 1,
    uci: "e2e4",
    san: "e4",
    source: "LOCAL_STYLE_ENGINE",
    provider: { name: "cstal-absurd", displayName: "CSTal ABSURD", version: "test" },
    status: "ENGINE_GENERATED"
  });
  expect(body.lines[0].plies[0].requestId).toBe("cstal-absurd-1");
  expect(body.renderedText).toContain("1. e4");
});

test("StylePath API rejects invalid input before providers", async () => {
  const calls = [];
  const result = await analyzeStyleLinesApi({ fen: "not a fen", horizonMoves: 1 }, testPorts(calls));

  expect(result.tag).toBe("Err");
  expect(result.error.code).toBe("INVALID_FEN");
  expect(calls).toEqual([]);
});

test("StylePath HTTP endpoint requires bearer authentication", async () => {
  const server = await startStyleLinesApiServer({ host: "127.0.0.1", port: 0, authToken: "secret-token-123456" }, testPorts());
  try {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/style-lines`, {
      method: "POST",
      body: JSON.stringify({ fen: startFen, horizonMoves: 1 })
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`http://127.0.0.1:${port}/api/style-lines`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token-123456",
        "content-type": "application/json"
      },
      body: JSON.stringify({ fen: startFen, horizonMoves: 1, includeRenderedText: false })
    });
    expect(authorized.status).toBe(200);
    const body = await authorized.json();
    expect(body.lines[0].plies[0].uci).toBe("e2e4");
    expect(body.renderedText).toBeUndefined();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
