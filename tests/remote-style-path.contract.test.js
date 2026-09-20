import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { fetchRemotePatternSteeringBatch, fetchRemoteStylePathBatch, fetchRemoteStylePaths } from "../src/wiring/index.ts";
import { makeScenarioHorizon } from "../src/domain/index.ts";

const chess = createChessJsRulesAdapter();
const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("remote StylePath adapter imports and validates Windows CSTal lines", async () => {
  const position = chess.ingestPosition(startFen);
  expect(position.tag).toBe("Ok");
  const horizon = makeScenarioHorizon(4);
  expect(horizon.tag).toBe("Ok");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ jobId: "remote-test-job" }),
    text: async () => `event: queued\ndata: ${JSON.stringify({ jobId: "remote-test-job", status: "queued", lines: [] })}\n\nevent: complete\ndata: ${JSON.stringify({
      lines: [
        { engineKey: "cstal-absurd-maia3", label: "CSTal ABSURD", status: "Complete", styleDepth: 14, start: { fen: startFen, pgn: "1. e4 e5" }, plies: [
          { index: 1, uci: "e2e4", san: "e4", source: "LOCAL_STYLE_ENGINE", provider: "CSTal ABSURD" },
          { index: 2, uci: "e7e5", san: "e5", source: "MAIA", provider: "Maia3 79M" }
        ] },
        { engineKey: "cstal-extreme-maia3", label: "CSTal EXTREME", status: "Complete", styleDepth: 14, plies: [
          { index: 1, uci: "d2d4", san: "d4", source: "LOCAL_STYLE_ENGINE", provider: "CSTal EXTREME" },
          { index: 2, uci: "d7d5", san: "d5", source: "MAIA", provider: "Maia3 79M" }
        ] }
      ], jobId: "remote-test-job", status: "complete"
    })}\n\n`
  });
  try {
    const result = await fetchRemoteStylePaths(chess, position.value, horizon.value, {
      baseUrl: "https://example.test",
      token: "test-token-1234567890",
      cstalOpponent: "maia3",
      maia3Elo: 1800,
      timeoutMs: 1000
    });
    expect(result.tag).toBe("Ok");
    expect(result.value).toHaveLength(2);
    expect(result.value[0].line.plies).toHaveLength(2);
    expect(result.value[0].line.plies[0].provenance.status).toBe("IMPORTED");
    expect(result.value[0].line.plies[0].provenance.source).toBe("LOCAL_STYLE_ENGINE");
    expect(result.value[0].line.plies[1].provenance.source).toBe("MAIA");
    expect(result.value[0].line.start.pgn).toBe("1. e4 e5");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote Pattern batch adapter preserves case IDs and both lines", async () => {
  const position = chess.ingestPosition(startFen);
  expect(position.tag).toBe("Ok");
  const horizon = makeScenarioHorizon(2);
  expect(horizon.tag).toBe("Ok");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => ({
    ok: true,
    status: 202,
    json: async () => url.endsWith("/batches") ? { batchId: "batch-test" } : undefined,
    text: async () => url.includes("/batches/batch-test/events") ? `event: complete\ndata: ${JSON.stringify({ batchId: "batch-test", status: "complete", results: ["case-a", "case-b"].map(caseId => ({ caseId, status: "complete", snapshot: { jobId: `${caseId}-job`, status: "complete", lines: [
      { engineKey: "cstal-absurd-maia3", label: "CSTal ABSURD", status: "Complete", plies: [{ index: 1, uci: "e2e4", san: "e4", source: "LOCAL_STYLE_ENGINE", provider: "CSTal ABSURD" }] },
      { engineKey: "cstal-extreme-maia3", label: "CSTal EXTREME", status: "Complete", plies: [{ index: 1, uci: "d2d4", san: "d4", source: "LOCAL_STYLE_ENGINE", provider: "CSTal EXTREME" }] }
    ] } })) })}\n\n` : ""
  });
  try {
    const result = await fetchRemoteStylePathBatch(chess, [
      { caseId: "case-a", position: position.value },
      { caseId: "case-b", position: position.value }
    ], horizon.value, {
      baseUrl: "https://example.test",
      token: "test-token-1234567890",
      cstalOpponent: "maia3",
      maia3Elo: 1800,
      timeoutMs: 1000
    }, 2);
    expect(result.tag).toBe("Ok");
    expect(Object.keys(result.value)).toEqual(["case-a", "case-b"]);
    expect(result.value["case-a"]).toHaveLength(2);
    expect(result.value["case-a"][0].line.plies[0].provenance.status).toBe("IMPORTED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote Pattern steering adapter imports ScenarioPly provenance shape", async () => {
  const position = chess.ingestPosition(startFen);
  expect(position.tag).toBe("Ok");
  const horizon = makeScenarioHorizon(2);
  expect(horizon.tag).toBe("Ok");
  const originalFetch = globalThis.fetch;
  const progress = [];
  globalThis.fetch = async url => ({
    ok: true,
    status: 202,
    json: async () => url.endsWith("/batches") ? { batchId: "batch-scenario-ply" } : undefined,
    body: url.includes("/batches/batch-scenario-ply/events") ? new ReadableStream({
      start(controller) {
        const line = {
          status: "Complete",
          plies: [
            { tag: "ScenarioPly", index: 1, move: { uci: "e2e4", san: "e4" }, provenance: { source: "LOCAL_STYLE_ENGINE", provider: { name: "cstal-absurd", displayName: "CSTal ABSURD", version: "2.07-cst-absurd" }, requestId: "tal-1", configuration: { engineKey: "cstal-absurd" } } },
            { tag: "ScenarioPly", index: 2, move: { uci: "e7e5", san: "e5" }, provenance: { source: "MAIA", provider: { name: "maia3", displayName: "Maia3 79M", version: "maia3-79m" }, requestId: "maia-2", configuration: { elo: 1800 } } }
          ]
        };
        controller.enqueue(new TextEncoder().encode(`event: complete\ndata: ${JSON.stringify({ batchId: "batch-scenario-ply", status: "complete", results: [{ caseId: "case-scenario-ply", status: "complete", steeringLine: line }] })}\n\n`));
        controller.close();
      }
    }) : null
  });
  try {
    const result = await fetchRemotePatternSteeringBatch(chess, [{ caseId: "case-scenario-ply", position: position.value }], horizon.value, {
      baseUrl: "https://example.test",
      token: "test-token-1234567890",
      cstalOpponent: "maia3",
      maia3Elo: 1800,
      timeoutMs: 1000
    }, 1, event => progress.push(event));
    expect(result.tag).toBe("Ok");
    expect(result.value["case-scenario-ply"].plies.map(ply => ply.provenance.source)).toEqual(["LOCAL_STYLE_ENGINE", "MAIA"]);
    expect(result.value["case-scenario-ply"].plies[0].provenance.provider.name).toBe("cstal-absurd");
    expect(progress.some(event => event.caseId === "case-scenario-ply" && event.line?.plies.length === 2)).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote Pattern steering preserves dynamic target sessions and branch prefixes", async () => {
  const position = chess.ingestPosition(startFen);
  expect(position.tag).toBe("Ok");
  const horizon = makeScenarioHorizon(4);
  expect(horizon.tag).toBe("Ok");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => ({
    ok: true,
    status: 202,
    json: async () => url.endsWith("/batches") ? { batchId: "batch-targets" } : undefined,
    body: url.includes("/batches/batch-targets/events") ? new ReadableStream({
      start(controller) {
        const session = {
          discovery: { status: "Complete", plies: [] },
          targets: [{
            targetFamily: "MORPHYS",
            triggerPly: 1,
            triggerAffinity: 0.97,
            position: { fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" },
            prefixPlies: [{ index: 1, move: { uci: "e2e4" }, provenance: { source: "LOCAL_STYLE_ENGINE", provider: { name: "cstal", displayName: "CSTal" }, requestId: "prefix-1", configuration: {} } }],
            line: { status: "Terminal", targetFamily: "MORPHYS", plies: [{ index: 1, move: { uci: "e7e5" }, provenance: { source: "MAIA", provider: { name: "maia3", displayName: "Maia3" }, requestId: "target-1", configuration: {} } }] }
          }]
        };
        controller.enqueue(new TextEncoder().encode(`event: complete\ndata: ${JSON.stringify({ batchId: "batch-targets", status: "complete", results: [{ caseId: "case-targets", status: "complete", steeringSession: session }] })}\n\n`));
        controller.close();
      }
    }) : null
  });
  try {
    const result = await fetchRemotePatternSteeringBatch(chess, [{ caseId: "case-targets", position: position.value }], horizon.value, {
      baseUrl: "https://example.test", token: "test-token-1234567890", cstalOpponent: "maia3", maia3Elo: 1800, timeoutMs: 1000
    }, 1);
    expect(result.tag).toBe("Ok");
    const session = result.value["case-targets"].targetSession;
    expect(session?.targets[0]?.targetFamily).toBe("MORPHYS");
    expect(session?.targets[0]?.prefixPlies[0]?.move.san).toBe("e4");
    expect(session?.targets[0]?.line?.plies[0]?.move.san).toBe("e5");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote Pattern steering preserves the Windows provider error for a failed case", async () => {
  const position = chess.ingestPosition(startFen);
  expect(position.tag).toBe("Ok");
  const horizon = makeScenarioHorizon(2);
  expect(horizon.tag).toBe("Ok");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => ({
    ok: true,
    status: 202,
    json: async () => url.endsWith("/batches") ? { batchId: "batch-error" } : undefined,
    body: url.includes("/batches/batch-error/events") ? new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: complete\ndata: ${JSON.stringify({
          batchId: "batch-error",
          status: "incomplete",
          results: [{
            caseId: "case-error",
            status: "error",
            error: {
              code: "PROVIDER_MALFORMED_OUTPUT",
              path: "providers.cstal-absurd.searchmoves",
              message: "UCI engine did not honor the requested searchmove",
              details: { requested: "d2d4", returned: "e2e4" }
            }
          }]
        })}\n\n`));
        controller.close();
      }
    }) : null
  });
  try {
    const result = await fetchRemotePatternSteeringBatch(chess, [{ caseId: "case-error", position: position.value }], horizon.value, {
      baseUrl: "https://example.test",
      token: "test-token-1234567890",
      cstalOpponent: "maia3",
      maia3Elo: 1800,
      timeoutMs: 1000
    });
    expect(result.tag).toBe("Err");
    expect(result.error.code).toBe("PROVIDER_MALFORMED_OUTPUT");
    expect(result.error.path).toContain("case-error.providers.cstal-absurd.searchmoves");
    expect(result.error.details).toMatchObject({ requested: "d2d4", returned: "e2e4" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
