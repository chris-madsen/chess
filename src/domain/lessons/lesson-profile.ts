import type { PatternFamilyId } from "../patterns/pattern";
import type { UciMove } from "../chess/value-objects";
import type { LessonTacticalMotifId, TacticalMotif } from "./tactical-motifs";

export type SacrificeType = "QUEEN" | "ROOK" | "EXCHANGE" | "MINOR" | "PAWN";
export type SacrificeMotif = "DEFLECTION" | "DECOY" | "LINE_OPENING" | "REMOVAL_OF_DEFENDER" | "BLOCKING" | "KING_EXPOSURE" | "OTHER";

export type SacrificeProfile = Readonly<{
  ply: number;
  type: SacrificeType;
  causal: boolean;
  soundOrForced: boolean;
  mateDistanceAfterSacrifice?: number;
  motif: SacrificeMotif;
}>;

export type CausalMoveContribution = Readonly<{
  ply: number;
  move: UciMove;
  createsThreat: boolean;
  givesCheck: boolean;
  captures: boolean;
  opensLineToKing: boolean;
  removesDefender: boolean;
  activatesPatternRole: boolean;
  patternRoleUsedLater: boolean;
  restrictsKingMobilityDelta: number;
  mateDistanceDelta?: number;
  attractorDelta: number;
  laterDependencyCount: number;
  counterfactualImportance?: number;
}>;

export type LessonQualityTier = "A" | "B" | "C" | "D" | "E" | "SUPPRESSED";

export type LessonProfile = Readonly<{
  lineId: string;
  generatedPlies: number;
  generatedFullMoves: number;
  inputFinalMoveNumber: number;
  finalMateMoveNumber?: number;
  fullRootToTerminalPlies?: number;
  humanPathMate: boolean;
  forcedMateStatus: "VERIFIED" | "NOT_VERIFIED" | "UNAVAILABLE";
  mateFamilies: readonly PatternFamilyId[];
  primaryMateFamily?: PatternFamilyId;
  patternClarity: number;
  sacrifices: readonly SacrificeProfile[];
  forcingness: number;
  causalPreparation: number;
  pieceCoordination: number;
  repetitionCount: number;
  nonProgressMoveCount: number;
  technicalEndgamePenalty: number;
  promotionGrindPenalty: number;
  combinationBeauty: number;
  lessonUtility: number;
  qualityTier: LessonQualityTier;
  motifs: readonly TacticalMotif[];
  causalMoves: readonly CausalMoveContribution[];
  eligible: boolean;
  reasons: readonly string[];
  penalties: readonly string[];
}>;

export type LessonLine = Readonly<{
  lineId: string;
  profile: LessonProfile;
  fullLineSignature?: string;
  source?: string;
}>;

export type ShortAlternativeDecision = Readonly<{
  lessonLineId: string;
  shortTalLineId?: string;
  gapFullMoves: number;
  shown: boolean;
}>;

export type { LessonTacticalMotifId, TacticalMotif };
