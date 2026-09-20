import type { PatternFamilyId } from "./pattern";
import { PATTERN_CALIBRATION } from "./pattern-calibration.generated";

const calibrationFor = (family: PatternFamilyId) => PATTERN_CALIBRATION[family];

export const patternTargetTriggerFor = (family: PatternFamilyId): number | undefined => {
  const calibration = calibrationFor(family);
  return calibration?.status === "CALIBRATED" ? calibration.targetTrigger : undefined;
};
export const patternPresenceThresholdFor = (family: PatternFamilyId): number => calibrationFor(family)?.status === "CALIBRATED" ? calibrationFor(family)?.presenceThreshold ?? 1 : 1;

export const calibratedAttractorScore = (rawAffinity: number, family: PatternFamilyId): number => {
  const points = calibrationFor(family)?.points;
  if (points === undefined || points.length === 0) return 0;
  if (rawAffinity <= (points[0]?.[0] ?? 0)) return points[0]?.[1] ?? 0;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]!;
    const right = points[index]!;
    if (rawAffinity <= right[0]) {
      const span = Math.max(0.000001, right[0] - left[0]);
      return Math.max(0, Math.min(1, left[1] + ((rawAffinity - left[0]) / span) * (right[1] - left[1])));
    }
  }
  const left = points[points.length - 2] ?? points[0]!;
  const right = points[points.length - 1] ?? left;
  const span = Math.max(0.000001, right[0] - left[0]);
  return Math.max(0, Math.min(1, right[1] + ((rawAffinity - right[0]) / span) * (right[1] - left[1])));
};

export const patternTriggerThresholdFor = patternTargetTriggerFor;
export const patternTriggerThresholds = (): Readonly<Partial<Record<PatternFamilyId, number>>> => Object.fromEntries(
  Object.entries(PATTERN_CALIBRATION)
    .filter(([, calibration]) => calibration.status === "CALIBRATED" && calibration.targetTrigger !== undefined)
    .map(([family, calibration]) => [family, calibration.targetTrigger])
) as Partial<Record<PatternFamilyId, number>>;
