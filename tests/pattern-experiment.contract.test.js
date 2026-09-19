import { createForcedMateVerifier, runPatternSelectionExperiment, tracePatternLine, selectPatternLine } from "../src/wiring/index.ts";
import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { createInMemoryAnalysisCache } from "../src/adapters/cache/in-memory-analysis-cache.ts";
import { assessPattern, canonicalizePatternPosition, makePatternLineOutcome, makePlyIndex, makeRequestId, makeScenarioHorizon, playerProvider, localStyleEngineProvider, isErr, PATTERN_FAMILY_CATALOG, TACTICAL_MOTIF_CATALOG } from "../src/domain/index.ts";

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
  expect(first.modelVersion).toBe("mate-geometry-v2-canonical-role-aware");
  expect(first.evidence.length).toBeGreaterThan(0);
});

test("named mate catalog exposes and scores core and extended families", () => {
  expect(PATTERN_FAMILY_CATALOG).toHaveLength(34);
  expect(PATTERN_FAMILY_CATALOG.filter(definition => definition.tier === "MVP_NAMED_CORE")).toHaveLength(19);
  expect(PATTERN_FAMILY_CATALOG.filter(definition => definition.tier === "MVP_EXTENDED")).toHaveLength(15);
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

test("tactical motifs remain a separate catalog", () => {
  expect(TACTICAL_MOTIF_CATALOG).toHaveLength(15);
  expect(TACTICAL_MOTIF_CATALOG.some(definition => definition.id === "SACRIFICE")).toBe(true);
  expect(PATTERN_FAMILY_CATALOG.some(definition => definition.id === "SACRIFICE")).toBe(false);
});

test("canonical pattern state is invariant under file mirror", () => {
  const first = mustOk(chess.ingestPosition("7k/6R1/5N2/8/8/8/8/K7 w - - 0 1"));
  const mirrored = mustOk(chess.ingestPosition("k7/1R6/2N5/8/8/8/8/7K w - - 0 1"));
  const firstCanonical = canonicalizePatternPosition(first, mustOk(chess.computeFacts(first)));
  const mirroredCanonical = canonicalizePatternPosition(mirrored, mustOk(chess.computeFacts(mirrored)));
  expect(firstCanonical.key).toBe(mirroredCanonical.key);
  expect(firstCanonical.pieces).toEqual(mirroredCanonical.pieces);
});

test("canonical pattern state is invariant under color swap with board rotation", () => {
  const whiteAttacks = mustOk(chess.ingestPosition("7k/6R1/5N2/8/8/8/8/K7 w - - 0 1"));
  const blackAttacks = mustOk(chess.ingestPosition("7k/8/8/8/8/2n5/1r6/K7 b - - 0 1"));
  const firstCanonical = canonicalizePatternPosition(whiteAttacks, mustOk(chess.computeFacts(whiteAttacks)));
  const secondCanonical = canonicalizePatternPosition(blackAttacks, mustOk(chess.computeFacts(blackAttacks)));
  expect(firstCanonical.key).toBe(secondCanonical.key);
});

test("MateGeometry score is invariant under horizontal king-frame mirror", () => {
  const first = mustOk(chess.ingestPosition("7k/6R1/5N2/8/8/8/8/K7 w - - 0 1"));
  const mirrored = mustOk(chess.ingestPosition("k7/1R6/2N5/8/8/8/8/7K w - - 0 1"));
  const firstFacts = mustOk(chess.computeFacts(first));
  const mirroredFacts = mustOk(chess.computeFacts(mirrored));
  for (const family of PATTERN_FAMILY_CATALOG.map(definition => definition.id)) {
    const left = assessPattern(first, firstFacts, family);
    const right = assessPattern(mirrored, mirroredFacts, family);
    expect(Math.abs(left.similarity - right.similarity)).toBeLessThanOrEqual(0.000001);
  }
});

test("forced-mate verifier requires an independent proof for a terminal mate", async () => {
  const terminal = mustOk(chess.ingestPosition("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"));
  const provider = async request => ({
    tag: "Ok",
    value: {
      status: "VERIFIED",
      provider: "independent-test-provider",
      limits: { depth: 24 },
      terminalPositionHash: String(request.terminalPosition.hash),
      proofReference: "test-proof"
    }
  });
  const verifier = createForcedMateVerifier(chess, provider);
  const result = mustOk(await verifier({ start: terminal, line: {}, terminalPosition: terminal }));
  expect(result.status).toBe("VERIFIED");
  expect(result.provider).toBe("independent-test-provider");
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
    modelVersion: "symbolic-v3-named-catalog"
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
    modelVersion: "symbolic-v3-named-catalog"
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
    datasetVersion: "test-v1",
    split: "evaluation",
    exampleKind: "control",
    family: "ANASTASIA",
    sourcePositionHash: String(position.hash),
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
