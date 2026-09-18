import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { fetchRemoteStylePaths } from "../src/wiring/index.ts";
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
        { engineKey: "cstal-absurd-maia3", label: "CSTal ABSURD", status: "Complete", styleDepth: 14, plies: [
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
