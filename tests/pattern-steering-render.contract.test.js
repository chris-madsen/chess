import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { renderPatternSteeringLine } from "../src/cli/pattern-steering-render.ts";

const chess = createChessJsRulesAdapter();

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
