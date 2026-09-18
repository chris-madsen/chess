import type { PatternFamilyId, PatternAssessment, PatternEvidence, PatternState } from "./pattern";
import { PATTERN_FAMILY_IDS, PATTERN_MODEL_VERSION, STEERABLE_PATTERN_FAMILY_IDS } from "./pattern";
import { controlledEscapeCount, piecesOf, relationExists, type PatternPositionContext } from "./context";
import { mateGeometryDescriptorFor, scoreMateGeometry } from "./mate-geometry";

export type PatternMatcherResult = Readonly<{
  similarity: number;
  evidence: readonly PatternEvidence[];
  missingConditions: readonly string[];
  contradictions: readonly string[];
}>;

export type PatternMatcher = Readonly<{
  family: PatternFamilyId;
  retrievalHint: (context: PatternPositionContext) => boolean;
  score: (context: PatternPositionContext) => PatternMatcherResult;
  classifyState: (result: PatternMatcherResult) => PatternState;
}>;

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const evidence = (label: string, score: number): PatternEvidence => ({ kind: "ATTACK_GEOMETRY", label, score: clamp(score) });
const stateFor = (result: PatternMatcherResult): PatternState => result.similarity >= 0.82 ? "mate_basin" : result.similarity >= 0.65 ? "near" : result.similarity >= 0.45 ? "forming" : result.similarity >= 0.25 ? "promising" : "far";
const score = (conditions: readonly (boolean | number)[], evidenceItems: readonly PatternEvidence[], missingConditions: readonly string[], contradictions: readonly string[] = []): PatternMatcherResult => ({
  similarity: clamp(conditions.map(condition => typeof condition === "boolean" ? (condition ? 1 : 0) : clamp(condition)).reduce((sum, value) => sum + value, 0) / Math.max(1, conditions.length)),
  evidence: evidenceItems,
  missingConditions,
  contradictions
});
const distanceToEdge = (context: PatternPositionContext): number => Math.min(context.targetKing.file, 7 - context.targetKing.file, context.targetKing.rank, 7 - context.targetKing.rank);
const edgeAffinity = (context: PatternPositionContext): number => clamp(1 - distanceToEdge(context) / 3);
const cornerAffinity = (context: PatternPositionContext): number => clamp(1 - Math.min(
  Math.abs(context.targetKing.file - 0) + Math.abs(context.targetKing.rank - 0),
  Math.abs(context.targetKing.file - 0) + Math.abs(context.targetKing.rank - 7),
  Math.abs(context.targetKing.file - 7) + Math.abs(context.targetKing.rank - 0),
  Math.abs(context.targetKing.file - 7) + Math.abs(context.targetKing.rank - 7)
) / 6);
const homeRankAffinity = (context: PatternPositionContext): number => clamp(1 - Math.abs(context.targetKing.rank - (context.analysis.defenderSide === "white" ? 0 : 7)) / 7);

const firstWave: readonly PatternMatcher[] = [
  ...(["ANASTASIA", "ARABIAN", "BACK_RANK", "BODEN", "SMOTHERED"] as const).map(family => ({
    family,
    retrievalHint: (context: PatternPositionContext): boolean => {
      const descriptor = mateGeometryDescriptorFor(family);
      return descriptor !== undefined && descriptor.variants.some(variant => variant.roles.some(role => piecesOf(context, context.analysis.attackerSide).some(piece => role.allowedPieceTypes.includes(piece.type))));
    },
    score: (context: PatternPositionContext): PatternMatcherResult => {
      const descriptor = mateGeometryDescriptorFor(family);
      return descriptor === undefined ? score([], [], ["geometry descriptor"]) : scoreMateGeometry(context, descriptor);
    },
    classifyState: stateFor
  }))
];

type CorePolicy = Readonly<{
  label: string;
  conditions: (context: PatternPositionContext) => readonly boolean[];
  retrievalHint: (context: PatternPositionContext) => boolean;
}>;

const attackers = (context: PatternPositionContext) => piecesOf(context, context.analysis.attackerSide);
const defenders = (context: PatternPositionContext) => piecesOf(context, context.analysis.defenderSide);
const has = (context: PatternPositionContext, type: "n" | "b" | "r" | "q"): boolean => piecesOf(context, context.analysis.attackerSide, type).length > 0;
const hasAtLeast = (context: PatternPositionContext, type: "n" | "b" | "r" | "q", count: number): boolean => piecesOf(context, context.analysis.attackerSide, type).length >= count;
const edgeOrCorner = (context: PatternPositionContext): boolean => context.kingOnEdge || context.kingInCorner;

const corePolicies: Readonly<Partial<Record<PatternFamilyId, CorePolicy>>> = {
  BALESTRA: { label: "bishop and heavy-piece coordination", retrievalHint: context => has(context, "b") && has(context, "q"), conditions: context => [has(context, "b"), has(context, "q"), relationExists(context, "ATTACKS"), controlledEscapeCount(context) >= 2] },
  BLIND_SWINE: { label: "two-rook seventh/eighth-rank pressure", retrievalHint: context => hasAtLeast(context, "r", 2), conditions: context => [hasAtLeast(context, "r", 2), context.kingOnHomeRank, relationExists(context, "ATTACKS", relation => relation.pieceType === "r"), controlledEscapeCount(context) >= 2] },
  CORNER: { label: "corner confinement", retrievalHint: context => context.kingInCorner, conditions: context => [context.kingInCorner, has(context, "r") || has(context, "q"), controlledEscapeCount(context) >= 2, relationExists(context, "ATTACKS")] },
  DOUBLE_BISHOP: { label: "double-bishop crossing control", retrievalHint: context => hasAtLeast(context, "b", 2), conditions: context => [hasAtLeast(context, "b", 2), relationExists(context, "ATTACKS", relation => relation.pieceType === "b"), controlledEscapeCount(context) >= 2, piecesOf(context, context.analysis.attackerSide, "b").some(first => piecesOf(context, context.analysis.attackerSide, "b").some(second => first.square.file !== second.square.file && first.square.rank !== second.square.rank))] },
  DOVETAIL: { label: "queen-supported restricted king zone", retrievalHint: context => has(context, "q"), conditions: context => [has(context, "q"), defenders(context).length >= 2, controlledEscapeCount(context) >= 3, relationExists(context, "ATTACKS")] },
  EPAULETTE: { label: "defender pieces block both lateral exits", retrievalHint: context => context.kingOnEdge, conditions: context => [context.kingOnEdge, context.escapeSquares.filter(square => square.occupiedBy === context.analysis.defenderSide).length >= 2, has(context, "q") || has(context, "r"), controlledEscapeCount(context) >= 2] },
  HOOK: { label: "rook and knight hook geometry", retrievalHint: context => has(context, "r") && has(context, "n"), conditions: context => [has(context, "r"), has(context, "n"), relationExists(context, "CONTROLS_ESCAPE", relation => relation.pieceType === "n"), relationExists(context, "ATTACKS", relation => relation.pieceType === "r")] },
  KILL_BOX: { label: "multi-piece king kill box", retrievalHint: context => controlledEscapeCount(context) >= 2, conditions: context => [controlledEscapeCount(context) >= 4, attackers(context).length >= 3, relationExists(context, "ATTACKS"), edgeOrCorner(context)] },
  PILLSBURY: { label: "queen and bishop diagonal battery", retrievalHint: context => has(context, "q") && has(context, "b"), conditions: context => [has(context, "q"), has(context, "b"), relationExists(context, "ATTACKS", relation => relation.pieceType === "b"), controlledEscapeCount(context) >= 2] },
  MORPHYS: { label: "rook/queen corridor with restricted king", retrievalHint: context => edgeOrCorner(context) && (has(context, "r") || has(context, "q")), conditions: context => [edgeOrCorner(context), has(context, "r") || has(context, "q"), relationExists(context, "ATTACKS"), controlledEscapeCount(context) >= 3] },
  OPERA: { label: "long-range rook and minor-piece corridor", retrievalHint: context => has(context, "r") && (has(context, "b") || has(context, "n")), conditions: context => [has(context, "r"), has(context, "b") || has(context, "n"), relationExists(context, "ATTACKS", relation => relation.pieceType === "r"), controlledEscapeCount(context) >= 2] },
  SWALLOWTAIL: { label: "bishop and knight escape net", retrievalHint: context => has(context, "b") && has(context, "n"), conditions: context => [has(context, "b"), has(context, "n"), relationExists(context, "CONTROLS_ESCAPE", relation => relation.pieceType === "n"), controlledEscapeCount(context) >= 3] },
  TRIANGLE: { label: "three-sided diagonal/line confinement", retrievalHint: context => attackers(context).length >= 3, conditions: context => [attackers(context).length >= 3, relationExists(context, "ATTACKS"), controlledEscapeCount(context) >= 3, edgeOrCorner(context)] },
  VUKOVIC: { label: "knight and rook mating net", retrievalHint: context => has(context, "n") && has(context, "r"), conditions: context => [has(context, "n"), has(context, "r"), relationExists(context, "CONTROLS_ESCAPE", relation => relation.pieceType === "n"), relationExists(context, "ATTACKS", relation => relation.pieceType === "r")] }
};

const coreMatcher = (family: PatternFamilyId, policy: CorePolicy): PatternMatcher => ({
  family,
  retrievalHint: policy.retrievalHint,
  score: context => {
    const conditions = policy.conditions(context);
    const booleanScore = conditions.filter(Boolean).length / Math.max(1, conditions.length);
    const geometryScore = clamp((controlledEscapeCount(context) / Math.max(1, context.escapeSquares.length) + Math.max(edgeAffinity(context), cornerAffinity(context), homeRankAffinity(context))) / 2);
    const similarity = clamp(booleanScore * 0.7 + geometryScore * 0.3);
    return {
      similarity,
      evidence: [evidence(policy.label, similarity), evidence("attacker controls target king zone", relationExists(context, "ATTACKS") ? 1 : 0), evidence("escape-square restriction", clamp(controlledEscapeCount(context) / 4))],
      missingConditions: conditions.every(Boolean) ? [] : [`complete ${policy.label}`],
      contradictions: context.kingInCorner && !context.kingOnEdge ? ["king geometry is inconsistent"] : []
    };
  },
  classifyState: stateFor
});

const fallbackMatcher = (family: PatternFamilyId): PatternMatcher => ({
  family,
  retrievalHint: () => true,
  score: _context => ({
    similarity: 0,
    evidence: [evidence("family matcher not yet specialized", 0)],
    missingConditions: [`specialized ${family} matcher is not implemented`],
    contradictions: []
  }),
  classifyState: (_context: PatternMatcherResult) => "far"
});

const matcherMap: Readonly<Record<PatternFamilyId, PatternMatcher>> = Object.fromEntries(PATTERN_FAMILY_IDS.map(family => [family, firstWave.find(matcher => matcher.family === family) ?? (corePolicies[family] === undefined ? fallbackMatcher(family) : coreMatcher(family, corePolicies[family]))])) as Record<PatternFamilyId, PatternMatcher>;

export const patternMatcherFor = (family: PatternFamilyId): PatternMatcher => matcherMap[family];

export const assessPatternContext = (context: PatternPositionContext, family: PatternFamilyId, previousSimilarity = 0): PatternAssessment & Readonly<{ missingConditions: readonly string[]; contradictions: readonly string[] }> => {
  const matcher = patternMatcherFor(family);
  const result = matcher.score(context);
  return {
    tag: "PatternAssessment",
    family,
    similarity: result.similarity,
    affinity: result.similarity,
    progress: result.similarity - previousSimilarity,
    state: matcher.classifyState(result),
    evidence: result.evidence,
    missingConditions: result.missingConditions,
    contradictions: result.contradictions,
    modelVersion: `${PATTERN_MODEL_VERSION}-relational-v1`
  };
};

export const retrieveSteerablePatternFamilies = (context: PatternPositionContext, limit = 8): readonly PatternAssessment[] => PATTERN_FAMILY_IDS
  .filter(family => STEERABLE_PATTERN_FAMILY_IDS.includes(family))
  .map(family => assessPatternContext(context, family))
  .sort((first, second) => second.similarity - first.similarity || first.family.localeCompare(second.family))
  .slice(0, Math.max(1, limit));

export const retrievePatternFamilies = (context: PatternPositionContext, limit = 8): readonly PatternAssessment[] => PATTERN_FAMILY_IDS
  .map(family => assessPatternContext(context, family))
  .sort((first, second) => second.similarity - first.similarity || first.family.localeCompare(second.family))
  .slice(0, Math.max(1, limit));
