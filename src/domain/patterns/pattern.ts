import type { PositionSnapshot } from "../chess/position";
import type { Side } from "../chess/value-objects";
import type { PositionFacts } from "../position-intelligence/facts";

export type PatternFamilyId =
  | "ANASTASIA"
  | "BODEN"
  | "PILLSBURY"
  | "ARABIAN"
  | "SMOTHERED"
  | "BACK_RANK";

export type PatternState = "far" | "promising" | "forming" | "near" | "mate_basin";

export type PatternEvidence = Readonly<{
  kind: "KING_CENTRIC" | "ATTACK_GEOMETRY" | "TACTICAL_SIGNAL";
  label: string;
  score: number;
}>;

export type PatternAssessment = Readonly<{
  tag: "PatternAssessment";
  family: PatternFamilyId;
  similarity: number;
  progress: number;
  state: PatternState;
  evidence: readonly PatternEvidence[];
  modelVersion: string;
}>;

export type PatternFeatures = Readonly<{
  attackingSide: Side;
  targetKingFile: number;
  targetKingRank: number;
  targetKingOnEdge: boolean;
  targetKingInCorner: boolean;
  adjacentFriendlyBlockers: number;
  adjacentEmptySquares: number;
  nearbyKnightCount: number;
  nearbyRookQueenCount: number;
  attackingBishopCount: number;
  legalCheckCount: number;
  legalCaptureCount: number;
  isCheck: boolean;
  isCheckmate: boolean;
}>;

export const PATTERN_MODEL_VERSION = "symbolic-v1";
export const PATTERN_MATCH_THRESHOLD = 0.65;

const opposite = (side: Side): Side => side === "white" ? "black" : "white";
const inBoard = (file: number, rank: number): boolean => file >= 0 && file < 8 && rank >= 0 && rank < 8;
const pieceSide = (piece: string): Side => piece === piece.toUpperCase() ? "white" : "black";
const pieceType = (piece: string): string => piece.toLowerCase();

type Board = readonly (string | undefined)[][];

const boardFromFen = (fen: string): Board => {
  const placement = String(fen).trim().split(/\s+/)[0] ?? "";
  const board: (string | undefined)[][] = Array.from({ length: 8 }, () => Array<string | undefined>(8).fill(undefined));
  let rank = 7;
  let file = 0;
  for (const token of placement) {
    if (token === "/") {
      rank -= 1;
      file = 0;
    } else if (/^[1-8]$/u.test(token)) {
      file += Number(token);
    } else if (inBoard(file, rank)) {
      const row = board[rank];
      if (row !== undefined) {
        row[file] = token;
      }
      file += 1;
    }
  }
  return board;
};

const findKing = (board: Board, side: Side): Readonly<{ file: number; rank: number }> => {
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[rank]?.[file];
      if (piece !== undefined && pieceType(piece) === "k" && pieceSide(piece) === side) {
        return { file, rank };
      }
    }
  }
  return { file: 4, rank: side === "white" ? 0 : 7 };
};

const adjacentSquares = (file: number, rank: number): readonly Readonly<{ file: number; rank: number }>[] => (
  [-1, 0, 1].flatMap(fileDelta => [-1, 0, 1]
    .filter(rankDelta => fileDelta !== 0 || rankDelta !== 0)
    .map(rankDelta => ({ file: file + fileDelta, rank: rank + rankDelta })))
    .filter(square => inBoard(square.file, square.rank))
);

const distance = (first: Readonly<{ file: number; rank: number }>, second: Readonly<{ file: number; rank: number }>): number => (
  Math.max(Math.abs(first.file - second.file), Math.abs(first.rank - second.rank))
);

export const extractPatternFeatures = (position: PositionSnapshot, facts: PositionFacts): PatternFeatures => {
  const board = boardFromFen(String(position.fen));
  const attackingSide = facts.isCheckmate ? opposite(facts.sideToMove) : facts.sideToMove;
  const targetKing = findKing(board, opposite(attackingSide));
  const adjacent = adjacentSquares(targetKing.file, targetKing.rank);
  const adjacentFriendlyBlockers = adjacent.filter(square => {
    const piece = board[square.rank]?.[square.file];
    return piece !== undefined && pieceSide(piece) === opposite(attackingSide);
  }).length;
  const adjacentEmptySquares = adjacent.filter(square => board[square.rank]?.[square.file] === undefined).length;
  const nearbyPieces = board.flatMap((row, rank) => row.map((piece, file) => (
    piece === undefined || pieceSide(piece) !== attackingSide ? undefined : { piece, file, rank }
  ))).filter((piece): piece is Readonly<{ piece: string; file: number; rank: number }> => piece !== undefined);
  const nearbyKnightCount = nearbyPieces.filter(piece => pieceType(piece.piece) === "n" && distance(piece, targetKing) <= 2).length;
  const nearbyRookQueenCount = nearbyPieces.filter(piece => ["r", "q"].includes(pieceType(piece.piece)) && distance(piece, targetKing) <= 3).length;
  const attackingBishopCount = nearbyPieces.filter(piece => pieceType(piece.piece) === "b").length;

  return {
    attackingSide,
    targetKingFile: targetKing.file,
    targetKingRank: targetKing.rank,
    targetKingOnEdge: targetKing.file === 0 || targetKing.file === 7 || targetKing.rank === 0 || targetKing.rank === 7,
    targetKingInCorner: [0, 7].includes(targetKing.file) && [0, 7].includes(targetKing.rank),
    adjacentFriendlyBlockers,
    adjacentEmptySquares,
    nearbyKnightCount,
    nearbyRookQueenCount,
    attackingBishopCount,
    legalCheckCount: facts.legalChecks.length,
    legalCaptureCount: facts.legalCaptures.length,
    isCheck: facts.isCheck,
    isCheckmate: facts.isCheckmate
  };
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const evidence = (kind: PatternEvidence["kind"], label: string, score: number): PatternEvidence => ({ kind, label, score: clamp(score) });
const normalized = (value: number, maximum: number): number => clamp(value / maximum);

const scoreFamily = (family: PatternFamilyId, features: PatternFeatures): Readonly<{ score: number; evidence: readonly PatternEvidence[] }> => {
  const edge = features.targetKingOnEdge ? 1 : 0;
  const corner = features.targetKingInCorner ? 1 : 0;
  const blockers = normalized(features.adjacentFriendlyBlockers, 5);
  const knights = normalized(features.nearbyKnightCount, 2);
  const rooks = normalized(features.nearbyRookQueenCount, 2);
  const bishops = normalized(features.attackingBishopCount, 2);
  const checks = features.isCheck || features.isCheckmate ? 1 : normalized(features.legalCheckCount, 2);
  const captures = normalized(features.legalCaptureCount, 4);
  const scores: Readonly<Record<PatternFamilyId, Readonly<{ score: number; evidence: readonly PatternEvidence[] }>>> = {
    ANASTASIA: {
      score: 0.3 * edge + 0.3 * knights + 0.25 * rooks + 0.15 * blockers,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "nearby knight", knights), evidence("ATTACK_GEOMETRY", "nearby rook or queen", rooks)]
    },
    BODEN: {
      score: 0.35 * bishops + 0.25 * checks + 0.2 * captures + 0.2 * (1 - edge),
      evidence: [evidence("ATTACK_GEOMETRY", "bishop pair potential", bishops), evidence("TACTICAL_SIGNAL", "check pressure", checks), evidence("TACTICAL_SIGNAL", "capture pressure", captures)]
    },
    PILLSBURY: {
      score: 0.3 * blockers + 0.3 * rooks + 0.25 * checks + 0.15 * knights,
      evidence: [evidence("KING_CENTRIC", "restricted king mobility", blockers), evidence("ATTACK_GEOMETRY", "heavy-piece pressure", rooks), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    ARABIAN: {
      score: 0.35 * edge + 0.3 * corner + 0.2 * knights + 0.15 * rooks,
      evidence: [evidence("KING_CENTRIC", "corner or edge king", Math.max(edge, corner)), evidence("ATTACK_GEOMETRY", "nearby knight", knights), evidence("ATTACK_GEOMETRY", "nearby rook or queen", rooks)]
    },
    SMOTHERED: {
      score: 0.35 * corner + 0.35 * blockers + 0.2 * knights + 0.1 * checks,
      evidence: [evidence("KING_CENTRIC", "corner king", corner), evidence("KING_CENTRIC", "friendly blockers", blockers), evidence("ATTACK_GEOMETRY", "nearby knight", knights)]
    },
    BACK_RANK: {
      score: 0.4 * edge + 0.35 * blockers + 0.2 * rooks + 0.05 * checks,
      evidence: [evidence("KING_CENTRIC", "back-rank king", edge), evidence("KING_CENTRIC", "friendly blockers", blockers), evidence("ATTACK_GEOMETRY", "heavy-piece pressure", rooks)]
    }
  };
  return scores[family];
};

const stateFor = (similarity: number): PatternState => (
  similarity >= 0.8 ? "mate_basin" : similarity >= 0.65 ? "near" : similarity >= 0.45 ? "forming" : similarity >= 0.25 ? "promising" : "far"
);

export const assessPattern = (
  position: PositionSnapshot,
  facts: PositionFacts,
  family: PatternFamilyId,
  previousSimilarity = 0
): PatternAssessment => {
  const features = extractPatternFeatures(position, facts);
  const scored = scoreFamily(family, features);
  const similarity = clamp(scored.score);
  return {
    tag: "PatternAssessment",
    family,
    similarity,
    progress: similarity - previousSimilarity,
    state: stateFor(similarity),
    evidence: scored.evidence,
    modelVersion: PATTERN_MODEL_VERSION
  };
};

export const isPatternAssessment = (value: unknown): value is PatternAssessment => {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PatternAssessment>;
  return candidate.tag === "PatternAssessment"
    && typeof candidate.family === "string"
    && typeof candidate.similarity === "number"
    && typeof candidate.progress === "number"
    && typeof candidate.state === "string"
    && Array.isArray(candidate.evidence)
    && typeof candidate.modelVersion === "string";
};
