import type { Fen, PositionHash, Side } from "./value-objects";
import type { LegalMove } from "./moves";

export type PositionSnapshot = Readonly<{
  tag: "PositionSnapshot";
  fen: Fen;
  sideToMove: Side;
  hash: PositionHash;
  legalMoves: readonly LegalMove[];
  pgn?: string;
}>;
