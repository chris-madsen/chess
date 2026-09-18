import type { PositionSnapshot } from "../chess/position";
import type { Side } from "../chess/value-objects";
import type { PositionFacts } from "../position-intelligence/facts";
import { legacyPatternAnalysisContext, type PatternAnalysisContext } from "./context";

export type PatternFamilyId =
  | "ANASTASIA"
  | "ARABIAN"
  | "BACK_RANK"
  | "BALESTRA"
  | "BLIND_SWINE"
  | "BODEN"
  | "CORNER"
  | "DOUBLE_BISHOP"
  | "DOVETAIL"
  | "DAMIANO"
  | "GRECO"
  | "LOLLI"
  | "LEGAL"
  | "BLACKBURNE"
  | "ANDERSSEN"
  | "MAYET"
  | "RETI"
  | "MAX_LANGE"
  | "SUFFOCATION"
  | "LAWNMOWER"
  | "DAVID_GOLIATH"
  | "TWO_KNIGHTS"
  | "H_FILE"
  | "DIAGONAL_CORRIDOR"
  | "EPAULETTE"
  | "HOOK"
  | "KILL_BOX"
  | "MORPHYS"
  | "OPERA"
  | "PILLSBURY"
  | "SMOTHERED"
  | "SWALLOWTAIL"
  | "TRIANGLE"
  | "VUKOVIC";

export type PatternFamilyDefinition = Readonly<{
  id: PatternFamilyId;
  canonicalKey: string;
  displayName: string;
  aliases: readonly string[];
  tier: "MVP_NAMED_CORE" | "MVP_EXTENDED";
}>;

/**
 * The product taxonomy is deliberately separate from the scorer. Labels and
 * links are stable catalog data; the symbolic scorer remains a conservative heuristic
 * and does not imply that a high score is a verified mate.
 */
const patternFamilySeeds = [
  ["ANASTASIA", "anastasia_mate", "Anastasia's Mate", "anastasiaMate", "MVP_NAMED_CORE"],
  ["ARABIAN", "arabian_mate", "Arabian Mate", "arabianMate", "MVP_NAMED_CORE"],
  ["BACK_RANK", "back_rank_mate", "Back Rank Mate", "backRankMate", "MVP_NAMED_CORE"],
  ["BALESTRA", "balestra_mate", "Balestra Mate", "balestraMate", "MVP_NAMED_CORE"],
  ["BLIND_SWINE", "blind_swine_mate", "Blind Swine Mate", "blindSwineMate", "MVP_NAMED_CORE"],
  ["BODEN", "boden_mate", "Boden's Mate", "bodenMate", "MVP_NAMED_CORE"],
  ["CORNER", "corner_mate", "Corner Mate", "cornerMate", "MVP_NAMED_CORE"],
  ["DOUBLE_BISHOP", "double_bishop_mate", "Double Bishop Mate", "doubleBishopMate", "MVP_NAMED_CORE"],
  ["DOVETAIL", "dovetail_mate", "Dovetail Mate", "dovetailMate", "MVP_NAMED_CORE"],
  ["EPAULETTE", "epaulette_mate", "Epaulette Mate", "epauletteMate", "MVP_NAMED_CORE"],
  ["HOOK", "hook_mate", "Hook Mate", "hookMate", "MVP_NAMED_CORE"],
  ["KILL_BOX", "kill_box_mate", "Kill Box Mate", "killBoxMate", "MVP_NAMED_CORE"],
  ["PILLSBURY", "pillsburys_mate", "Pillsbury's Mate", "pillsburysMate", "MVP_NAMED_CORE"],
  ["MORPHYS", "morphys_mate", "Morphy's Mate", "morphysMate", "MVP_NAMED_CORE"],
  ["OPERA", "opera_mate", "Opera Mate", "operaMate", "MVP_NAMED_CORE"],
  ["SMOTHERED", "smothered_mate", "Smothered Mate", "smotheredMate", "MVP_NAMED_CORE"],
  ["SWALLOWTAIL", "swallowstail_mate", "Swallow's Tail Mate", "swallowstailMate", "MVP_NAMED_CORE"],
  ["TRIANGLE", "triangle_mate", "Triangle Mate", "triangleMate", "MVP_NAMED_CORE"],
  ["VUKOVIC", "vukovic_mate", "Vukovic Mate", "vukovicMate", "MVP_NAMED_CORE"],
  ["DAMIANO", "damiano_mate", "Damiano's Mate", "damianosMate", "MVP_EXTENDED"],
  ["GRECO", "greco_mate", "Greco's Mate", "grecosMate", "MVP_EXTENDED"],
  ["LOLLI", "lolli_mate", "Lolli's Mate", "lollisMate", "MVP_EXTENDED"],
  ["LEGAL", "legals_mate", "Legal's Mate", "legalsMate", "MVP_EXTENDED"],
  ["BLACKBURNE", "blackburnes_mate", "Blackburne's Mate", "blackburnesMate", "MVP_EXTENDED"],
  ["ANDERSSEN", "anderssens_mate", "Anderssen's Mate", "anderssensMate", "MVP_EXTENDED"],
  ["MAYET", "mayet_mate", "Mayet's Mate", "mayetsMate", "MVP_EXTENDED"],
  ["RETI", "reti_mate", "Réti Mate", "retiMate", "MVP_EXTENDED"],
  ["MAX_LANGE", "max_lange_mate", "Max Lange Mate", "maxLangeMate", "MVP_EXTENDED"],
  ["SUFFOCATION", "suffocation_mate", "Suffocation Mate", "suffocationMate", "MVP_EXTENDED"],
  ["LAWNMOWER", "lawnmower_mate", "Lawnmower Mate", "lawnmowerMate", "MVP_EXTENDED"],
  ["DAVID_GOLIATH", "david_and_goliath_mate", "David and Goliath Mate", "davidAndGoliathMate", "MVP_EXTENDED"],
  ["TWO_KNIGHTS", "two_knights_mate", "Two Knights Mate", "twoKnightsMate", "MVP_EXTENDED"],
  ["H_FILE", "h_file_mate", "h-file Mate", "hFileMate", "MVP_EXTENDED"],
  ["DIAGONAL_CORRIDOR", "diagonal_corridor_mate", "Diagonal Corridor Mate", "diagonalCorridorMate", "MVP_EXTENDED"]
] as const;

export const PATTERN_FAMILY_CATALOG: readonly PatternFamilyDefinition[] = patternFamilySeeds.map(([id, canonicalKey, displayName, sourceKey, tier]) => ({
  id: id as PatternFamilyId,
  canonicalKey,
  displayName,
  aliases: [sourceKey, canonicalKey, displayName],
  tier
}));

export const PATTERN_FAMILY_IDS: readonly PatternFamilyId[] = PATTERN_FAMILY_CATALOG.map(definition => definition.id);
export const STEERABLE_PATTERN_FAMILY_IDS: readonly PatternFamilyId[] = PATTERN_FAMILY_CATALOG.filter(definition => definition.tier === "MVP_NAMED_CORE").map(definition => definition.id);
export const CATALOG_ONLY_PATTERN_FAMILY_IDS: readonly PatternFamilyId[] = PATTERN_FAMILY_CATALOG.filter(definition => definition.tier === "MVP_EXTENDED").map(definition => definition.id);

export const isPatternFamilyId = (value: string): value is PatternFamilyId => PATTERN_FAMILY_IDS.includes(value as PatternFamilyId);

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
  /** Continuous PatternAffinity; similarity is retained as the stable wire name. */
  affinity?: number;
  progress: number;
  state: PatternState;
  evidence: readonly PatternEvidence[];
  missingConditions?: readonly string[];
  contradictions?: readonly string[];
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

export const PATTERN_MODEL_VERSION = "mate-geometry-v1-postmove-attractor";
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

export const extractPatternFeatures = (position: PositionSnapshot, facts: PositionFacts, analysis?: PatternAnalysisContext): PatternFeatures => {
  const board = boardFromFen(String(position.fen));
  const attackingSide = analysis?.attackerSide ?? legacyPatternAnalysisContext(facts).attackerSide;
  const targetKing = findKing(board, analysis?.defenderSide ?? opposite(attackingSide));
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
    ARABIAN: {
      score: 0.35 * edge + 0.3 * corner + 0.2 * knights + 0.15 * rooks,
      evidence: [evidence("KING_CENTRIC", "corner or edge king", Math.max(edge, corner)), evidence("ATTACK_GEOMETRY", "nearby knight", knights), evidence("ATTACK_GEOMETRY", "nearby rook or queen", rooks)]
    },
    BACK_RANK: {
      score: 0.4 * edge + 0.35 * blockers + 0.2 * rooks + 0.05 * checks,
      evidence: [evidence("KING_CENTRIC", "back-rank king", edge), evidence("KING_CENTRIC", "friendly blockers", blockers), evidence("ATTACK_GEOMETRY", "heavy-piece pressure", rooks)]
    },
    BALESTRA: {
      score: 0.3 * edge + 0.3 * rooks + 0.25 * knights + 0.15 * checks,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "heavy-piece line", rooks), evidence("ATTACK_GEOMETRY", "knight support", knights)]
    },
    BLIND_SWINE: {
      score: 0.35 * edge + 0.3 * knights + 0.2 * rooks + 0.15 * checks,
      evidence: [evidence("KING_CENTRIC", "restricted edge king", edge), evidence("ATTACK_GEOMETRY", "knight pressure", knights), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    BODEN: {
      score: 0.35 * bishops + 0.25 * checks + 0.2 * captures + 0.2 * (1 - edge),
      evidence: [evidence("ATTACK_GEOMETRY", "bishop pair potential", bishops), evidence("TACTICAL_SIGNAL", "check pressure", checks), evidence("TACTICAL_SIGNAL", "capture pressure", captures)]
    },
    CORNER: {
      score: 0.45 * corner + 0.3 * blockers + 0.15 * checks + 0.1 * rooks,
      evidence: [evidence("KING_CENTRIC", "corner king", corner), evidence("KING_CENTRIC", "friendly blockers", blockers), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    DOUBLE_BISHOP: {
      score: 0.5 * bishops + 0.25 * checks + 0.15 * corner + 0.1 * captures,
      evidence: [evidence("ATTACK_GEOMETRY", "bishop pair potential", bishops), evidence("TACTICAL_SIGNAL", "check pressure", checks), evidence("KING_CENTRIC", "corner king", corner)]
    },
    DOVETAIL: {
      score: 0.35 * blockers + 0.25 * corner + 0.2 * bishops + 0.2 * checks,
      evidence: [evidence("KING_CENTRIC", "restricted king mobility", blockers), evidence("KING_CENTRIC", "corner geometry", corner), evidence("ATTACK_GEOMETRY", "bishop pressure", bishops)]
    },
    EPAULETTE: {
      score: 0.45 * blockers + 0.25 * edge + 0.2 * rooks + 0.1 * checks,
      evidence: [evidence("KING_CENTRIC", "blocked king exits", blockers), evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "heavy-piece pressure", rooks)]
    },
    HOOK: {
      score: 0.3 * edge + 0.3 * knights + 0.25 * rooks + 0.15 * blockers,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "knight and heavy-piece geometry", Math.max(knights, rooks)), evidence("KING_CENTRIC", "restricted king mobility", blockers)]
    },
    KILL_BOX: {
      score: 0.35 * edge + 0.3 * blockers + 0.25 * rooks + 0.1 * checks,
      evidence: [evidence("KING_CENTRIC", "edge confinement", edge), evidence("KING_CENTRIC", "restricted escape squares", blockers), evidence("ATTACK_GEOMETRY", "heavy-piece pressure", rooks)]
    },
    MORPHYS: {
      score: 0.3 * edge + 0.3 * bishops + 0.25 * checks + 0.15 * captures,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "bishop pressure", bishops), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    OPERA: {
      score: 0.3 * edge + 0.3 * rooks + 0.2 * bishops + 0.2 * checks,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "heavy-piece pressure", rooks), evidence("ATTACK_GEOMETRY", "bishop support", bishops)]
    },
    PILLSBURY: {
      score: 0.3 * blockers + 0.3 * rooks + 0.25 * checks + 0.15 * knights,
      evidence: [evidence("KING_CENTRIC", "restricted king mobility", blockers), evidence("ATTACK_GEOMETRY", "heavy-piece pressure", rooks), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    SMOTHERED: {
      score: 0.35 * corner + 0.35 * blockers + 0.2 * knights + 0.1 * checks,
      evidence: [evidence("KING_CENTRIC", "corner king", corner), evidence("KING_CENTRIC", "friendly blockers", blockers), evidence("ATTACK_GEOMETRY", "nearby knight", knights)]
    },
    SWALLOWTAIL: {
      score: 0.35 * blockers + 0.25 * bishops + 0.2 * rooks + 0.2 * checks,
      evidence: [evidence("KING_CENTRIC", "restricted king mobility", blockers), evidence("ATTACK_GEOMETRY", "bishop support", bishops), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    TRIANGLE: {
      score: 0.35 * corner + 0.3 * blockers + 0.2 * knights + 0.15 * checks,
      evidence: [evidence("KING_CENTRIC", "corner geometry", corner), evidence("KING_CENTRIC", "friendly blockers", blockers), evidence("ATTACK_GEOMETRY", "knight support", knights)]
    },
    VUKOVIC: {
      score: 0.3 * edge + 0.3 * rooks + 0.25 * knights + 0.15 * checks,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "rook and knight geometry", Math.max(rooks, knights)), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    DAMIANO: {
      score: 0.35 * edge + 0.3 * rooks + 0.2 * checks + 0.15 * captures,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "heavy-piece pressure", rooks), evidence("TACTICAL_SIGNAL", "checking or capture pressure", Math.max(checks, captures))]
    },
    GRECO: {
      score: 0.3 * edge + 0.3 * rooks + 0.2 * bishops + 0.2 * checks,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "heavy-piece pressure", rooks), evidence("ATTACK_GEOMETRY", "bishop support", bishops)]
    },
    LOLLI: {
      score: 0.3 * edge + 0.3 * bishops + 0.25 * checks + 0.15 * captures,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "bishop pressure", bishops), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    LEGAL: {
      score: 0.3 * checks + 0.3 * captures + 0.25 * knights + 0.15 * bishops,
      evidence: [evidence("TACTICAL_SIGNAL", "check pressure", checks), evidence("TACTICAL_SIGNAL", "capture pressure", captures), evidence("ATTACK_GEOMETRY", "minor-piece support", Math.max(knights, bishops))]
    },
    BLACKBURNE: {
      score: 0.35 * bishops + 0.25 * edge + 0.2 * checks + 0.2 * rooks,
      evidence: [evidence("ATTACK_GEOMETRY", "bishop pressure", bishops), evidence("KING_CENTRIC", "edge king", edge), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    ANDERSSEN: {
      score: 0.3 * bishops + 0.3 * rooks + 0.25 * checks + 0.15 * captures,
      evidence: [evidence("ATTACK_GEOMETRY", "bishop and heavy-piece pressure", Math.max(bishops, rooks)), evidence("TACTICAL_SIGNAL", "check pressure", checks), evidence("TACTICAL_SIGNAL", "capture pressure", captures)]
    },
    MAYET: {
      score: 0.3 * edge + 0.3 * rooks + 0.2 * bishops + 0.2 * checks,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "line-piece pressure", Math.max(rooks, bishops)), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    RETI: {
      score: 0.3 * corner + 0.25 * knights + 0.25 * bishops + 0.2 * checks,
      evidence: [evidence("KING_CENTRIC", "corner geometry", corner), evidence("ATTACK_GEOMETRY", "minor-piece support", Math.max(knights, bishops)), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    MAX_LANGE: {
      score: 0.3 * edge + 0.3 * rooks + 0.2 * bishops + 0.2 * checks,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "line-piece pressure", Math.max(rooks, bishops)), evidence("TACTICAL_SIGNAL", "check pressure", checks)]
    },
    SUFFOCATION: {
      score: 0.4 * blockers + 0.25 * corner + 0.2 * knights + 0.15 * checks,
      evidence: [evidence("KING_CENTRIC", "restricted king mobility", blockers), evidence("KING_CENTRIC", "corner geometry", corner), evidence("ATTACK_GEOMETRY", "knight support", knights)]
    },
    LAWNMOWER: {
      score: 0.35 * edge + 0.3 * rooks + 0.2 * blockers + 0.15 * checks,
      evidence: [evidence("KING_CENTRIC", "edge confinement", edge), evidence("ATTACK_GEOMETRY", "heavy-piece pressure", rooks), evidence("KING_CENTRIC", "restricted escape squares", blockers)]
    },
    DAVID_GOLIATH: {
      score: 0.3 * edge + 0.3 * knights + 0.2 * rooks + 0.2 * captures,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "minor-piece pressure", knights), evidence("TACTICAL_SIGNAL", "capture pressure", captures)]
    },
    TWO_KNIGHTS: {
      score: 0.5 * knights + 0.25 * checks + 0.15 * edge + 0.1 * captures,
      evidence: [evidence("ATTACK_GEOMETRY", "knight pair potential", knights), evidence("TACTICAL_SIGNAL", "check pressure", checks), evidence("KING_CENTRIC", "edge king", edge)]
    },
    H_FILE: {
      score: 0.35 * edge + 0.3 * rooks + 0.2 * blockers + 0.15 * checks,
      evidence: [evidence("KING_CENTRIC", "edge king", edge), evidence("ATTACK_GEOMETRY", "open-file pressure", rooks), evidence("KING_CENTRIC", "restricted escape squares", blockers)]
    },
    DIAGONAL_CORRIDOR: {
      score: 0.35 * bishops + 0.3 * blockers + 0.2 * corner + 0.15 * checks,
      evidence: [evidence("ATTACK_GEOMETRY", "diagonal pressure", bishops), evidence("KING_CENTRIC", "restricted king mobility", blockers), evidence("KING_CENTRIC", "corner geometry", corner)]
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
  previousSimilarity = 0,
  analysis?: PatternAnalysisContext
): PatternAssessment => {
  const features = extractPatternFeatures(position, facts, analysis);
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
