import type { PositionSnapshot } from "../chess/position";
import type { Side } from "../chess/value-objects";
import type { PositionFacts } from "../position-intelligence/facts";
import { extractPatternPositionContext, legacyPatternAnalysisContext, type PatternAnalysisContext, type PatternEscapeSquare } from "./context";

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

const pieceType = (piece: string): CanonicalPatternPiece["type"] | undefined => {
  const type = piece.toLowerCase();
  return ["p", "n", "b", "r", "q", "k"].includes(type)
    ? type as CanonicalPatternPiece["type"]
    : undefined;
};

const pieceSide = (piece: string): Side => piece === piece.toUpperCase() ? "white" : "black";

const encode = (
  pieces: readonly Readonly<{ piece: string; file: number; rank: number }>[],
  targetKing: Readonly<{ piece: string; file: number; rank: number }>,
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

const encodeGeometry = (
  escapes: readonly PatternEscapeSquare[],
  targetKing: Readonly<{ file: number; rank: number }>,
  attackingSide: Side,
  fileSign: 1 | -1,
  rankSign: 1 | -1
): string => escapes.map(escape => {
  const file = (escape.square.file - targetKing.file) * fileSign;
  const rank = (escape.square.rank - targetKing.rank) * rankSign;
  const occupied = escape.occupiedBy === undefined ? "-" : escape.occupiedBy === attackingSide ? "a" : "d";
  const flags = `${occupied}:${escape.controlledByAttacker ? "a" : "-"}${escape.controlledByDefender ? "d" : "-"}`;
  return `e${file >= 0 ? "+" : ""}${file},${rank >= 0 ? "+" : ""}${rank}=${flags}`;
}).sort().join(";");

export const canonicalizePatternPosition = (
  position: PositionSnapshot,
  facts: PositionFacts,
  analysis?: PatternAnalysisContext
): CanonicalPatternPosition => {
  const resolvedAnalysis = analysis ?? legacyPatternAnalysisContext(facts);
  const context = extractPatternPositionContext(position, facts, resolvedAnalysis);
  const attackingSide = resolvedAnalysis.attackerSide;
  const pieces = context.relevantPieces.map(piece => ({
    piece: piece.side === "white" ? piece.type.toUpperCase() : piece.type,
    file: piece.square.file,
    rank: piece.square.rank
  }));
  const targetKing = { piece: "k", file: context.targetKing.file, rank: context.targetKing.rank };
  const orientations = ([1, -1] as const).flatMap(fileSign => ([1, -1] as const).map(rankSign => ({ pieces: encode(pieces, targetKing, attackingSide, fileSign, rankSign), geometry: encodeGeometry(context.escapeSquares, targetKing, attackingSide, fileSign, rankSign) })));
  const canonical = [...orientations].sort((a, b) => `${a.pieces}|${a.geometry}`.localeCompare(`${b.pieces}|${b.geometry}`))[0] ?? { pieces: "", geometry: "" };
  const key = `roles:attacker-defender|pieces:${canonical.pieces}|geometry:${canonical.geometry}`;
  const canonicalOrientation = canonical.pieces;
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
