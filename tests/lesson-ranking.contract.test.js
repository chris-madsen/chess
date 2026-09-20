import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { analyzeLessonLine } from "../src/application/use-cases/analyze-combination.ts";
import { chooseShortTalAlternative, rankLessonLines } from "../src/application/use-cases/rank-lesson-lines.ts";
import { makePlyIndex, makeScenarioHorizon } from "../src/domain/chess/value-objects.ts";

const chess = createChessJsRulesAdapter();
const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

const lineFrom = (fen, moves, label = "fixture") => {
  const start = mustOk(chess.ingestPosition(fen));
  const horizon = mustOk(makeScenarioHorizon(Math.max(1, moves.length)));
  let position = start;
  const plies = [];
  for (const [index, uci] of moves.entries()) {
    const move = mustOk(chess.parseLegalMove(position, uci));
    plies.push({ tag: "ScenarioPly", index: makePlyIndex(index + 1), move, provenance: {
      source: index % 2 === 0 ? "LOCAL_STYLE_ENGINE" : "MAIA",
      provider: { name: index % 2 === 0 ? "cstal" : "maia", displayName: index % 2 === 0 ? "CSTal" : "Maia" },
      status: "IMPORTED", requestId: `fixture-${index}`, inputPositionHash: position.hash, configuration: {}
    } });
    position = mustOk(chess.applyMove(position, move));
  }
  return { tag: "ScenarioLine", mode: "HumanPath", label, start, horizon, plies, status: "Terminal" };
};

test("lesson analysis scores only the generated continuation", () => {
  const start = mustOk(chess.ingestRawGame("1. e4 e5 2. Nf3 Nc6"));
  const move = mustOk(chess.parseLegalMove(start, "f1b5"));
  const line = { tag: "ScenarioLine", mode: "HumanPath", label: "history-root", start, horizon: mustOk(makeScenarioHorizon(4)), plies: [{ tag: "ScenarioPly", index: makePlyIndex(1), move, provenance: { source: "LOCAL_STYLE_ENGINE", provider: { name: "cstal", displayName: "CSTal" }, status: "IMPORTED", requestId: "history", inputPositionHash: start.hash, configuration: {} } }], status: "Complete" };
  const profile = analyzeLessonLine(chess, line);
  expect(profile.generatedPlies).toBe(1);
  expect(profile.generatedFullMoves).toBe(1);
  expect(profile.inputFinalMoveNumber).toBe(3);
});

test("queen sacrifice fixture is recognized as a short tactical lesson", () => {
  const line = lineFrom(
    "r1k4r/ppp1bq1p/2n1N3/6B1/3p2Q1/8/PPP2PPP/R5K1 w - - 0 1",
    ["e6c5", "f7e6", "g4e6", "c8b8", "c5d7", "b8c8", "d7b6", "c8b8", "e6c8", "h8c8", "b6d7"],
    "queen-sac-smothered"
  );
  const profile = analyzeLessonLine(chess, line, { forcedMateStatus: "VERIFIED" });
  expect(profile.humanPathMate).toBe(true);
  expect(profile.sacrifices.some(sacrifice => sacrifice.type === "QUEEN")).toBe(true);
  expect(profile.motifs.some(motif => motif.id === "QUEEN_SACRIFICE")).toBe(true);
  expect(profile.generatedFullMoves).toBeLessThanOrEqual(6);
  expect(profile.qualityTier).toBe("A");
});

test("ordinary queen and bishop mate can still be an eligible short lesson", () => {
  const line = lineFrom("7k/5Q2/6BK/8/8/8/8/8 w - - 0 1", ["f7f8"], "ordinary-queen-bishop-mate");
  const profile = analyzeLessonLine(chess, line);
  expect(profile.humanPathMate).toBe(true);
  expect(profile.eligible).toBe(true);
  expect(profile.qualityTier).not.toBe("SUPPRESSED");
});

const profile = (lineId, moves, utility, tier = "B", eligible = true) => ({
  lineId, generatedPlies: moves * 2, generatedFullMoves: moves, inputFinalMoveNumber: 20,
  fullRootToTerminalPlies: moves * 2, humanPathMate: eligible, forcedMateStatus: "UNAVAILABLE",
  mateFamilies: [], patternClarity: 0.8, sacrifices: [], forcingness: 0.7, causalPreparation: 0.7,
  pieceCoordination: 0.7, repetitionCount: 0, nonProgressMoveCount: 0, technicalEndgamePenalty: 0,
  promotionGrindPenalty: 0, combinationBeauty: utility, lessonUtility: utility, qualityTier: tier,
  motifs: [], causalMoves: [], eligible, reasons: [], penalties: []
});

test("educational ranking allows a strong short-range lesson over a shorter Tal line", () => {
  const ranked = rankLessonLines([
    { value: "pattern", profile: profile("pattern", 12, 0.96, "A") },
    { value: "tal", profile: profile("tal", 8, 0.71, "B") }
  ], 2);
  expect(ranked[0]?.value).toBe("pattern");
});

test("a Tal line more than seven full moves shorter is exposed as an alternative", () => {
  const lesson = { value: "lesson", profile: profile("lesson", 16, 0.96, "C") };
  const tal = { value: "tal", profile: profile("tal", 8, 0.8, "B") };
  const decision = chooseShortTalAlternative(lesson, [tal]);
  expect(decision).toEqual({ lessonLineId: "lesson", shortTalLineId: "tal", gapFullMoves: 8, shown: true });
});

test("technical lines are suppressed even when their pattern clarity is high", () => {
  const ranked = rankLessonLines([
    { value: "technical", profile: { ...profile("technical", 24, 0.7, "SUPPRESSED", false), technicalEndgamePenalty: 0.9 } },
    { value: "clean", profile: profile("clean", 8, 0.8, "B") }
  ], 2);
  expect(ranked[0]?.value).toBe("clean");
});
