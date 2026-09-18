import { runPatternSelectionExperiment, tracePatternLine, selectPatternLine } from "../src/wiring/index.ts";
import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { createInMemoryAnalysisCache } from "../src/adapters/cache/in-memory-analysis-cache.ts";
import { assessPattern, makePatternLineOutcome, makePlyIndex, makeRequestId, makeScenarioHorizon, playerProvider, localStyleEngineProvider, isErr, PATTERN_FAMILY_CATALOG } from "../src/domain/index.ts";

const chess = createChessJsRulesAdapter();
const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

const verified = { status: "VERIFIED", provider: "test-verifier", limits: { depth: 20 } };

test("symbolic PatternAssessment is deterministic and bounded", () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const facts = mustOk(chess.computeFacts(position));
  const first = assessPattern(position, facts, "ANASTASIA");
  const second = assessPattern(position, facts, "ANASTASIA");

  expect(first).toEqual(second);
  expect(first.similarity).toBeGreaterThanOrEqual(0);
  expect(first.similarity).toBeLessThanOrEqual(1);
  expect(first.modelVersion).toBe("symbolic-v2-named-core");
  expect(first.evidence.length).toBeGreaterThan(0);
});

test("Lichess mate catalog exposes and scores all 19 core families", () => {
  expect(PATTERN_FAMILY_CATALOG).toHaveLength(19);
  const position = mustOk(chess.ingestPosition(startFen));
  const facts = mustOk(chess.computeFacts(position));
  for (const definition of PATTERN_FAMILY_CATALOG) {
    const assessment = assessPattern(position, facts, definition.id);
    expect(assessment.family).toBe(definition.id);
    expect(assessment.similarity).toBeGreaterThanOrEqual(0);
    expect(assessment.similarity).toBeLessThanOrEqual(1);
    expect(assessment.evidence.length).toBeGreaterThan(0);
  }
});

test("background position identity does not require an exact historical FEN", () => {
  const first = mustOk(chess.ingestPosition("r3k2r/ppp2ppp/2n5/3p4/3P4/2N5/PPP2PPP/R3K2R w KQkq - 0 1"));
  const second = mustOk(chess.ingestPosition("r3k2r/ppp2ppp/2n5/3p4/3P4/2N5/PPP2PPP/R3K2R w KQkq - 4 9"));
  const firstAssessment = assessPattern(first, mustOk(chess.computeFacts(first)), "BACK_RANK");
  const secondAssessment = assessPattern(second, mustOk(chess.computeFacts(second)), "BACK_RANK");

  expect(firstAssessment.family).toBe(secondAssessment.family);
  expect(Math.abs(firstAssessment.similarity - secondAssessment.similarity)).toBeLessThanOrEqual(0.01);
});

test("selector uses prefix scores and has deterministic baseline tie-break", () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const assessment = (similarity, state = "forming") => ({
    tag: "PatternAssessment",
    family: "ANASTASIA",
    similarity,
    progress: similarity,
    state,
    evidence: [],
    modelVersion: "symbolic-v2-named-core"
  });
  const baseline = { engineKey: "cstal-absurd", line: { start: position }, prefixAssessments: [assessment(0.4)], fullAssessments: [assessment(0.9)], terminalPosition: position };
  const alternative = { engineKey: "cstal-extreme", line: { start: position }, prefixAssessments: [assessment(0.7)], fullAssessments: [assessment(0.1)], terminalPosition: position };

  const selected = selectPatternLine({ baseline, alternative, prefixPlies: 4 });
  expect(selected.selectedEngineKey).toBe("cstal-extreme");
  expect(selected.baselineScore).toBe(0.4);
  expect(selected.alternativeScore).toBe(0.7);
  expect(selected.prefixPlies).toBe(4);

  const tied = selectPatternLine({
    baseline: { ...baseline, prefixAssessments: [assessment(0.7)] },
    alternative: { ...alternative, prefixAssessments: [assessment(0.7)] },
    prefixPlies: 4
  });
  expect(tied.selectedEngineKey).toBe("cstal-absurd");
  expect(tied.selectionReason).toBe("TIE_BASELINE");
});

test("beautiful forced combination requires all independent outcome parts", () => {
  const assessment = {
    tag: "PatternAssessment",
    family: "SMOTHERED",
    similarity: 0.9,
    progress: 0.2,
    state: "mate_basin",
    evidence: [],
    modelVersion: "symbolic-v2-named-core"
  };
  expect(makePatternLineOutcome({ assessments: [assessment], terminalMate: true, forcedMate: verified }).beautifulForcedCombination).toBe(true);
  expect(makePatternLineOutcome({ assessments: [assessment], terminalMate: true, forcedMate: { status: "UNAVAILABLE" } }).beautifulForcedCombination).toBe(false);
  expect(makePatternLineOutcome({ assessments: [assessment], terminalMate: false, forcedMate: verified }).beautifulForcedCombination).toBe(false);
});

test("trace records prefix separately from full line", () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const move = mustOk(chess.parseLegalMove(position, "e2e4"));
  const next = mustOk(chess.applyMove(position, move));
  const line = {
    tag: "ScenarioLine",
    mode: "StylePath",
    label: "test",
    start: position,
    horizon: mustOk(makeScenarioHorizon(1)),
    plies: [{ tag: "ScenarioPly", index: makePlyIndex(1), move, provenance: {
      source: "PLAYER_IDEA",
      provider: playerProvider,
      status: "PLAYER_ENTERED",
      requestId: makeRequestId("pattern-test"),
      inputPositionHash: position.hash,
      configuration: {}
    } }],
    status: "Complete"
  };
  const trace = mustOk(tracePatternLine(chess, "test", line, "ANASTASIA", 0));
  expect(trace.prefixAssessments).toHaveLength(1);
  expect(trace.fullAssessments.length).toBeGreaterThan(trace.prefixAssessments.length);
  expect(String(trace.terminalPosition.fen)).toBe(String(next.fen));
});

test("paired runner uses only ABSURD and EXTREME and records cache reuse", async () => {
  const providerFor = (key, displayName, rawMove) => ({
    key,
    source: "LOCAL_STYLE_ENGINE",
    identity: localStyleEngineProvider(key, displayName, "test"),
    configuration: { styleDepth: 1 },
    provideMove: async request => {
      const move = chess.parseLegalMove(request.position, rawMove);
      return isErr(move)
        ? move
        : { tag: "Ok", value: { move: move.value, provenance: {
          source: "LOCAL_STYLE_ENGINE",
          provider: localStyleEngineProvider(key, displayName, "test"),
          status: "ENGINE_GENERATED",
          requestId: makeRequestId(`${key}-${request.ply}`),
          inputPositionHash: request.position.hash,
          configuration: {}
        } } };
    }
  });
  const providers = {
    maia: async () => ({ tag: "Err", error: { code: "PROVIDER_MALFORMED_OUTPUT", path: "test", message: "not reached" } }),
    styleEngines: [providerFor("cstal-absurd", "CSTal ABSURD", "e2e4"), providerFor("cstal-extreme", "CSTal EXTREME", "d2d4")]
  };
  const position = mustOk(chess.ingestPosition(startFen));
  const experimentCase = {
    caseId: "test-0001",
    split: "evaluation",
    family: "ANASTASIA",
    source: { kind: "fixture", reference: "test" },
    position,
    horizon: mustOk(makeScenarioHorizon(1)),
    prefixPlies: 0
  };
  const cache = createInMemoryAnalysisCache();
  const first = mustOk(await runPatternSelectionExperiment(chess, providers, experimentCase, undefined, cache, "2026-09-18T00:00:00.000Z"));
  const second = mustOk(await runPatternSelectionExperiment(chess, providers, experimentCase, undefined, cache, "2026-09-18T00:00:00.000Z"));

  expect(first.baseline.engineKey).toBe("cstal-absurd");
  expect(first.alternative.engineKey).toBe("cstal-extreme");
  expect(first.comparison.treatment.forcedMate.status).toBe("UNAVAILABLE");
  expect(first.cache.misses).toBeGreaterThan(0);
  expect(second.cache.hits).toBeGreaterThan(0);
});
