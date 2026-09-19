import type { PatternFamilyId } from "./pattern";

/**
 * Production trigger calibration generated from the checked-in
 * checked-in positive calibration fixtures after the v2
 * geometry model. These are trigger thresholds, not claims that affinity
 * percentages are interchangeable across families.
 */
const CALIBRATED_TRIGGER_THRESHOLDS: Readonly<Partial<Record<PatternFamilyId, number>>> = {
  ANASTASIA: 0.798,
  ARABIAN: 0.442,
  BACK_RANK: 0.442,
  BALESTRA: 0.442,
  BLIND_SWINE: 0.426,
  BODEN: 0.339,
  CORNER: 0.499,
  DOUBLE_BISHOP: 0.151,
  DOVETAIL: 0.385,
  EPAULETTE: 0.470,
  HOOK: 0.258,
  KILL_BOX: 0.356,
  MORPHYS: 0.394,
  OPERA: 0.333,
  PILLSBURY: 0.328,
  SMOTHERED: 0.902,
  SWALLOWTAIL: 0.499,
  TRIANGLE: 0.368,
  VUKOVIC: 0.303
};

export const patternTriggerThresholdFor = (family: PatternFamilyId): number => CALIBRATED_TRIGGER_THRESHOLDS[family] ?? 0.97;

export const patternTriggerThresholds = (): Readonly<Partial<Record<PatternFamilyId, number>>> => ({ ...CALIBRATED_TRIGGER_THRESHOLDS });
