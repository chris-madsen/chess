import type { PatternFamilyId, PatternAssessment, PatternEvidence, PatternState } from "./pattern";
import { PATTERN_FAMILY_IDS, PATTERN_MODEL_VERSION } from "./pattern";
import { controlledEscapeCount, piecesOf, relationExists, type PatternPositionContext } from "./context";

export type PatternMatcherResult = Readonly<{
  similarity: number;
  evidence: readonly PatternEvidence[];
  missingConditions: readonly string[];
  contradictions: readonly string[];
}>;

export type PatternMatcher = Readonly<{
  family: PatternFamilyId;
  prefilter: (context: PatternPositionContext) => boolean;
  score: (context: PatternPositionContext) => PatternMatcherResult;
  classifyState: (result: PatternMatcherResult) => PatternState;
}>;

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const evidence = (label: string, score: number): PatternEvidence => ({ kind: "ATTACK_GEOMETRY", label, score: clamp(score) });
const stateFor = (result: PatternMatcherResult): PatternState => result.similarity >= 0.82 ? "mate_basin" : result.similarity >= 0.65 ? "near" : result.similarity >= 0.45 ? "forming" : result.similarity >= 0.25 ? "promising" : "far";
const hasHeavyLine = (context: PatternPositionContext): boolean => relationExists(context, "ATTACKS", relation => relation.pieceType === "r" || relation.pieceType === "q");
const hasKnightEscapeControl = (context: PatternPositionContext): boolean => relationExists(context, "CONTROLS_ESCAPE", relation => relation.pieceType === "n");
const kingBlocked = (context: PatternPositionContext): number => context.escapeSquares.filter(escape => escape.occupiedBy === context.analysis.defenderSide || escape.controlledByAttacker).length;
const score = (conditions: readonly boolean[], evidenceItems: readonly PatternEvidence[], missingConditions: readonly string[], contradictions: readonly string[] = []): PatternMatcherResult => ({
  similarity: clamp(conditions.filter(Boolean).length / Math.max(1, conditions.length)),
  evidence: evidenceItems,
  missingConditions,
  contradictions
});

const firstWave: readonly PatternMatcher[] = [
  {
    family: "ANASTASIA",
    prefilter: context => context.kingOnEdge && piecesOf(context, context.analysis.attackerSide, "n").length > 0 && piecesOf(context, context.analysis.attackerSide, "r").length + piecesOf(context, context.analysis.attackerSide, "q").length > 0,
    score: context => score([
      context.kingOnEdge,
      hasKnightEscapeControl(context),
      hasHeavyLine(context),
      kingBlocked(context) >= 2
    ], [
      evidence("defender king on edge", context.kingOnEdge ? 1 : 0),
      evidence("knight controls an escape square", hasKnightEscapeControl(context) ? 1 : 0),
      evidence("rook or queen attacks king zone", hasHeavyLine(context) ? 1 : 0),
      evidence("escape geometry is restricted", clamp(kingBlocked(context) / 3))
    ], [
      ...(context.kingOnEdge ? [] : ["confine defender king to edge"]),
      ...(hasKnightEscapeControl(context) ? [] : ["control a critical escape square with a knight"]),
      ...(hasHeavyLine(context) ? [] : ["open a rook or queen line"])
    ]),
    classifyState: stateFor
  },
  {
    family: "ARABIAN",
    prefilter: context => context.kingInCorner && piecesOf(context, context.analysis.attackerSide, "n").length > 0,
    score: context => score([
      context.kingInCorner,
      hasKnightEscapeControl(context),
      hasHeavyLine(context),
      kingBlocked(context) >= 2
    ], [
      evidence("defender king in corner", context.kingInCorner ? 1 : 0),
      evidence("knight controls corner escape geometry", hasKnightEscapeControl(context) ? 1 : 0),
      evidence("rook or queen supports the mate zone", hasHeavyLine(context) ? 1 : 0),
      evidence("corner exits are restricted", clamp(kingBlocked(context) / 3))
    ], [
      ...(context.kingInCorner ? [] : ["force defender king into a corner"]),
      ...(hasKnightEscapeControl(context) ? [] : ["control the knight-covered escape squares"]),
      ...(hasHeavyLine(context) ? [] : ["align a rook or queen with the king zone"])
    ]),
    classifyState: stateFor
  },
  {
    family: "BACK_RANK",
    prefilter: context => context.kingOnHomeRank && piecesOf(context, context.analysis.defenderSide, "p").length > 0,
    score: context => score([
      context.kingOnHomeRank,
      context.escapeSquares.filter(escape => escape.occupiedBy === context.analysis.defenderSide).length >= 2,
      hasHeavyLine(context),
      kingBlocked(context) >= 3
    ], [
      evidence("defender king on home rank", context.kingOnHomeRank ? 1 : 0),
      evidence("own pieces block home-rank escapes", clamp(context.escapeSquares.filter(escape => escape.occupiedBy === context.analysis.defenderSide).length / 3)),
      evidence("heavy piece attacks the back-rank zone", hasHeavyLine(context) ? 1 : 0),
      evidence("escape squares are unavailable", clamp(kingBlocked(context) / 4))
    ], [
      ...(context.kingOnHomeRank ? [] : ["keep the king on its home rank"]),
      ...(hasHeavyLine(context) ? [] : ["open a heavy-piece line to the home rank"])
    ]),
    classifyState: stateFor
  },
  {
    family: "BODEN",
    prefilter: context => piecesOf(context, context.analysis.attackerSide, "b").length >= 2,
    score: context => {
      const bishops = piecesOf(context, context.analysis.attackerSide, "b");
      const crossing = bishops.length >= 2 && bishops.some(first => bishops.some(second => first.square.file !== second.square.file && first.square.rank !== second.square.rank));
      return score([
        bishops.length >= 2,
        crossing,
        relationExists(context, "ATTACKS"),
        kingBlocked(context) >= 2
      ], [
        evidence("attacking bishop pair", bishops.length >= 2 ? 1 : 0),
        evidence("crossing diagonal geometry", crossing ? 1 : 0),
        evidence("bishop attacks the king zone", relationExists(context, "ATTACKS") ? 1 : 0),
        evidence("escape geometry is restricted", clamp(kingBlocked(context) / 3))
      ], [
        ...(bishops.length >= 2 ? [] : ["coordinate two attacking bishops"]),
        ...(crossing ? [] : ["create crossing diagonal geometry"])
      ]);
    },
    classifyState: stateFor
  },
  {
    family: "SMOTHERED",
    prefilter: context => piecesOf(context, context.analysis.attackerSide, "n").length > 0,
    score: context => score([
      hasKnightEscapeControl(context),
      kingBlocked(context) >= 4,
      context.kingInCorner || context.kingOnEdge,
      piecesOf(context, context.analysis.defenderSide).filter(piece => piece.type !== "k").length >= 2
    ], [
      evidence("attacking knight controls king zone", hasKnightEscapeControl(context) ? 1 : 0),
      evidence("king is smothered by unavailable escapes", clamp(kingBlocked(context) / 5)),
      evidence("king is near board edge", context.kingInCorner || context.kingOnEdge ? 1 : 0),
      evidence("defender pieces occupy the smothering zone", clamp(piecesOf(context, context.analysis.defenderSide).filter(piece => piece.type !== "k").length / 3))
    ], [
      ...(hasKnightEscapeControl(context) ? [] : ["place a knight attack on the king zone"]),
      ...(kingBlocked(context) >= 4 ? [] : ["remove or occupy all king escape squares"])
    ]),
    classifyState: stateFor
  }
];

type CorePolicy = Readonly<{
  label: string;
  conditions: (context: PatternPositionContext) => readonly boolean[];
  prefilter: (context: PatternPositionContext) => boolean;
}>;

const attackers = (context: PatternPositionContext) => piecesOf(context, context.analysis.attackerSide);
const defenders = (context: PatternPositionContext) => piecesOf(context, context.analysis.defenderSide);
const has = (context: PatternPositionContext, type: "n" | "b" | "r" | "q"): boolean => piecesOf(context, context.analysis.attackerSide, type).length > 0;
const hasAtLeast = (context: PatternPositionContext, type: "n" | "b" | "r" | "q", count: number): boolean => piecesOf(context, context.analysis.attackerSide, type).length >= count;
const edgeOrCorner = (context: PatternPositionContext): boolean => context.kingOnEdge || context.kingInCorner;

const corePolicies: Readonly<Partial<Record<PatternFamilyId, CorePolicy>>> = {
  BALESTRA: { label: "bishop and heavy-piece coordination", prefilter: context => has(context, "b") && has(context, "q"), conditions: context => [has(context, "b"), has(context, "q"), relationExists(context, "ATTACKS"), controlledEscapeCount(context) >= 2] },
  BLIND_SWINE: { label: "two-rook seventh/eighth-rank pressure", prefilter: context => hasAtLeast(context, "r", 2), conditions: context => [hasAtLeast(context, "r", 2), context.kingOnHomeRank, relationExists(context, "ATTACKS", relation => relation.pieceType === "r"), controlledEscapeCount(context) >= 2] },
  CORNER: { label: "corner confinement", prefilter: context => context.kingInCorner, conditions: context => [context.kingInCorner, has(context, "r") || has(context, "q"), controlledEscapeCount(context) >= 2, relationExists(context, "ATTACKS")] },
  DOUBLE_BISHOP: { label: "double-bishop crossing control", prefilter: context => hasAtLeast(context, "b", 2), conditions: context => [hasAtLeast(context, "b", 2), relationExists(context, "ATTACKS", relation => relation.pieceType === "b"), controlledEscapeCount(context) >= 2, piecesOf(context, context.analysis.attackerSide, "b").some(first => piecesOf(context, context.analysis.attackerSide, "b").some(second => first.square.file !== second.square.file && first.square.rank !== second.square.rank))] },
  DOVETAIL: { label: "queen-supported restricted king zone", prefilter: context => has(context, "q"), conditions: context => [has(context, "q"), defenders(context).length >= 2, controlledEscapeCount(context) >= 3, relationExists(context, "ATTACKS")] },
  EPAULETTE: { label: "defender pieces block both lateral exits", prefilter: context => context.kingOnEdge, conditions: context => [context.kingOnEdge, context.escapeSquares.filter(square => square.occupiedBy === context.analysis.defenderSide).length >= 2, has(context, "q") || has(context, "r"), controlledEscapeCount(context) >= 2] },
  HOOK: { label: "rook and knight hook geometry", prefilter: context => has(context, "r") && has(context, "n"), conditions: context => [has(context, "r"), has(context, "n"), relationExists(context, "CONTROLS_ESCAPE", relation => relation.pieceType === "n"), relationExists(context, "ATTACKS", relation => relation.pieceType === "r")] },
  KILL_BOX: { label: "multi-piece king kill box", prefilter: context => controlledEscapeCount(context) >= 2, conditions: context => [controlledEscapeCount(context) >= 4, attackers(context).length >= 3, relationExists(context, "ATTACKS"), edgeOrCorner(context)] },
  PILLSBURY: { label: "queen and bishop diagonal battery", prefilter: context => has(context, "q") && has(context, "b"), conditions: context => [has(context, "q"), has(context, "b"), relationExists(context, "ATTACKS", relation => relation.pieceType === "b"), controlledEscapeCount(context) >= 2] },
  MORPHYS: { label: "rook/queen corridor with restricted king", prefilter: context => edgeOrCorner(context) && (has(context, "r") || has(context, "q")), conditions: context => [edgeOrCorner(context), has(context, "r") || has(context, "q"), relationExists(context, "ATTACKS"), controlledEscapeCount(context) >= 3] },
  OPERA: { label: "long-range rook and minor-piece corridor", prefilter: context => has(context, "r") && (has(context, "b") || has(context, "n")), conditions: context => [has(context, "r"), has(context, "b") || has(context, "n"), relationExists(context, "ATTACKS", relation => relation.pieceType === "r"), controlledEscapeCount(context) >= 2] },
  SWALLOWTAIL: { label: "bishop and knight escape net", prefilter: context => has(context, "b") && has(context, "n"), conditions: context => [has(context, "b"), has(context, "n"), relationExists(context, "CONTROLS_ESCAPE", relation => relation.pieceType === "n"), controlledEscapeCount(context) >= 3] },
  TRIANGLE: { label: "three-sided diagonal/line confinement", prefilter: context => attackers(context).length >= 3, conditions: context => [attackers(context).length >= 3, relationExists(context, "ATTACKS"), controlledEscapeCount(context) >= 3, edgeOrCorner(context)] },
  VUKOVIC: { label: "knight and rook mating net", prefilter: context => has(context, "n") && has(context, "r"), conditions: context => [has(context, "n"), has(context, "r"), relationExists(context, "CONTROLS_ESCAPE", relation => relation.pieceType === "n"), relationExists(context, "ATTACKS", relation => relation.pieceType === "r")] }
};

const coreMatcher = (family: PatternFamilyId, policy: CorePolicy): PatternMatcher => ({
  family,
  prefilter: policy.prefilter,
  score: context => {
    const conditions = policy.conditions(context);
    const similarity = clamp(conditions.filter(Boolean).length / Math.max(1, conditions.length));
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
  prefilter: () => true,
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
  const result = matcher.prefilter(context)
    ? matcher.score(context)
    : {
      similarity: 0,
      evidence: [evidence("family prefilter rejected position", 0)],
      missingConditions: [`${family} structural prefilter is not satisfied`],
      contradictions: []
    };
  return {
    tag: "PatternAssessment",
    family,
    similarity: result.similarity,
    progress: result.similarity - previousSimilarity,
    state: matcher.classifyState(result),
    evidence: result.evidence,
    missingConditions: result.missingConditions,
    contradictions: result.contradictions,
    modelVersion: `${PATTERN_MODEL_VERSION}-relational-v1`
  };
};

export const retrievePatternFamilies = (context: PatternPositionContext, limit = 8): readonly PatternAssessment[] => PATTERN_FAMILY_IDS
  .map(family => assessPatternContext(context, family))
  .sort((first, second) => second.similarity - first.similarity || first.family.localeCompare(second.family))
  .slice(0, Math.max(1, limit));
