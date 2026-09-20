export type LessonTacticalMotifId =
  | "QUEEN_SACRIFICE"
  | "ROOK_SACRIFICE"
  | "EXCHANGE_SACRIFICE"
  | "MINOR_SACRIFICE"
  | "PAWN_SACRIFICE"
  | "DEFLECTION"
  | "DECOY"
  | "REMOVAL_OF_DEFENDER"
  | "LINE_OPENING"
  | "DISCOVERED_ATTACK"
  | "PIN"
  | "OVERLOAD"
  | "CLEARANCE"
  | "KING_HUNT"
  | "MATING_NET"
  | "FORCED_RECAPTURE"
  | "TACTICAL_PROMOTION"
  | "TECHNICAL_PROMOTION_GRIND";

export type TacticalMotif = Readonly<{
  id: LessonTacticalMotifId;
  displayName: string;
  ply: number;
}>;

export const lessonMotifName = (id: LessonTacticalMotifId): string => id
  .toLowerCase()
  .split("_")
  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");
