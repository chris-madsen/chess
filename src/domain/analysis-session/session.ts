import type { PositionSnapshot } from "../chess/position";
import type { CandidateSeed, ScenarioLine } from "../scenario-lines/scenario-line";

export type PlayerAssessment = Readonly<{
  text: string;
}>;

export type PlayerPlan = Readonly<{
  text: string;
}>;

export type Decision = Readonly<{
  tag: "Decision";
  move: string;
  rationale?: string;
}>;

export type PlatformCommand = Readonly<{
  tag: "PlatformCommand";
  command: "SubmitMove";
  move: string;
}>;

export type AnalysisSession = Readonly<{
  tag: "AnalysisSession";
  id: string;
  position: PositionSnapshot;
  assessment?: PlayerAssessment;
  plan?: PlayerPlan;
  seeds: readonly CandidateSeed[];
  lines: readonly ScenarioLine[];
  decision?: Decision;
}>;

export const recordDecision = (session: AnalysisSession, decision: Decision): AnalysisSession => ({
  ...session,
  decision
});
