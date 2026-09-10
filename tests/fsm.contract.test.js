import { transitionAnalysisSession, transitionScenarioLine } from "../src/domain/index.ts";

const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

test("AnalysisSessionFSM follows allowed lifecycle", () => {
  const reasoning = mustOk(transitionAnalysisSession({ tag: "Created" }, "RecordReasoning"));
  const seeds = mustOk(transitionAnalysisSession(reasoning.state, "AcceptSeeds"));
  const generating = mustOk(transitionAnalysisSession(seeds.state, "StartGeneration"));
  const ready = mustOk(transitionAnalysisSession(generating.state, "CompleteGeneration"));
  const decision = mustOk(transitionAnalysisSession(ready.state, "RecordDecision"));
  expect(decision.state.tag).toBe("DecisionRecorded");
});

test("ScenarioLineFSM follows HumanPath lifecycle", () => {
  const accepted = mustOk(transitionScenarioLine({ tag: "SeedPending" }, "AcceptSeed"));
  const maia = mustOk(transitionScenarioLine(accepted.state, "RequestMaia"));
  const stockfish = mustOk(transitionScenarioLine(maia.state, "AcceptMaia"));
  const nextMaia = mustOk(transitionScenarioLine(stockfish.state, "AcceptStockfish"));
  expect(nextMaia.state.tag).toBe("AwaitingMaia");
});
