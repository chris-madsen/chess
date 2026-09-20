import { PATTERN_FAMILY_IDS } from "../src/domain/patterns/pattern.ts";
import { PATTERN_CALIBRATION } from "../src/domain/patterns/pattern-calibration.generated.ts";
import { calibratedAttractorScore, patternPresenceThresholdFor, patternTargetTriggerFor } from "../src/domain/patterns/thresholds.ts";

test("calibration artifact covers every catalog family and marks fixture-less families unavailable", () => {
  expect(Object.keys(PATTERN_CALIBRATION).sort()).toEqual([...PATTERN_FAMILY_IDS].sort());
  for (const family of PATTERN_FAMILY_IDS) {
    const calibration = PATTERN_CALIBRATION[family];
    expect(calibration).toBeDefined();
    if (calibration?.status === "UNAVAILABLE") {
      expect(calibration.points).toBeUndefined();
      expect(calibration.presenceThreshold).toBeUndefined();
      expect(calibration.targetTrigger).toBeUndefined();
    } else {
      expect(calibration?.positiveCount).toBeGreaterThan(0);
      expect(patternPresenceThresholdFor(family)).toBeGreaterThanOrEqual(0);
      const trigger = patternTargetTriggerFor(family);
      expect(trigger === undefined || trigger >= 0).toBe(true);
      const points = calibration?.points ?? [];
      expect(points.every((point, index) => index === 0 || point[0] >= (points[index - 1]?.[0] ?? 0))).toBe(true);
      expect(points.every((point, index) => index === 0 || point[1] >= (points[index - 1]?.[1] ?? 0))).toBe(true);
      expect(calibratedAttractorScore(0, family)).toBeGreaterThanOrEqual(0);
    }
  }
});
