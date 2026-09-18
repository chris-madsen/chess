import { createInMemoryAnalysisCache } from "../src/adapters/cache/in-memory-analysis-cache.ts";
import { analysisCacheKey, makeCacheEntry, makePatternModelVersion, positionStateKey } from "../src/domain/index.ts";
import { createChessJsRulesAdapter } from "../src/wiring/index.ts";

const chess = createChessJsRulesAdapter();
const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

test("Zobrist key ignores counters but keeps rule context", () => {
  const first = mustOk(chess.ingestPosition(startFen));
  const second = mustOk(chess.ingestPosition(`${startFen.replace("0 1", "7 42")}`));
  const firstKey = positionStateKey(first);
  const secondKey = positionStateKey(second);

  expect(firstKey.zobrist).toBe(secondKey.zobrist);
  expect(firstKey.ruleContext.halfmoveClock).toBe(0);
  expect(secondKey.ruleContext.halfmoveClock).toBe(7);
});

test("Zobrist key separates castling and en-passant state", () => {
  const castling = mustOk(chess.ingestPosition(startFen));
  const noCastling = mustOk(chess.ingestPosition(startFen.replace("KQkq", "-")));
  const enPassant = mustOk(chess.ingestPosition("rnbqkbnr/pppp1ppp/8/3Pp3/8/8/PPP1PPPP/RNBQKBNR w KQkq e6 0 2"));
  const noEnPassant = mustOk(chess.ingestPosition("rnbqkbnr/pppp1ppp/8/3Pp3/8/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2"));

  expect(positionStateKey(castling).zobrist).not.toBe(positionStateKey(noCastling).zobrist);
  expect(positionStateKey(enPassant).zobrist).not.toBe(positionStateKey(noEnPassant).zobrist);
});

test("history-aware positions retain a separate history signature", () => {
  const first = mustOk(chess.ingestRawGame("1. Nf3 Nf6 2. g3 g6"));
  const second = mustOk(chess.ingestRawGame("1. g3 g6 2. Nf3 Nf6"));
  const firstKey = positionStateKey(first);
  const secondKey = positionStateKey(second);

  expect(firstKey.zobrist).toBe(secondKey.zobrist);
  expect(firstKey.historySignature).toBeDefined();
  expect(secondKey.historySignature).toBeDefined();
  expect(firstKey.historySignature).not.toBe(secondKey.historySignature);
});

test("cache keys isolate provider configuration and model version", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const firstKey = analysisCacheKey({
    namespace: "MAIA_RESPONSE",
    position,
    configuration: { elo: 1800, model: "maia3-79m" },
    modelVersion: makePatternModelVersion("pattern-v1")
  });
  const secondKey = analysisCacheKey({
    namespace: "MAIA_RESPONSE",
    position,
    configuration: { elo: 2300, model: "maia3-79m" },
    modelVersion: makePatternModelVersion("pattern-v1")
  });
  const cache = createInMemoryAnalysisCache();
  const entry = makeCacheEntry({
    key: firstKey,
    schemaVersion: 1,
    createdAtIso: "2026-09-18T00:00:00.000Z",
    value: { move: "e7e5" }
  });

  expect((await cache.put(entry)).tag).toBe("Ok");
  expect((await cache.get(firstKey)).value).toEqual(entry);
  expect((await cache.get(secondKey)).value).toBeUndefined();
});

test("in-memory cache evicts the least recently used entry", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const cache = createInMemoryAnalysisCache(1);
  const key = namespace => analysisCacheKey({ namespace, position, configuration: {} });
  const first = makeCacheEntry({ key: key("PATTERN_ASSESSMENT"), schemaVersion: 1, createdAtIso: "2026-09-18T00:00:00.000Z", value: { score: 1 } });
  const second = makeCacheEntry({ key: key("POSITION_EVALUATION"), schemaVersion: 1, createdAtIso: "2026-09-18T00:00:01.000Z", value: { score: 2 } });

  await cache.put(first);
  await cache.put(second);
  expect((await cache.get(first.key)).value).toBeUndefined();
  expect((await cache.get(second.key)).value).toEqual(second);
});
