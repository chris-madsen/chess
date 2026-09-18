import type { PositionSnapshot } from "../chess/position";
import type { Side } from "../chess/value-objects";
import type { PositionFacts } from "../position-intelligence/facts";

export type CanonicalPatternPiece = Readonly<{
  role: "attacker" | "defender";
  type: "p" | "n" | "b" | "r" | "q" | "k";
  file: number;
  rank: number;
}>;

export type CanonicalPatternPosition = Readonly<{
  tag: "CanonicalPatternPosition";
  attackingSide: Side;
  targetKing: Readonly<{ file: 0; rank: 0 }>;
  pieces: readonly CanonicalPatternPiece[];
  key: string;
}>;

type BoardPiece = Readonly<{ piece: string; file: number; rank: number }>;

const pieceType = (piece: string): CanonicalPatternPiece["type"] | undefined => {
  const type = piece.toLowerCase();
  return ["p", "n", "b", "r", "q", "k"].includes(type)
    ? type as CanonicalPatternPiece["type"]
    : undefined;
};

const pieceSide = (piece: string): Side => piece === piece.toUpperCase() ? "white" : "black";

const boardFromFen = (fen: string): readonly BoardPiece[] => {
  const board: BoardPiece[] = [];
  let rank = 7;
  let file = 0;
  for (const token of String(fen).trim().split(/\s+/u)[0] ?? "") {
    if (token === "/") {
      rank -= 1;
      file = 0;
    } else if (/^[1-8]$/u.test(token)) {
      file += Number(token);
    } else {
      board.push({ piece: token, file, rank });
      file += 1;
    }
  }
  return board;
};

const kingFor = (pieces: readonly BoardPiece[], side: Side): BoardPiece | undefined => pieces.find(piece => pieceSide(piece.piece) === side && pieceType(piece.piece) === "k");

const encode = (
  pieces: readonly BoardPiece[],
  targetKing: BoardPiece,
  attackingSide: Side,
  fileSign: 1 | -1,
  rankSign: 1 | -1
): string => pieces
  .map(piece => {
    const type = pieceType(piece.piece);
    if (type === undefined) return "";
    const role = pieceSide(piece.piece) === attackingSide ? "a" : "d";
    const file = (piece.file - targetKing.file) * fileSign;
    const rank = (piece.rank - targetKing.rank) * rankSign;
    return `${role}${type}${file >= 0 ? "+" : ""}${file},${rank >= 0 ? "+" : ""}${rank}`;
  })
  .sort()
  .join(";");

export const canonicalizePatternPosition = (
  position: PositionSnapshot,
  facts: PositionFacts
): CanonicalPatternPosition => {
  const attackingSide = facts.isCheckmate
    ? facts.sideToMove === "white" ? "black" : "white"
    : facts.sideToMove;
  const pieces = boardFromFen(String(position.fen));
  const targetKing = kingFor(pieces, attackingSide === "white" ? "black" : "white") ?? { piece: "k", file: 4, rank: 0 };
  const orientations = ([1, -1] as const).flatMap(fileSign => ([1, -1] as const).map(rankSign => encode(pieces, targetKing, attackingSide, fileSign, rankSign)));
  const key = `roles:attacker-defender|${[...orientations].sort()[0] ?? ""}`;
  const canonicalOrientation = [...orientations].sort()[0] ?? "";
  const canonicalPieces = canonicalOrientation.split(";").filter(Boolean).map(token => {
    const match = /^(a|d)([pnbrqk])([+-]?\d+),([+-]?\d+)$/u.exec(token);
    if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined || match[4] === undefined) {
      throw new Error("Invalid canonical pattern token");
    }
    return {
      role: match[1] === "a" ? "attacker" : "defender",
      type: match[2] as CanonicalPatternPiece["type"],
      file: Number(match[3]),
      rank: Number(match[4])
    } satisfies CanonicalPatternPiece;
  });
  return {
    tag: "CanonicalPatternPosition",
    attackingSide,
    targetKing: { file: 0, rank: 0 },
    pieces: canonicalPieces,
    key
  };
};
