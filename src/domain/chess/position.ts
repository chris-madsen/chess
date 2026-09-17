import type { Fen, PositionHash, Side, UciMove } from "./value-objects";
import type { LegalMove } from "./moves";

export type UciPositionCommand = Readonly<
  | { base: "startpos"; moves: readonly UciMove[] }
  | { base: "fen"; fen: Fen; moves: readonly UciMove[] }
>;

export type PositionSnapshot = Readonly<{
  tag: "PositionSnapshot";
  fen: Fen;
  sideToMove: Side;
  hash: PositionHash;
  legalMoves: readonly LegalMove[];
  uciPosition: UciPositionCommand;
  pgn?: string;
}>;
