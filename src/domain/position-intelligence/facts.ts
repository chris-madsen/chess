import type { LegalMove } from "../chess/moves";
import type { Side } from "../chess/value-objects";

export type MaterialInventory = Readonly<Record<Side, Readonly<Record<string, number>>>>;

export type PositionFacts = Readonly<{
  tag: "PositionFacts";
  sideToMove: Side;
  material: MaterialInventory;
  legalChecks: readonly LegalMove[];
  legalCaptures: readonly LegalMove[];
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  isTerminal: boolean;
  tacticalNotes: readonly string[];
}>;
