import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { renderPatternDiscoveryStart, renderPatternLiveLineStatus, renderPatternProgressStatus, renderPatternReference, renderPatternSteeringLine, renderPatternTargetReferences, renderPatternTargetSession } from "../src/cli/pattern-steering-render.ts";

const chess = createChessJsRulesAdapter();

test("remote progress status is a single ANSI-free line before completion", () => {
  const rendered = renderPatternProgressStatus("raw-game", 0, 1, 12);
  expect(rendered).toBe("pattern: raw-game Windows Tal+Maia | 0/1 completed | 12s");
  expect(rendered).not.toContain(String.fromCharCode(27));
  expect(rendered).not.toContain("\n");
});

test("partial remote line is rendered as one compact ANSI-free status", () => {
  const rendered = renderPatternLiveLineStatus("raw-game", "## raw-game status Running\n1. c4 Nf6\n\n");
  expect(rendered).toBe("pattern: raw-game ## raw-game status Running | 1. c4 Nf6");
  expect(rendered).not.toContain("\n");
  expect(rendered).not.toContain(String.fromCharCode(27));
});

test("pattern steering renderer shows the live SAN line from the FEN start", () => {
  const position = chess.ingestPosition("4r3/1k6/pp3r2/1b2P2p/3R1p2/P1R2P2/1P4PP/6K1 w - - 0 35");
  expect(position.tag).toBe("Ok");
  const move = chess.parseLegalMove(position.value, "d4d7");
  expect(move.tag).toBe("Ok");
  const rendered = renderPatternSteeringLine("case-1", {
    tag: "ScenarioLine",
    mode: "HumanPath",
    label: "PatternSteeredTalPath",
    start: position.value,
    horizon: 2,
    plies: [{ tag: "ScenarioPly", index: 1, move: move.value, provenance: { source: "LOCAL_STYLE_ENGINE", provider: { name: "cstal", displayName: "CSTal" }, status: "IMPORTED", requestId: "request-1", inputPositionHash: position.value.hash, configuration: {} } }],
    status: "Complete"
  });
  expect(rendered).toContain("## case-1 PatternSteeredTalPath status Complete");
  expect(rendered).toContain("35. Rd7+");
});

test("discovery start renderer immediately shows the raw PGN history", () => {
  const position = chess.ingestRawGame("1. c4 Nf6 2. Nc3 g6 3. e4");
  expect(position.tag).toBe("Ok");
  expect(renderPatternDiscoveryStart("raw-game", position.value)).toContain("1. c4 Nf6 2. Nc3 g6 3. e4");
});

test("pattern steering renderer shows the selected mating pattern and affinity percentage", () => {
  const position = chess.ingestPosition("4r3/1k6/pp3r2/1b2P2p/3R1p2/P1R2P2/1P4PP/6K1 w - - 0 35");
  expect(position.tag).toBe("Ok");
  const rendered = renderPatternSteeringLine("case-pattern", {
    tag: "ScenarioLine",
    mode: "HumanPath",
    label: "PatternSteeredTalPath",
    start: position.value,
    horizon: 2,
    plies: [],
    status: "Incomplete",
    decisionTraces: [{
      positionHash: position.value.hash,
      selectedUci: "d4d7",
      candidates: [{
        uci: "d4d7",
        source: "LOCAL_STYLE_ENGINE",
        talAccepted: true,
        targetFamily: "MORPHYS",
        beforeAffinity: 0.31,
        afterCandidateAffinity: 0.68,
        afterMaiaAffinity: 0.734,
        patternDelta: 0.424
      }]
    }]
  });
  expect(rendered).toContain("## case-pattern PatternSteeredTalPath pattern MORPHYS 73.4% status Incomplete");
});

test("pattern reference renderer stays out of live frames and shows sources after completion", () => {
  const position = chess.ingestPosition("4r3/1k6/pp3r2/1b2P2p/3R1p2/P1R2P2/1P4PP/6K1 w - - 0 35");
  expect(position.tag).toBe("Ok");
  const line = {
    tag: "ScenarioLine",
    mode: "HumanPath",
    label: "PatternSteeredTalPath",
    start: position.value,
    horizon: 2,
    plies: [],
    status: "Terminal",
    decisionTraces: [{
      positionHash: position.value.hash,
      selectedUci: "d4d7",
      candidates: [{
        uci: "d4d7",
        source: "LOCAL_STYLE_ENGINE",
        talAccepted: true,
        targetFamily: "MORPHYS",
        beforeAffinity: 0.31,
        afterCandidateAffinity: 0.68,
        afterMaiaAffinity: 0.734,
        patternDelta: 0.424
      }]
    }]
  };
  expect(renderPatternSteeringLine("case-pattern", line)).not.toContain("Pattern reference");
  const reference = renderPatternReference(line);
  expect(reference).toContain("Morphy's Mate (MORPHYS), affinity 73.4%");
  expect(reference).toContain("[FEN \"3r4/1pB3kp/2b1Pp2/1pN2RpK/1P6/7P/6r1/8 w - - 0 34\"]");
  expect(reference).toContain("Lichess theme: https://lichess.org/training/morphysMate");
  expect(reference).toContain("Example: https://lichess.org/5qeC9Wl2#67");
  expect(reference).toContain("Dataset case: morphys-00y2j, rating 1572");
});

test("pattern reference renderer merges repeated families by maximum affinity", () => {
  const position = chess.ingestPosition("4r3/1k6/pp3r2/1b2P2p/3R1p2/P1R2P2/1P4PP/6K1 w - - 0 35");
  expect(position.tag).toBe("Ok");
  const trace = (selectedUci, targetFamily, afterMaiaAffinity) => ({
    positionHash: position.value.hash,
    selectedUci,
    candidates: [{
      uci: selectedUci,
      source: "LOCAL_STYLE_ENGINE",
      talAccepted: true,
      targetFamily,
      beforeAffinity: 0.2,
      afterCandidateAffinity: afterMaiaAffinity,
      afterMaiaAffinity,
      patternDelta: afterMaiaAffinity - 0.2
    }]
  });
  const rendered = renderPatternReference({
    tag: "ScenarioLine",
    mode: "HumanPath",
    label: "PatternSteeredTalPath",
    start: position.value,
    horizon: 6,
    plies: [],
    status: "Terminal",
    decisionTraces: [
      trace("d4d7", "MORPHYS", 0.4),
      trace("d4d7", "EPAULETTE", 0.8),
      trace("d4d7", "MORPHYS", 0.9)
    ]
  });
  expect(rendered).toContain("Patterns observed:\n1. Morphy's Mate (MORPHYS) 90.0%\n2. Epaulette Mate (EPAULETTE) 80.0%");
  expect(rendered.match(/MORPHYS/gu)).toHaveLength(2);
});

test("target session live renderer stays compact and defers references to final output", () => {
  const position = chess.ingestPosition("4r3/1k6/pp3r2/1b2P2p/3R1p2/P1R2P2/1P4PP/6K1 w - - 0 35");
  expect(position.tag).toBe("Ok");
  const session = {
    discovery: { tag: "ScenarioLine", mode: "HumanPath", label: "PatternSteeredTalPath", start: position.value, horizon: 2, plies: [], status: "Incomplete" },
    targets: [{ targetFamily: "MORPHYS", triggerPly: 0, triggerAffinity: 0.97, position: position.value, prefixPlies: [] }]
  };
  const live = renderPatternTargetSession("case-live", session);
  expect(live).toContain("Pattern discovery status Incomplete");
  expect(live).toContain("Target Morphy's Mate (MORPHYS) 97% status Running");
  expect(live).not.toContain("Reference PGN:");
  const final = renderPatternTargetReferences("case-live", session);
  expect(final).toContain("########");
  expect(final).toContain("reference unavailable because the target branch did not finish");
});

test("target session renderer keeps only the three shortest terminal targets", () => {
  const position = chess.ingestPosition("4r3/1k6/pp3r2/1b2P2p/3R1p2/P1R2P2/1P4PP/6K1 w - - 0 35");
  expect(position.tag).toBe("Ok");
  const families = ["MORPHYS", "EPAULETTE", "CORNER", "DOVETAIL", "BALESTRA"];
  const lengths = [5, 1, 3, 2, 4];
  const rendered = renderPatternTargetSession("case-ranked", {
    discovery: { tag: "ScenarioLine", mode: "HumanPath", label: "PatternSteeredTalPath", start: position.value, horizon: 10, plies: [], status: "Complete" },
    targets: families.map((targetFamily, index) => ({
      targetFamily,
      triggerPly: 0,
      triggerAffinity: 0.97,
      position: position.value,
      prefixPlies: [],
      line: { tag: "ScenarioLine", mode: "HumanPath", label: "Target", start: position.value, horizon: 10, plies: Array.from({ length: lengths[index] }, () => ({ tag: "ScenarioPly", index: 1, move: { san: "e4", uci: "e2e4" }, provenance: {} })), status: "Terminal" }
    }))
  });
  expect(rendered.match(/^## case-ranked Target /gmu)).toHaveLength(3);
  expect(rendered.indexOf("Dovetail Mate")).toBeLessThan(rendered.indexOf("Corner Mate"));
  expect(rendered).not.toContain("Morphy's Mate");
});

test("pattern steering renderer preserves a raw PGN prefix before continuation", () => {
  const position = chess.ingestRawGame("1. e4 e5 2. Nf3");
  expect(position.tag).toBe("Ok");
  const move = chess.parseLegalMove(position.value, "b8c6");
  expect(move.tag).toBe("Ok");
  const rendered = renderPatternSteeringLine("case-raw", {
    tag: "ScenarioLine",
    mode: "HumanPath",
    label: "PatternSteeredTalPath",
    start: position.value,
    horizon: 2,
    plies: [{ tag: "ScenarioPly", index: 1, move: move.value, provenance: { source: "LOCAL_STYLE_ENGINE", provider: { name: "cstal", displayName: "CSTal" }, status: "IMPORTED", requestId: "request-raw", inputPositionHash: position.value.hash, configuration: {} } }],
    status: "Complete"
  });
  expect(rendered).toContain("1. e4 e5 2. Nf3 Nc6");
});
