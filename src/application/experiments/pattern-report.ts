import type { PatternExperimentResult } from "../use-cases/pattern-experiment";

export type PatternMetric = Readonly<{
  successes: number;
  total: number;
  rate: number;
}>;

export type PairedDifference = Readonly<{
  mean: number;
  lower95: number;
  upper95: number;
}>;

export type PatternExperimentReport = Readonly<{
  datasetVersion: string;
  total: number;
  metrics: Readonly<{
    baseline: PatternMetric;
    treatment: PatternMetric;
    control: PatternMetric;
  }>;
  treatmentVsBaseline: PairedDifference;
  status: "SUCCESS" | "FAILURE" | "INCONCLUSIVE";
  reason: string;
}>;

const metric = (values: readonly boolean[]): PatternMetric => {
  const successes = values.filter(Boolean).length;
  return { successes, total: values.length, rate: values.length === 0 ? 0 : successes / values.length };
};

export const pairedDifference95 = (baseline: readonly boolean[], treatment: readonly boolean[]): PairedDifference => {
  const size = Math.min(baseline.length, treatment.length);
  if (size === 0) return { mean: 0, lower95: 0, upper95: 0 };
  const differences = Array.from({ length: size }, (_, index) => Number(treatment[index] === true) - Number(baseline[index] === true));
  const mean = differences.reduce((sum, value) => sum + value, 0) / size;
  const variance = differences.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, size - 1);
  const margin = 1.96 * Math.sqrt(variance / size);
  return { mean, lower95: mean - margin, upper95: mean + margin };
};

export const summarizePatternExperiment = (
  datasetVersion: string,
  results: readonly PatternExperimentResult[]
): PatternExperimentReport => {
  const baseline = results.map(result => result.comparison.baseline.beautifulForcedCombination);
  const treatment = results.map(result => result.comparison.treatment.beautifulForcedCombination);
  const control = results.map(result => result.comparison.control.beautifulForcedCombination);
  const treatmentVsBaseline = pairedDifference95(baseline, treatment);
  const safetyOk = results.every(result => result.baseline.line.status !== "Incomplete" && result.alternative.line.status !== "Incomplete");
  const enoughData = results.length >= 300;
  const success = enoughData && safetyOk && treatmentVsBaseline.mean >= 0.05 && treatmentVsBaseline.lower95 > 0;
  const failure = enoughData && (!safetyOk || treatmentVsBaseline.upper95 <= 0);
  return {
    datasetVersion,
    total: results.length,
    metrics: { baseline: metric(baseline), treatment: metric(treatment), control: metric(control) },
    treatmentVsBaseline,
    status: success ? "SUCCESS" : failure ? "FAILURE" : "INCONCLUSIVE",
    reason: !enoughData
      ? "At least 300 independent cases are required"
      : !safetyOk
        ? "At least one provider line was incomplete"
        : success
          ? "Treatment improves beautiful forced combination rate by the required margin"
          : "The confidence interval does not establish the required improvement"
  };
};
