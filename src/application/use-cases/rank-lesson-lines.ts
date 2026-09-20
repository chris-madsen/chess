import type { LessonProfile, ShortAlternativeDecision } from "../../domain/lessons/lesson-profile";

export type LessonRankCandidate<T> = Readonly<{ value: T; profile: LessonProfile; fullLineSignature?: string; source?: string }>;

const tier = (profile: LessonProfile): number => ({ A: 5, B: 4, C: 3, D: 2, E: 1, SUPPRESSED: 0 }[profile.qualityTier]);

export const compareLessonProfiles = (first: LessonProfile, second: LessonProfile): number => (
  Number(second.eligible) - Number(first.eligible)
  || tier(second) - tier(first)
  || second.lessonUtility - first.lessonUtility
  || second.combinationBeauty - first.combinationBeauty
  || first.generatedFullMoves - second.generatedFullMoves
  || (first.fullRootToTerminalPlies ?? Number.POSITIVE_INFINITY) - (second.fullRootToTerminalPlies ?? Number.POSITIVE_INFINITY)
  || first.lineId.localeCompare(second.lineId)
);

export const rankLessonLines = <T>(candidates: readonly LessonRankCandidate<T>[], limit = 3): readonly LessonRankCandidate<T>[] => (
  [...new Map(candidates.map(candidate => [candidate.fullLineSignature ?? candidate.profile.lineId, candidate])).values()]
    .sort((first, second) => compareLessonProfiles(first.profile, second.profile)).slice(0, Math.max(1, limit))
);

export const chooseShortTalAlternative = <T>(
  lesson: LessonRankCandidate<T> | undefined,
  baselines: readonly LessonRankCandidate<T>[]
): ShortAlternativeDecision => {
  if (lesson === undefined) return { lessonLineId: "", gapFullMoves: 0, shown: false };
  const short = baselines
    .filter(candidate => candidate.profile.eligible && candidate.profile.humanPathMate)
    .filter(candidate => lesson.fullLineSignature === undefined || candidate.fullLineSignature === undefined || candidate.fullLineSignature !== lesson.fullLineSignature)
    .sort((first, second) => first.profile.generatedFullMoves - second.profile.generatedFullMoves || first.profile.lineId.localeCompare(second.profile.lineId))[0];
  if (short === undefined || (short.fullLineSignature !== undefined && lesson.fullLineSignature !== undefined && short.fullLineSignature === lesson.fullLineSignature)) return { lessonLineId: lesson.profile.lineId, gapFullMoves: 0, shown: false };
  const gap = lesson.profile.generatedFullMoves - short.profile.generatedFullMoves;
  return { lessonLineId: lesson.profile.lineId, shortTalLineId: short.profile.lineId, gapFullMoves: gap, shown: gap > 7 && lesson.profile.eligible && short.profile.eligible };
};
