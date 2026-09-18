import type { PatternFamilyId, PatternAssessment, PatternEvidence, PatternState } from "./pattern";
import { PATTERN_FAMILY_IDS, PATTERN_MODEL_VERSION } from "./pattern";
import { piecesOf, relationExists, type PatternPositionContext } from "./context";

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

const matcherMap: Readonly<Record<PatternFamilyId, PatternMatcher>> = Object.fromEntries(PATTERN_FAMILY_IDS.map(family => [family, firstWave.find(matcher => matcher.family === family) ?? fallbackMatcher(family)])) as Record<PatternFamilyId, PatternMatcher>;

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
