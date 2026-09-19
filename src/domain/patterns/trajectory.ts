import type { LegalMove } from "../chess/moves";
import type { PositionSnapshot } from "../chess/position";
import type { PatternFamilyId, PatternKind } from "./pattern";
import type { PatternPositionContext } from "./context";

export type PatternTrajectoryContext = Readonly<{
  attackerSide: "white" | "black";
  positions: readonly PositionSnapshot[];
  moves: readonly LegalMove[];
  geometryContexts: readonly PatternPositionContext[];
}>;

export type PatternTrajectoryEvent = "KING_REGION_CHANGE" | "COVERAGE_INCREASE" | "BLOCKER_CHANGE";
export type PatternTrajectoryStage = Readonly<{
  id: string;
  event: PatternTrajectoryEvent;
  criticality: "critical" | "supporting";
}>;
export type PatternTrajectoryDescriptor = Readonly<{
  family: PatternFamilyId;
  kind: Exclude<PatternKind, "MATE_GEOMETRY">;
  stages: readonly PatternTrajectoryStage[];
}>;
export type PatternTrajectoryScore = Readonly<{
  affinity: number;
  completedStages: number;
  evidence: readonly string[];
}>;

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const region = (context: PatternPositionContext): string => context.kingInCorner ? "CORNER" : context.kingOnHomeRank ? "HOME_RANK" : context.kingOnEdge ? "EDGE" : "CENTER";
const coverage = (context: PatternPositionContext): number => context.escapeSquares.filter(square => square.controlledByAttacker || square.occupiedBy === context.analysis.defenderSide).length / Math.max(1, context.escapeSquares.length);
const blockers = (context: PatternPositionContext): number => context.escapeSquares.filter(square => square.occupiedBy === context.analysis.defenderSide).length / Math.max(1, context.escapeSquares.length);

export const PATTERN_TRAJECTORY_DESCRIPTORS: readonly PatternTrajectoryDescriptor[] = [
  { family: "LEGAL", kind: "MATING_SEQUENCE", stages: [{ id: "tactical-displacement", event: "BLOCKER_CHANGE", criticality: "critical" }, { id: "new-attack-lane", event: "COVERAGE_INCREASE", criticality: "supporting" }] },
  { family: "LAWNMOWER", kind: "MATING_SEQUENCE", stages: [{ id: "king-compression", event: "KING_REGION_CHANGE", criticality: "critical" }, { id: "rank-control", event: "COVERAGE_INCREASE", criticality: "critical" }] },
  { family: "ANDERSSEN", kind: "HYBRID", stages: [{ id: "line-opening", event: "BLOCKER_CHANGE", criticality: "critical" }, { id: "diagonal-corridor", event: "COVERAGE_INCREASE", criticality: "supporting" }] },
  { family: "MAX_LANGE", kind: "HYBRID", stages: [{ id: "corridor-opening", event: "BLOCKER_CHANGE", criticality: "critical" }, { id: "king-confinement", event: "COVERAGE_INCREASE", criticality: "supporting" }] },
  { family: "DAMIANO", kind: "HYBRID", stages: [{ id: "queen-entry", event: "KING_REGION_CHANGE", criticality: "critical" }] },
  { family: "GRECO", kind: "HYBRID", stages: [{ id: "bishop-line-opening", event: "BLOCKER_CHANGE", criticality: "critical" }] },
  { family: "LOLLI", kind: "HYBRID", stages: [{ id: "pawn-shelter-break", event: "BLOCKER_CHANGE", criticality: "critical" }] },
  { family: "BLACKBURNE", kind: "HYBRID", stages: [{ id: "minor-piece-sacrifice", event: "BLOCKER_CHANGE", criticality: "critical" }] },
  { family: "MAYET", kind: "HYBRID", stages: [{ id: "king-edge-displacement", event: "KING_REGION_CHANGE", criticality: "critical" }] },
  { family: "RETI", kind: "HYBRID", stages: [{ id: "diagonal-opening", event: "BLOCKER_CHANGE", criticality: "critical" }] },
  { family: "SUFFOCATION", kind: "HYBRID", stages: [{ id: "escape-reduction", event: "COVERAGE_INCREASE", criticality: "critical" }] },
  { family: "DAVID_GOLIATH", kind: "HYBRID", stages: [{ id: "king-confinement", event: "KING_REGION_CHANGE", criticality: "critical" }] },
  { family: "TWO_KNIGHTS", kind: "MATING_SEQUENCE", stages: [{ id: "first-knight-net", event: "COVERAGE_INCREASE", criticality: "critical" }, { id: "second-knight-net", event: "BLOCKER_CHANGE", criticality: "supporting" }] },
  { family: "H_FILE", kind: "HYBRID", stages: [{ id: "file-opening", event: "BLOCKER_CHANGE", criticality: "critical" }] },
  { family: "DIAGONAL_CORRIDOR", kind: "HYBRID", stages: [{ id: "diagonal-opening", event: "BLOCKER_CHANGE", criticality: "critical" }] }
];

export const patternTrajectoryDescriptorFor = (family: PatternFamilyId): PatternTrajectoryDescriptor | undefined => PATTERN_TRAJECTORY_DESCRIPTORS.find(descriptor => descriptor.family === family);

const eventAffinity = (event: PatternTrajectoryEvent, before: PatternPositionContext, after: PatternPositionContext): number => {
  if (event === "KING_REGION_CHANGE") return region(before) === region(after) ? 0 : 1;
  if (event === "COVERAGE_INCREASE") return clamp(0.5 + (coverage(after) - coverage(before)) * 2);
  return clamp(0.5 + (blockers(after) - blockers(before)) * 2);
};

export const scorePatternTrajectory = (context: PatternTrajectoryContext, descriptor: PatternTrajectoryDescriptor): PatternTrajectoryScore => {
  const transitions = Math.min(context.geometryContexts.length - 1, context.moves.length);
  let transitionIndex = 0;
  let total = 0;
  const evidence: string[] = [];
  let completedStages = 0;
  for (const stage of descriptor.stages) {
    let best = 0;
    for (; transitionIndex < transitions; transitionIndex += 1) {
      const before = context.geometryContexts[transitionIndex];
      const after = context.geometryContexts[transitionIndex + 1];
      if (before === undefined || after === undefined) continue;
      const affinity = eventAffinity(stage.event, before, after);
      best = Math.max(best, affinity);
      if (affinity >= 0.65) {
        transitionIndex += 1;
        break;
      }
    }
    total += best * (stage.criticality === "critical" ? 1.25 : 1);
    if (best >= 0.65) {
      completedStages += 1;
      evidence.push(stage.id);
    }
  }
  const weight = descriptor.stages.reduce((sum, stage) => sum + (stage.criticality === "critical" ? 1.25 : 1), 0);
  return { affinity: clamp(total / Math.max(1, weight)), completedStages, evidence };
};
