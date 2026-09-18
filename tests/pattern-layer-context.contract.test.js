import {
  assessPatternContext,
  extractPatternPositionContext,
  makePatternAnalysisContext,
  patternMatcherFor,
  retrievePatternFamilies,
  createChessJsRulesAdapter
} from "../src/wiring/index.ts";
import { analysisCacheKey, canonicalizePatternPosition, positionStateKey } from "../src/domain/index.ts";

const chess = createChessJsRulesAdapter();
const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

test("Pattern context keeps attacker side stable across alternating plies", () => {
  let position = mustOk(chess.ingestPosition("r3k2r/ppp2ppp/8/8/8/8/PPP2PPP/R3K2R w KQkq - 0 1"));
  const analysis = makePatternAnalysisContext("white");
  for (const moveText of ["e1g1", "e8g8", "g1h1", "g8h8"]) {
    const facts = mustOk(chess.computeFacts(position));
    const context = extractPatternPositionContext(position, facts, analysis);
    expect(context.analysis.attackerSide).toBe("white");
    expect(context.analysis.defenderSide).toBe("black");
    position = mustOk(chess.applyMove(position, mustOk(chess.parseLegalMove(position, moveText))));
  }
});

test("BACK_RANK does not treat a generic edge king as a back-rank pattern", () => {
  const position = mustOk(chess.ingestPosition("7k/6R1/5N2/8/8/8/8/K7 w - - 0 1"));
  const facts = mustOk(chess.computeFacts(position));
  const context = extractPatternPositionContext(position, facts, makePatternAnalysisContext("white"));
  const assessment = assessPatternContext(context, "BACK_RANK");
  expect(context.kingOnHomeRank).toBe(true);
  expect(assessment.similarity).toBe(0);
  expect(assessment.missingConditions).toContain("BACK_RANK structural prefilter is not satisfied");
  expect(patternMatcherFor("BACK_RANK").family).toBe("BACK_RANK");
});

test("irrelevant background material does not change canonical pattern identity", () => {
  const first = mustOk(chess.ingestPosition("7k/6R1/5N2/8/8/8/8/K7 w - - 0 1"));
  const second = mustOk(chess.ingestPosition("7k/6R1/5N2/8/8/8/P7/K7 w - - 0 1"));
  const analysis = makePatternAnalysisContext("white");
  const firstCanonical = canonicalizePatternPosition(first, mustOk(chess.computeFacts(first)), analysis);
  const secondCanonical = canonicalizePatternPosition(second, mustOk(chess.computeFacts(second)), analysis);
  expect(firstCanonical.key).toBe(secondCanonical.key);
});

test("Pattern cache identity ignores history while Maia identity preserves it by default", () => {
  const first = mustOk(chess.ingestRawGame("1. Nf3 Nf6 2. g3 g6"));
  const second = mustOk(chess.ingestRawGame("1. g3 g6 2. Nf3 Nf6"));
  expect(positionStateKey(first).zobrist).toBe(positionStateKey(second).zobrist);
  expect(analysisCacheKey({ namespace: "PATTERN_CONTEXT", position: first, configuration: {}, modelVersion: "pattern-context-v1" }).position.historySignature).toBeUndefined();
  expect(analysisCacheKey({ namespace: "PATTERN_ASSESSMENT", position: first, configuration: {}, modelVersion: "pattern-v1" }).position.historySignature).toBeUndefined();
  expect(analysisCacheKey({ namespace: "MAIA_RESPONSE", position: first, configuration: { elo: 1800 } }).position.historySignature).toBeDefined();
});

test("Pattern cache identity ignores halfmove and repetition rule counters", () => {
  const first = mustOk(chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));
  const second = mustOk(chess.ingestPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 87 44"));
  const firstKey = analysisCacheKey({ namespace: "PATTERN_CONTEXT", position: first, configuration: { extractor: "v1" } });
  const secondKey = analysisCacheKey({ namespace: "PATTERN_CONTEXT", position: second, configuration: { extractor: "v1" } });
  expect(firstKey.position.zobrist).toBe(secondKey.position.zobrist);
  expect(firstKey.position.ruleContext).toEqual(secondKey.position.ruleContext);
  expect(firstKey.position.ruleContext).toEqual({ halfmoveClock: 0 });
});

test("runtime retrieval ranks families without a supplied target family", () => {
  const position = mustOk(chess.ingestPosition("7k/6R1/5N2/8/8/8/8/K7 w - - 0 1"));
  const context = extractPatternPositionContext(position, mustOk(chess.computeFacts(position)), makePatternAnalysisContext("white"));
  const candidates = retrievePatternFamilies(context, 5);
  expect(candidates).toHaveLength(5);
  expect(candidates.every(candidate => candidate.family.length > 0)).toBe(true);
  expect(candidates.every(candidate => candidate.similarity >= 0 && candidate.similarity <= 1)).toBe(true);
});
