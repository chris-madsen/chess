import type { PatternPieceType, PatternPositionContext, PatternSquare } from "./context";
import type { PatternFamilyId, PatternEvidence } from "./pattern";

export type RelativeSquare = Readonly<{ file: number; rank: number }>;
export type KingRegionDescriptor = "EDGE" | "CORNER" | "HOME_RANK" | "ANY";
export type MateRole = Readonly<{
  id: string;
  allowedPieceTypes: readonly PatternPieceType[];
  targetRelativeSquares: readonly RelativeSquare[];
  criticality: "critical" | "supporting";
}>;
export type MateGeometryVariant = Readonly<{
  kingRegion: KingRegionDescriptor;
  roles: readonly MateRole[];
  requiredCoverage?: readonly RelativeSquare[];
  preferredBlockers?: readonly RelativeSquare[];
  forbiddenGeometry?: readonly RelativeSquare[];
}>;
export type MateGeometryDescriptor = Readonly<{
  family: PatternFamilyId;
  label: string;
  variants: readonly MateGeometryVariant[];
}>;

export type MateGeometryScore = Readonly<{
  similarity: number;
  evidence: readonly PatternEvidence[];
  missingConditions: readonly string[];
  contradictions: readonly string[];
}>;

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const distance = (first: RelativeSquare, second: RelativeSquare): number => Math.abs(first.file - second.file) + Math.abs(first.rank - second.rank);
const proximity = (distanceValue: number): number => clamp(1 - distanceValue / 5);
const squareKey = (square: RelativeSquare): string => `${square.file},${square.rank}`;
const evidence = (label: string, score: number): PatternEvidence => ({ kind: "KING_CENTRIC", label, score: clamp(score) });

const relativeSquare = (context: PatternPositionContext, square: PatternSquare): RelativeSquare => ({
  file: square.file - context.targetKing.file,
  rank: context.analysis.defenderSide === "white" ? square.rank - context.targetKing.rank : context.targetKing.rank - square.rank
});

const regionAffinity = (context: PatternPositionContext, region: KingRegionDescriptor): number => {
  if (region === "ANY") return 1;
  if (region === "EDGE") return context.kingOnEdge ? 1 : 0.25;
  if (region === "CORNER") {
    const cornerDistance = Math.min(
      Math.abs(context.targetKing.file) + Math.abs(context.targetKing.rank),
      Math.abs(context.targetKing.file) + Math.abs(7 - context.targetKing.rank),
      Math.abs(7 - context.targetKing.file) + Math.abs(context.targetKing.rank),
      Math.abs(7 - context.targetKing.file) + Math.abs(7 - context.targetKing.rank)
    );
    return clamp(1 - cornerDistance / 6);
  }
  const homeRank = context.analysis.defenderSide === "white" ? 0 : 7;
  return clamp(1 - Math.abs(context.targetKing.rank - homeRank) / 7);
};

const roleAffinity = (context: PatternPositionContext, role: MateRole): number => {
  const candidates = context.relevantPieces
    .filter(piece => piece.side === context.analysis.attackerSide && role.allowedPieceTypes.includes(piece.type))
    .map(piece => Math.max(...role.targetRelativeSquares.map(target => proximity(distance(relativeSquare(context, piece.square), target)))));
  return candidates.length === 0 ? 0 : Math.max(...candidates);
};

const coverageAffinity = (context: PatternPositionContext, squares: readonly RelativeSquare[]): number => {
  if (squares.length === 0) return 1;
  const controlled = new Set(context.escapeSquares
    .filter(escape => escape.controlledByAttacker || escape.occupiedBy === context.analysis.defenderSide)
    .map(escape => squareKey(relativeSquare(context, escape.square))));
  return squares.filter(square => controlled.has(squareKey(square))).length / squares.length;
};

const blockerAffinity = (context: PatternPositionContext, squares: readonly RelativeSquare[]): number => {
  if (squares.length === 0) return 1;
  const occupied = new Set(context.escapeSquares
    .filter(escape => escape.occupiedBy === context.analysis.defenderSide)
    .map(escape => squareKey(relativeSquare(context, escape.square))));
  return squares.filter(square => occupied.has(squareKey(square))).length / squares.length;
};

const contradictionPenalty = (context: PatternPositionContext, squares: readonly RelativeSquare[]): number => {
  if (squares.length === 0) return 0;
  const occupiedOrControlled = new Set(context.escapeSquares
    .filter(escape => escape.controlledByAttacker || escape.occupiedBy === context.analysis.attackerSide)
    .map(escape => squareKey(relativeSquare(context, escape.square))));
  return squares.filter(square => occupiedOrControlled.has(squareKey(square))).length / squares.length;
};

export const MATE_GEOMETRY_DESCRIPTORS: readonly MateGeometryDescriptor[] = [
  { family: "ANASTASIA", label: "edge king, knight net and heavy-piece corridor", variants: [{ kingRegion: "EDGE", roles: [
    { id: "knight-net", allowedPieceTypes: ["n"], targetRelativeSquares: [{ file: -2, rank: 1 }, { file: -2, rank: -1 }, { file: 2, rank: 1 }, { file: 2, rank: -1 }], criticality: "critical" },
    { id: "heavy-corridor", allowedPieceTypes: ["r", "q"], targetRelativeSquares: [{ file: -1, rank: 0 }, { file: 1, rank: 0 }, { file: 0, rank: 2 }, { file: 0, rank: -2 }], criticality: "supporting" }
  ], requiredCoverage: [{ file: 0, rank: 1 }, { file: 0, rank: -1 }] }] },
  { family: "ARABIAN", label: "corner king, knight net and rook support", variants: [{ kingRegion: "CORNER", roles: [
    { id: "knight-net", allowedPieceTypes: ["n"], targetRelativeSquares: [{ file: 1, rank: 2 }, { file: 2, rank: 1 }, { file: -1, rank: 2 }, { file: -2, rank: 1 }], criticality: "critical" },
    { id: "rook-support", allowedPieceTypes: ["r", "q"], targetRelativeSquares: [{ file: 0, rank: 2 }, { file: 2, rank: 0 }, { file: -2, rank: 0 }], criticality: "supporting" }
  ], requiredCoverage: [{ file: 1, rank: 0 }, { file: 0, rank: 1 }] }] },
  { family: "BACK_RANK", label: "home-rank king and blocked flight squares", variants: [{ kingRegion: "HOME_RANK", roles: [
    { id: "back-rank-line", allowedPieceTypes: ["r", "q"], targetRelativeSquares: [{ file: -1, rank: 0 }, { file: 1, rank: 0 }, { file: 0, rank: 2 }], criticality: "critical" }
  ], requiredCoverage: [{ file: -1, rank: 0 }, { file: 1, rank: 0 }, { file: 0, rank: -1 }, { file: 0, rank: 1 }, { file: 0, rank: 2 }, { file: 0, rank: -2 }], preferredBlockers: [{ file: -1, rank: 1 }, { file: 1, rank: 1 }] }] },
  { family: "BODEN", label: "crossing bishop diagonals around the king", variants: [{ kingRegion: "ANY", roles: [
    { id: "light-diagonal", allowedPieceTypes: ["b"], targetRelativeSquares: [{ file: -2, rank: 2 }, { file: 2, rank: 2 }, { file: -2, rank: -2 }, { file: 2, rank: -2 }], criticality: "critical" },
    { id: "dark-diagonal", allowedPieceTypes: ["b"], targetRelativeSquares: [{ file: -2, rank: -2 }, { file: 2, rank: -2 }, { file: -2, rank: 2 }, { file: 2, rank: 2 }], criticality: "supporting" }
  ], requiredCoverage: [{ file: -1, rank: -1 }, { file: 1, rank: 1 }] }] },
  { family: "SMOTHERED", label: "knight check with occupied king neighborhood", variants: [{ kingRegion: "CORNER", roles: [
    { id: "knight-check", allowedPieceTypes: ["n"], targetRelativeSquares: [{ file: -1, rank: 2 }, { file: 1, rank: 2 }, { file: -2, rank: 1 }, { file: 2, rank: 1 }], criticality: "critical" }
  ], preferredBlockers: [{ file: -1, rank: 0 }, { file: 1, rank: 0 }, { file: 0, rank: 1 }, { file: 0, rank: -1 }] }] }
];

export const mateGeometryDescriptorFor = (family: PatternFamilyId): MateGeometryDescriptor | undefined => MATE_GEOMETRY_DESCRIPTORS.find(descriptor => descriptor.family === family);

export const scoreMateGeometry = (context: PatternPositionContext, descriptor: MateGeometryDescriptor): MateGeometryScore => {
  const variant = descriptor.variants[0];
  if (variant === undefined) return { similarity: 0, evidence: [], missingConditions: ["geometry descriptor"], contradictions: [] };
  const critical = variant.roles.filter(role => role.criticality === "critical");
  const supporting = variant.roles.filter(role => role.criticality === "supporting");
  const primary = critical.length === 0 ? 0 : Math.max(...critical.map(role => roleAffinity(context, role)));
  const support = supporting.length === 0 ? 1 : Math.max(...supporting.map(role => roleAffinity(context, role)));
  const kingRegion = regionAffinity(context, variant.kingRegion);
  const coverage = coverageAffinity(context, variant.requiredCoverage ?? []);
  const blockers = blockerAffinity(context, variant.preferredBlockers ?? []);
  const contradiction = contradictionPenalty(context, variant.forbiddenGeometry ?? []);
  const base = 0.20 * kingRegion + 0.25 * primary + 0.20 * support + 0.20 * coverage + 0.10 * blockers + 0.05 * 1;
  const similarity = clamp(base * (0.20 + 0.80 * Math.min(primary, coverage)) * (1 - contradiction));
  return {
    similarity,
    evidence: [evidence("king region", kingRegion), evidence("critical role proximity", primary), evidence("support role proximity", support), evidence("required escape coverage", coverage), evidence("preferred blockers", blockers)],
    missingConditions: [
      ...(kingRegion < 0.8 ? [`bring king into ${variant.kingRegion.toLowerCase()} geometry`] : []),
      ...(primary < 0.8 ? ["complete the critical mating role"] : []),
      ...(coverage < 0.8 ? ["cover the required escape squares"] : [])
    ],
    contradictions: contradiction > 0 ? ["forbidden escape geometry is present"] : []
  };
};
