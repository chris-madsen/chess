import type { PositionSnapshot } from "../chess/position";
import type { Side } from "../chess/value-objects";
import type { PositionFacts } from "../position-intelligence/facts";

export type PatternSquare = Readonly<{ file: number; rank: number }>;
export type PatternPieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type PatternRelationKind =
  | "ATTACKS"
  | "DEFENDS"
  | "BLOCKS"
  | "PINS"
  | "XRAYS"
  | "OCCUPIES"
  | "CAN_CAPTURE"
  | "CAN_INTERPOSE"
  | "CAN_REACH_IN_1"
  | "CAN_REACH_IN_2"
  | "CONTROLS_ESCAPE";

export type PatternAnalysisContext = Readonly<{
  tag: "PatternAnalysisContext";
  attackerSide: Side;
  defenderSide: Side;
}>;

export type PatternRelevantPiece = Readonly<{
  side: Side;
  type: PatternPieceType;
  square: PatternSquare;
}>;

export type PatternEscapeSquare = Readonly<{
  square: PatternSquare;
  occupiedBy?: Side;
  controlledByAttacker: boolean;
  controlledByDefender: boolean;
}>;

export type PatternRelation = Readonly<{
  kind: PatternRelationKind;
  from?: PatternSquare;
  to: PatternSquare;
  pieceType?: PatternPieceType;
}>;

export type PatternPositionContext = Readonly<{
  tag: "PatternPositionContext";
  analysis: PatternAnalysisContext;
  targetKing: PatternSquare;
  kingOnEdge: boolean;
  kingInCorner: boolean;
  kingOnHomeRank: boolean;
  escapeSquares: readonly PatternEscapeSquare[];
  relevantPieces: readonly PatternRelevantPiece[];
  relations: readonly PatternRelation[];
  canonicalSourceVersion: string;
}>;

type BoardPiece = Readonly<{ side: Side; type: PatternPieceType; square: PatternSquare }>;
type Board = readonly BoardPiece[];

const opposite = (side: Side): Side => side === "white" ? "black" : "white";
const inBoard = (file: number, rank: number): boolean => file >= 0 && file < 8 && rank >= 0 && rank < 8;
const sameSquare = (first: PatternSquare, second: PatternSquare): boolean => first.file === second.file && first.rank === second.rank;
const squareKey = (square: PatternSquare): string => `${square.file},${square.rank}`;

const parseBoard = (fen: string): Board => {
  const pieces: BoardPiece[] = [];
  let rank = 7;
  let file = 0;
  for (const token of fen.trim().split(/\s+/u)[0] ?? "") {
    if (token === "/") {
      rank -= 1;
      file = 0;
      continue;
    }
    if (/^[1-8]$/u.test(token)) {
      file += Number(token);
      continue;
    }
    if (inBoard(file, rank) && "pnbrqk".includes(token.toLowerCase())) {
      pieces.push({
        side: token === token.toUpperCase() ? "white" : "black",
        type: token.toLowerCase() as PatternPieceType,
        square: { file, rank }
      });
    }
    file += 1;
  }
  return pieces;
};

const pieceAt = (board: Board, square: PatternSquare): BoardPiece | undefined => board.find(piece => sameSquare(piece.square, square));
const kingFor = (board: Board, side: Side): BoardPiece | undefined => board.find(piece => piece.side === side && piece.type === "k");
const adjacentSquares = (square: PatternSquare): readonly PatternSquare[] => (
  [-1, 0, 1].flatMap(fileDelta => [-1, 0, 1]
    .filter(rankDelta => fileDelta !== 0 || rankDelta !== 0)
    .map(rankDelta => ({ file: square.file + fileDelta, rank: square.rank + rankDelta })))
    .filter(candidate => inBoard(candidate.file, candidate.rank))
);

const rayDirections: Readonly<Record<PatternPieceType, readonly PatternSquare[]>> = {
  p: [], n: [], k: [],
  b: [{ file: 1, rank: 1 }, { file: 1, rank: -1 }, { file: -1, rank: 1 }, { file: -1, rank: -1 }],
  r: [{ file: 1, rank: 0 }, { file: -1, rank: 0 }, { file: 0, rank: 1 }, { file: 0, rank: -1 }],
  q: [{ file: 1, rank: 1 }, { file: 1, rank: -1 }, { file: -1, rank: 1 }, { file: -1, rank: -1 }, { file: 1, rank: 0 }, { file: -1, rank: 0 }, { file: 0, rank: 1 }, { file: 0, rank: -1 }]
};

const attacksSquare = (piece: BoardPiece, target: PatternSquare, board: Board): boolean => {
  const fileDelta = target.file - piece.square.file;
  const rankDelta = target.rank - piece.square.rank;
  const absFile = Math.abs(fileDelta);
  const absRank = Math.abs(rankDelta);
  if (piece.type === "n") return (absFile === 1 && absRank === 2) || (absFile === 2 && absRank === 1);
  if (piece.type === "k") return Math.max(absFile, absRank) === 1;
  if (piece.type === "p") {
    const direction = piece.side === "white" ? 1 : -1;
    return rankDelta === direction && absFile === 1;
  }
  const directions = rayDirections[piece.type];
  const direction = directions.find(candidate => {
    const length = Math.max(absFile, absRank);
    return length > 0 && candidate.file * length === fileDelta && candidate.rank * length === rankDelta;
  });
  if (direction === undefined) return false;
  const length = Math.max(absFile, absRank);
  return Array.from({ length: Math.max(0, length - 1) }, (_, index) => ({
    file: piece.square.file + direction.file * (index + 1),
    rank: piece.square.rank + direction.rank * (index + 1)
  })).every(square => pieceAt(board, square) === undefined);
};

const controls = (board: Board, side: Side, square: PatternSquare): readonly BoardPiece[] => board.filter(piece => piece.side === side && attacksSquare(piece, square, board));

const relevant = (board: Board, context: PatternAnalysisContext, king: PatternSquare, escapes: readonly PatternEscapeSquare[]): readonly PatternRelevantPiece[] => {
  const criticalSquares = [king, ...escapes.map(escape => escape.square)];
  return board.filter(piece => (
    criticalSquares.some(square => attacksSquare(piece, square, board))
    || (piece.side === context.attackerSide && ["n", "b", "r", "q"].includes(piece.type) && Math.max(Math.abs(piece.square.file - king.file), Math.abs(piece.square.rank - king.rank)) <= 3)
    || sameSquare(piece.square, king)
  )).map(piece => ({ side: piece.side, type: piece.type, square: piece.square }));
};

export const makePatternAnalysisContext = (attackerSide: Side): PatternAnalysisContext => ({
  tag: "PatternAnalysisContext",
  attackerSide,
  defenderSide: opposite(attackerSide)
});

export const extractPatternPositionContext = (
  position: PositionSnapshot,
  facts: PositionFacts,
  analysis: PatternAnalysisContext
): PatternPositionContext => {
  const board = parseBoard(String(position.fen));
  const targetKing = kingFor(board, analysis.defenderSide)?.square ?? { file: 4, rank: analysis.defenderSide === "white" ? 0 : 7 };
  const escapeSquares = adjacentSquares(targetKing).map(square => {
    const occupant = pieceAt(board, square);
    return {
      square,
      ...(occupant === undefined ? {} : { occupiedBy: occupant.side }),
      controlledByAttacker: controls(board, analysis.attackerSide, square).length > 0,
      controlledByDefender: controls(board, analysis.defenderSide, square).length > 0
    };
  });
  const relevantPieces = relevant(board, analysis, targetKing, escapeSquares);
  const relations: PatternRelation[] = [];
  for (const piece of relevantPieces) {
    for (const square of [targetKing, ...escapeSquares.map(escape => escape.square)]) {
      if (!attacksSquare({ ...piece }, square, board)) continue;
      relations.push({
        kind: squareKey(square) === squareKey(targetKing) ? "ATTACKS" : "CONTROLS_ESCAPE",
        from: piece.square,
        to: square,
        pieceType: piece.type
      });
    }
  }
  for (const escape of escapeSquares.filter(value => value.occupiedBy !== undefined)) {
    relations.push({ kind: "BLOCKS", to: escape.square });
  }
  return {
    tag: "PatternPositionContext",
    analysis,
    targetKing,
    kingOnEdge: targetKing.file === 0 || targetKing.file === 7 || targetKing.rank === 0 || targetKing.rank === 7,
    kingInCorner: [0, 7].includes(targetKing.file) && [0, 7].includes(targetKing.rank),
    kingOnHomeRank: targetKing.rank === (analysis.defenderSide === "white" ? 0 : 7),
    escapeSquares,
    relevantPieces,
    relations,
    canonicalSourceVersion: "pattern-context-v1"
  };
};

export const legacyPatternAnalysisContext = (facts: PositionFacts): PatternAnalysisContext => (
  makePatternAnalysisContext(facts.isCheckmate ? opposite(facts.sideToMove) : facts.sideToMove)
);

export const relationExists = (
  context: PatternPositionContext,
  kind: PatternRelationKind,
  predicate: (relation: PatternRelation) => boolean = () => true
): boolean => context.relations.some(relation => relation.kind === kind && predicate(relation));

export const piecesOf = (context: PatternPositionContext, side: Side, type?: PatternPieceType): readonly PatternRelevantPiece[] => context.relevantPieces.filter(piece => piece.side === side && (type === undefined || piece.type === type));

export const controlledEscapeCount = (context: PatternPositionContext): number => context.escapeSquares.filter(escape => escape.controlledByAttacker || escape.occupiedBy === context.analysis.defenderSide).length;
