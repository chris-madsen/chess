import type { PatternAssessment } from "./pattern";

export type ForcedMateVerification = Readonly<{
  status: "VERIFIED" | "NOT_VERIFIED" | "UNAVAILABLE";
  provider?: string;
  limits?: Readonly<Record<string, unknown>>;
  reason?: string;
}>;

export type PatternLineOutcome = Readonly<{
  patternMatch: boolean;
  recognizableFamily: boolean;
  terminalMate: boolean;
  forcedMate: ForcedMateVerification;
  beautifulForcedCombination: boolean;
  bestAssessment?: PatternAssessment;
}>;

export const makePatternLineOutcome = (input: Readonly<{
  assessments: readonly PatternAssessment[];
  terminalMate: boolean;
  forcedMate: ForcedMateVerification;
}>): PatternLineOutcome => {
  const bestAssessment = input.assessments.reduce<PatternAssessment | undefined>(
    (best, current) => best === undefined || current.similarity > best.similarity ? current : best,
    undefined
  );
  const patternMatch = bestAssessment !== undefined && bestAssessment.similarity >= 0.65;
  const recognizableFamily = bestAssessment !== undefined && ["near", "mate_basin"].includes(bestAssessment.state);
  return {
    patternMatch,
    recognizableFamily,
    terminalMate: input.terminalMate,
    forcedMate: input.forcedMate,
    beautifulForcedCombination: patternMatch && input.terminalMate && input.forcedMate.status === "VERIFIED",
    ...(bestAssessment === undefined ? {} : { bestAssessment })
  };
};
