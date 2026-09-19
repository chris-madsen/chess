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
const squareKey = (square: RelativeSquare): string => `${square.file},${square.rank}`;
const evidence = (label: string, score: number): PatternEvidence => ({ kind: "KING_CENTRIC", label, score: clamp(score) });

const relativeSquare = (context: PatternPositionContext, square: PatternSquare): RelativeSquare => ({
  file: (square.file - context.targetKing.file) * (context.targetKing.file > 3 ? -1 : 1),
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

const pieceReachability = (type: PatternPieceType, from: RelativeSquare, target: RelativeSquare): number => {
  const file = Math.abs(from.file - target.file);
  const rank = Math.abs(from.rank - target.rank);
  const manhattan = file + rank;
  if (file === 0 && rank === 0) return 1;
  if (type === "n") return file * rank === 2 ? 1 : clamp(1 / (1 + manhattan));
  if (type === "b") return file === rank && file > 0 ? 1 / (1 + file) : clamp(0.2 / (1 + manhattan));
  if (type === "r") return (file === 0 || rank === 0) && manhattan > 0 ? 1 / (1 + manhattan) : clamp(0.2 / (1 + manhattan));
  if (type === "q") {
    const line = (file === 0 || rank === 0 || file === rank) && manhattan > 0;
    return line ? 1 / (1 + Math.max(file, rank)) : clamp(0.2 / (1 + manhattan));
  }
  if (type === "p") return rank <= 2 && file <= 1 ? clamp(1 - manhattan / 5) : 0;
  return clamp(1 - manhattan / 5);
};

const roleValue = (context: PatternPositionContext, role: MateRole, pieceIndex: number): number => {
  const piece = context.relevantPieces[pieceIndex];
  if (piece === undefined || piece.side !== context.analysis.attackerSide || !role.allowedPieceTypes.includes(piece.type)) return 0;
  const from = relativeSquare(context, piece.square);
  return Math.max(...role.targetRelativeSquares.map(target => pieceReachability(piece.type, from, target)), 0);
};

const roleAssignment = (context: PatternPositionContext, roles: readonly MateRole[]): readonly number[] => {
  const eligible = context.relevantPieces.map((piece, index) => ({ piece, index })).filter(item => item.piece.side === context.analysis.attackerSide);
  const quality = (values: readonly number[]): readonly [number, number, number] => {
    const critical = values.filter((_, index) => roles[index]?.criticality === "critical");
    const supporting = values.filter((_, index) => roles[index]?.criticality === "supporting");
    return [critical.length === 0 ? 0 : Math.min(...critical), supporting.length === 0 ? 1 : Math.min(...supporting), values.reduce((sum, value) => sum + value, 0)];
  };
  const better = (left: readonly number[], right: readonly number[]): boolean => {
    const a = quality(left);
    const b = quality(right);
    return a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
  };
  const search = (roleIndex: number, used: ReadonlySet<number>, values: readonly number[]): readonly number[] => {
    if (roleIndex >= roles.length) return values;
    const role = roles[roleIndex]!;
    const skipped = search(roleIndex + 1, used, [...values, 0]);
    let best = skipped;
    for (const item of eligible) {
      if (used.has(item.index) || !role.allowedPieceTypes.includes(item.piece.type)) continue;
      const next = search(roleIndex + 1, new Set([...used, item.index]), [...values, roleValue(context, role, item.index)]);
      if (better(next, best)) best = next;
    }
    return best;
  };
  return search(0, new Set(), []);
};

const coverageAffinity = (context: PatternPositionContext, squares: readonly RelativeSquare[]): number => {
  if (squares.length === 0) return 1;
  const observed = new Set(context.observedSquares.map(square => squareKey(relativeSquare(context, square.square))));
  const controlled = new Set(context.observedSquares
    .filter(escape => escape.controlledByAttacker || escape.occupiedBy === context.analysis.defenderSide)
    .map(escape => squareKey(relativeSquare(context, escape.square))));
  const applicable = squares.filter(square => observed.has(squareKey(square)));
  return applicable.length === 0 ? 1 : applicable.filter(square => controlled.has(squareKey(square))).length / applicable.length;
};

const blockerAffinity = (context: PatternPositionContext, squares: readonly RelativeSquare[]): number => {
  if (squares.length === 0) return 1;
  const observed = new Set(context.observedSquares.map(square => squareKey(relativeSquare(context, square.square))));
  const occupied = new Set(context.observedSquares
    .filter(escape => escape.occupiedBy === context.analysis.defenderSide)
    .map(escape => squareKey(relativeSquare(context, escape.square))));
  const applicable = squares.filter(square => observed.has(squareKey(square)));
  return applicable.length === 0 ? 1 : applicable.filter(square => occupied.has(squareKey(square))).length / applicable.length;
};

const contradictionPenalty = (context: PatternPositionContext, squares: readonly RelativeSquare[]): number => {
  if (squares.length === 0) return 0;
  const observed = new Set(context.observedSquares.map(square => squareKey(relativeSquare(context, square.square))));
  const occupiedOrControlled = new Set(context.observedSquares
    .filter(escape => escape.controlledByAttacker || escape.occupiedBy === context.analysis.attackerSide)
    .map(escape => squareKey(relativeSquare(context, escape.square))));
  const applicable = squares.filter(square => observed.has(squareKey(square)));
  return applicable.length === 0 ? 0 : applicable.filter(square => occupiedOrControlled.has(squareKey(square))).length / applicable.length;
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

const descriptor = (
  family: PatternFamilyId,
  label: string,
  kingRegion: KingRegionDescriptor,
  roles: readonly MateRole[],
  requiredCoverage: readonly RelativeSquare[] = [],
  preferredBlockers: readonly RelativeSquare[] = []
): MateGeometryDescriptor => ({ family, label, variants: [{ kingRegion, roles, requiredCoverage, preferredBlockers }] });

const role = (id: string, allowedPieceTypes: readonly PatternPieceType[], targetRelativeSquares: readonly RelativeSquare[], criticality: MateRole["criticality"] = "supporting"): MateRole => ({ id, allowedPieceTypes, targetRelativeSquares, criticality });
const sideSquares = [{ file: -1, rank: 0 }, { file: 1, rank: 0 }, { file: 0, rank: -1 }, { file: 0, rank: 1 }] as const;

export const EXTENDED_MATE_GEOMETRY_DESCRIPTORS: readonly MateGeometryDescriptor[] = [
  descriptor("BALESTRA", "bishop and queen diagonal battery", "ANY", [role("bishop-battery", ["b"], [{ file: -2, rank: 2 }, { file: 2, rank: 2 }, { file: -2, rank: -2 }, { file: 2, rank: -2 }], "critical"), role("queen-line", ["q", "r"], sideSquares)]),
  descriptor("BLIND_SWINE", "two rooks on the back ranks", "HOME_RANK", [role("first-rook", ["r"], [{ file: 0, rank: 1 }, { file: -1, rank: 0 }, { file: 1, rank: 0 }], "critical"), role("second-rook", ["r"], [{ file: 0, rank: 2 }, { file: -2, rank: 0 }, { file: 2, rank: 0 }])], sideSquares),
  descriptor("CORNER", "corner confinement with heavy support", "CORNER", [role("corner-heavy", ["r", "q"], sideSquares, "critical"), role("corner-minor", ["n", "b"], [{ file: 1, rank: 2 }, { file: 2, rank: 1 }])], [{ file: 1, rank: 0 }, { file: 0, rank: 1 }]),
  descriptor("DOUBLE_BISHOP", "crossing double-bishop diagonals", "ANY", [role("first-bishop", ["b"], [{ file: -2, rank: 2 }, { file: 2, rank: -2 }], "critical"), role("second-bishop", ["b"], [{ file: 2, rank: 2 }, { file: -2, rank: -2 }], "critical")], [{ file: -1, rank: -1 }, { file: 1, rank: 1 }]),
  descriptor("DOVETAIL", "queen dovetail confinement", "CORNER", [role("queen-dovetail", ["q"], [{ file: -1, rank: -1 }, { file: 1, rank: -1 }, { file: 0, rank: -2 }], "critical"), role("support-line", ["r", "b"], sideSquares)], sideSquares),
  descriptor("EPAULETTE", "heavy piece between blocked lateral exits", "EDGE", [role("central-heavy", ["q", "r"], [{ file: 0, rank: 2 }, { file: 0, rank: -2 }], "critical")], [{ file: -1, rank: 0 }, { file: 1, rank: 0 }], [{ file: -1, rank: 1 }, { file: 1, rank: 1 }]),
  descriptor("HOOK", "rook and knight hook", "EDGE", [role("hook-rook", ["r"], [{ file: -1, rank: 0 }, { file: 1, rank: 0 }], "critical"), role("hook-knight", ["n"], [{ file: -2, rank: 1 }, { file: 2, rank: 1 }])], sideSquares),
  descriptor("KILL_BOX", "multi-piece king kill box", "EDGE", [role("box-heavy", ["q", "r"], sideSquares, "critical"), role("box-minor", ["n", "b"], [{ file: -2, rank: 1 }, { file: 2, rank: 1 }])], sideSquares),
  descriptor("PILLSBURY", "queen and bishop diagonal battery", "ANY", [role("pillsbury-bishop", ["b"], [{ file: -2, rank: 2 }, { file: 2, rank: -2 }], "critical"), role("pillsbury-queen", ["q"], [{ file: -1, rank: 0 }, { file: 1, rank: 0 }])], [{ file: -1, rank: -1 }, { file: 1, rank: 1 }]),
  descriptor("MORPHYS", "rook corridor with restricted king", "EDGE", [role("morphys-rook", ["r", "q"], [{ file: -1, rank: 0 }, { file: 1, rank: 0 }], "critical"), role("morphys-minor", ["b", "n"], [{ file: -2, rank: 1 }, { file: 2, rank: 1 }])], sideSquares),
  descriptor("OPERA", "rook and minor-piece corridor", "EDGE", [role("opera-rook", ["r"], [{ file: 0, rank: 2 }, { file: 0, rank: -2 }], "critical"), role("opera-minor", ["b", "n"], [{ file: -2, rank: 2 }, { file: 2, rank: 2 }])], sideSquares),
  descriptor("SWALLOWTAIL", "bishop and knight escape net", "ANY", [role("swallow-bishop", ["b"], [{ file: -2, rank: 2 }, { file: 2, rank: -2 }], "critical"), role("swallow-knight", ["n"], [{ file: -2, rank: 1 }, { file: 2, rank: 1 }])], sideSquares),
  descriptor("TRIANGLE", "three-sided diagonal and line confinement", "EDGE", [role("triangle-heavy", ["q", "r"], sideSquares, "critical"), role("triangle-minor", ["b", "n"], [{ file: -2, rank: 1 }, { file: 2, rank: 1 }])], sideSquares),
  descriptor("VUKOVIC", "rook and knight mating net", "EDGE", [role("vukovic-rook", ["r"], [{ file: -1, rank: 0 }, { file: 1, rank: 0 }], "critical"), role("vukovic-knight", ["n"], [{ file: -2, rank: 1 }, { file: 2, rank: 1 }])], sideSquares),
  descriptor("DAMIANO", "queen-supported corner attack", "CORNER", [role("damiano-queen", ["q"], [{ file: -1, rank: 0 }, { file: 1, rank: 0 }], "critical"), role("damiano-pawn", ["p", "b"], [{ file: 0, rank: 1 }, { file: 1, rank: 1 }])], sideSquares),
  descriptor("GRECO", "bishop and queen corner battery", "CORNER", [role("greco-bishop", ["b"], [{ file: -2, rank: 2 }, { file: 2, rank: 2 }], "critical"), role("greco-queen", ["q"], sideSquares)], sideSquares),
  descriptor("LOLLI", "queen and pawn shelter attack", "CORNER", [role("lolli-queen", ["q"], [{ file: 0, rank: 2 }, { file: -1, rank: 0 }, { file: 1, rank: 0 }], "critical"), role("lolli-pawn", ["p", "b"], [{ file: -1, rank: 1 }, { file: 1, rank: 1 }])], sideSquares),
  descriptor("LEGAL", "knight fork and discovered battery", "ANY", [role("legal-knight", ["n"], [{ file: -1, rank: 2 }, { file: 1, rank: 2 }], "critical"), role("legal-bishop", ["b", "q"], [{ file: -2, rank: 2 }, { file: 2, rank: 2 }])], sideSquares),
  descriptor("BLACKBURNE", "bishop and knight corner net", "CORNER", [role("blackburne-bishop", ["b"], [{ file: -2, rank: 2 }, { file: 2, rank: 2 }], "critical"), role("blackburne-knight", ["n"], [{ file: -1, rank: 2 }, { file: 1, rank: 2 }])], sideSquares),
  descriptor("ANDERSSEN", "queen diagonal and bishop corridor", "EDGE", [role("anderssen-queen", ["q"], [{ file: 0, rank: 2 }, { file: 0, rank: -2 }], "critical"), role("anderssen-bishop", ["b"], [{ file: -2, rank: 2 }, { file: 2, rank: -2 }])], sideSquares),
  descriptor("MAYET", "queen and knight edge net", "EDGE", [role("mayet-queen", ["q", "r"], sideSquares, "critical"), role("mayet-knight", ["n"], [{ file: -2, rank: 1 }, { file: 2, rank: 1 }])], sideSquares),
  descriptor("RETI", "knight and bishop diagonal corridor", "ANY", [role("reti-knight", ["n"], [{ file: -1, rank: 2 }, { file: 1, rank: 2 }], "critical"), role("reti-bishop", ["b"], [{ file: -2, rank: 2 }, { file: 2, rank: -2 }])], sideSquares),
  descriptor("MAX_LANGE", "queen and bishop long diagonal", "EDGE", [role("max-lange-queen", ["q"], [{ file: 0, rank: 2 }, { file: 0, rank: -2 }], "critical"), role("max-lange-bishop", ["b"], [{ file: -2, rank: 2 }, { file: 2, rank: -2 }])], sideSquares),
  descriptor("SUFFOCATION", "knight with a suffocated king", "CORNER", [role("suffocation-knight", ["n"], [{ file: -1, rank: 2 }, { file: 1, rank: 2 }, { file: -2, rank: 1 }, { file: 2, rank: 1 }], "critical")], sideSquares),
  descriptor("LAWNMOWER", "two-rook rank compression", "EDGE", [role("lawnmower-rook", ["r"], [{ file: 0, rank: 1 }, { file: 0, rank: 2 }], "critical"), role("lawnmower-support", ["r", "q"], sideSquares)], sideSquares),
  descriptor("DAVID_GOLIATH", "queen against a boxed king", "CORNER", [role("david-queen", ["q"], sideSquares, "critical"), role("david-support", ["b", "n", "r"], [{ file: -2, rank: 1 }, { file: 2, rank: 1 }])], sideSquares),
  descriptor("TWO_KNIGHTS", "two-knight mating net", "CORNER", [role("first-knight", ["n"], [{ file: -1, rank: 2 }, { file: 1, rank: 2 }], "critical"), role("second-knight", ["n"], [{ file: -2, rank: 1 }, { file: 2, rank: 1 }], "critical")], sideSquares),
  descriptor("H_FILE", "h-file heavy-piece corridor", "EDGE", [role("h-file-heavy", ["r", "q"], [{ file: 0, rank: 2 }, { file: 0, rank: -2 }], "critical"), role("h-file-support", ["b", "n"], sideSquares)], sideSquares),
  descriptor("DIAGONAL_CORRIDOR", "diagonal corridor to a restricted king", "EDGE", [role("diagonal-primary", ["b", "q"], [{ file: -2, rank: 2 }, { file: 2, rank: -2 }], "critical"), role("diagonal-support", ["r", "n"], sideSquares)], sideSquares)
];

export const ALL_MATE_GEOMETRY_DESCRIPTORS: readonly MateGeometryDescriptor[] = [...MATE_GEOMETRY_DESCRIPTORS, ...EXTENDED_MATE_GEOMETRY_DESCRIPTORS];

export const mateGeometryDescriptorFor = (family: PatternFamilyId): MateGeometryDescriptor | undefined => ALL_MATE_GEOMETRY_DESCRIPTORS.find(item => item.family === family);

export const scoreMateGeometry = (context: PatternPositionContext, descriptor: MateGeometryDescriptor): MateGeometryScore => {
  const scored = descriptor.variants.map(variant => {
    const assignment = roleAssignment(context, variant.roles);
    const critical = variant.roles.map((role, index) => role.criticality === "critical" ? assignment[index] ?? 0 : undefined).filter((value): value is number => value !== undefined);
    const supporting = variant.roles.map((role, index) => role.criticality === "supporting" ? assignment[index] ?? 0 : undefined).filter((value): value is number => value !== undefined);
    const primary = critical.length === 0 ? 0 : Math.min(...critical);
    const support = supporting.length === 0 ? 1 : Math.min(...supporting);
    const kingRegion = regionAffinity(context, variant.kingRegion);
    const coverage = coverageAffinity(context, variant.requiredCoverage ?? []);
    const blockers = blockerAffinity(context, variant.preferredBlockers ?? []);
    const contradiction = contradictionPenalty(context, variant.forbiddenGeometry ?? []);
    const base = 0.20 * kingRegion + 0.25 * primary + 0.20 * support + 0.20 * coverage + 0.10 * blockers + 0.05;
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
  });
  return scored.sort((first, second) => second.similarity - first.similarity)[0] ?? { similarity: 0, evidence: [], missingConditions: ["geometry descriptor"], contradictions: [] };
};
