import type { LegalMove } from "../chess/moves";
import type { PositionSnapshot } from "../chess/position";
import type { PlyIndex, ScenarioHorizon } from "../chess/value-objects";
import type { MoveProvenance, MoveSource } from "../provenance/provenance";
import type { DomainError } from "../shared/errors";
import type { PatternFamilyId } from "../patterns/pattern";

export type ScenarioMode = "HumanPath" | "RefutationPath" | "StylePath" | "PuzzleMode";
export type ScenarioLineStatus = "Complete" | "Incomplete" | "Terminal" | "Failed";

export type CandidateSeed = Readonly<{
  tag: "CandidateSeed";
  move: LegalMove;
  provenance: MoveProvenance;
  /** All providers that proposed this UCI move after candidate-pool dedupe. */
  proposedBy?: readonly MoveProvenance[];
}>;

export type ScenarioPly = Readonly<{
  tag: "ScenarioPly";
  index: PlyIndex;
  move: LegalMove;
  provenance: MoveProvenance;
}>;

export type ScenarioDecisionTrace = Readonly<{
  positionHash: string;
  candidates: readonly Readonly<{
    uci: string;
    source: string;
    proposedBy?: readonly string[];
    talAccepted: boolean;
    talRequired?: boolean;
    talReason?: string;
    talScore?: Readonly<{ kind: "centipawns" | "mate"; value: number; bound?: "exact" | "lower" | "upper" }>;
    targetFamily: PatternFamilyId;
    beforeAffinity: number;
    afterCandidateAffinity: number;
    afterMaiaAffinity: number;
    patternDelta: number;
    calibratedBefore: number;
    calibratedAfterMaia: number;
    calibratedProgress: number;
    selected?: boolean;
    trustedTalOrigin?: string;
    candidateClass?: "IMMEDIATE_MATE" | "MATE_CLASS" | "TAL_ANCHOR" | "EXTERNAL";
    overrideMargin?: number;
    selectedReason?: string;
    maiaReply?: string;
  }>[];
  selectedUci: string;
  maiaReply?: string;
  selectedReason?: string;
}>;

export type ScenarioLine = Readonly<{
  tag: "ScenarioLine";
  mode: ScenarioMode;
  label: string;
  start: PositionSnapshot;
  horizon: ScenarioHorizon;
  plies: readonly ScenarioPly[];
  status: ScenarioLineStatus;
  targetFamily?: PatternFamilyId;
  decisionTraces?: readonly ScenarioDecisionTrace[];
  error?: DomainError;
}>;

export const isExternalProbeSource = (source: MoveSource): boolean => (
  source === "LEELA_ALIEN_PROBE" || source === "BORIS_TRAPSKY_PROBE"
);
