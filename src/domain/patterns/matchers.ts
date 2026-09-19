import type { PatternFamilyId, PatternAssessment, PatternEvidence, PatternState } from "./pattern";
import { PATTERN_FAMILY_IDS, PATTERN_MODEL_VERSION, STEERABLE_PATTERN_FAMILY_IDS } from "./pattern";
import { piecesOf, type PatternPositionContext } from "./context";
import { mateGeometryDescriptorFor, scoreMateGeometry } from "./mate-geometry";
import { calibratedAttractorScore } from "./thresholds";

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

const stateFor = (result: PatternMatcherResult, family: PatternFamilyId): PatternState => {
  const score = calibratedAttractorScore(result.similarity, family);
  // Calibration ranks candidates on a common scale, while the raw geometry
  // still prevents a soft, non-terminal shape from being labelled as a mate.
  return score >= 0.85 && result.similarity >= 0.65 ? "mate_basin" : score >= 0.65 && result.similarity >= 0.5 ? "near" : score >= 0.45 && result.similarity >= 0.5 ? "forming" : score >= 0.25 ? "promising" : "far";
};

const matcherForDescriptor = (family: PatternFamilyId): PatternMatcher => {
  const descriptor = mateGeometryDescriptorFor(family);
  if (descriptor === undefined) throw new Error(`Missing MateGeometry descriptor for ${family}`);
  return {
    family,
    retrievalHint: context => descriptor.variants.some(variant => variant.roles.some(role => piecesOf(context, context.analysis.attackerSide).some(piece => role.allowedPieceTypes.includes(piece.type)))),
    score: context => scoreMateGeometry(context, descriptor),
    classifyState: result => stateFor(result, family)
  };
};

const matcherMap: Readonly<Record<PatternFamilyId, PatternMatcher>> = Object.fromEntries(
  PATTERN_FAMILY_IDS.map(family => [family, matcherForDescriptor(family)])
) as Record<PatternFamilyId, PatternMatcher>;

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
    modelVersion: `${PATTERN_MODEL_VERSION}-mate-geometry-v2`
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
