import type { PatternFamilyId } from "../../domain/patterns/pattern";
import type { ScenarioLine, ScenarioPly } from "../../domain/scenario-lines/scenario-line";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { DomainError } from "../../domain/shared/errors";
import { err, ok, isErr, type Result } from "../../domain/shared/result";
import type { PatternSteeredTalPathRequest } from "./pattern-steered-tal-path";
import { generatePatternSteeredTalPath } from "./pattern-steered-tal-path";

export type PatternTargetBranch = Readonly<{
  targetFamily: PatternFamilyId;
  triggerPly: number;
  triggerAffinity: number;
  position: PositionSnapshot;
  prefixPlies: readonly ScenarioPly[];
  line?: ScenarioLine;
}>;

export type PatternTargetSession = Readonly<{
  discovery: ScenarioLine;
  targets: readonly PatternTargetBranch[];
}>;

export type PatternTargetBranchRequest = Readonly<{
  target: Omit<PatternTargetBranch, "line">;
  remainingHorizonPlies: number;
}>;

export type PatternTargetAffinityEvent = Readonly<{
  targetFamily: PatternFamilyId;
  affinity: number;
  position: PositionSnapshot;
  prefixPlies: readonly ScenarioPly[];
}>;

export const registerPatternTarget = (
  targets: readonly PatternTargetBranch[],
  event: PatternTargetAffinityEvent,
  threshold = 0.97,
  maxTargets = 5
): Readonly<{ accepted: boolean; targets: readonly PatternTargetBranch[] }> => {
  const limit = Math.min(5, Math.max(1, maxTargets));
  if (event.affinity < threshold || targets.some(target => target.targetFamily === event.targetFamily) || targets.length >= limit) return { accepted: false, targets };
  return {
    accepted: true,
    targets: [...targets, {
      targetFamily: event.targetFamily,
      triggerPly: event.prefixPlies.length,
      triggerAffinity: event.affinity,
      position: event.position,
      prefixPlies: event.prefixPlies
    }]
  };
};

export type PatternTargetSessionRequest = Readonly<{
  discovery: PatternSteeredTalPathRequest;
  runTarget: (request: PatternTargetBranchRequest, onProgress: (line: ScenarioLine) => void) => Promise<Result<ScenarioLine, DomainError>>;
  threshold?: number;
  maxTargets?: number;
  onProgress?: (session: PatternTargetSession) => void;
}>;

const snapshot = (discovery: ScenarioLine, targets: readonly PatternTargetBranch[]): PatternTargetSession => ({ discovery, targets });

export const generatePatternTargetSession = async (
  request: PatternTargetSessionRequest
): Promise<Result<PatternTargetSession, DomainError>> => {
  const threshold = request.threshold ?? 0.97;
  const maxTargets = Math.min(5, Math.max(1, request.maxTargets ?? 5));
  const targets: PatternTargetBranch[] = [];
  let latestDiscovery: ScenarioLine | undefined;
  const targetPromises: Promise<void>[] = [];
  const emit = (): void => {
    if (latestDiscovery !== undefined) request.onProgress?.(snapshot(latestDiscovery, targets));
  };
  const onTargetAffinity = (event: Parameters<NonNullable<PatternSteeredTalPathRequest["onTargetAffinity"]>>[0]): void => {
    const registered = registerPatternTarget(targets, event, threshold, maxTargets);
    if (!registered.accepted) return;
    const target = registered.targets.at(-1);
    if (target === undefined) return;
    targets.push(target);
    emit();
    const remainingHorizonPlies = Math.max(1, Number(request.discovery.horizon) - event.prefixPlies.length);
    const run = request.runTarget({ target, remainingHorizonPlies }, line => {
      const index = targets.findIndex(item => item.targetFamily === target.targetFamily);
      if (index >= 0) targets[index] = { ...target, line };
      emit();
    }).then(result => {
      const index = targets.findIndex(item => item.targetFamily === target.targetFamily);
      if (index >= 0 && !isErr(result)) targets[index] = { ...target, line: result.value };
      emit();
      if (isErr(result)) throw new Error(`${result.error.code}: ${result.error.message}`);
    });
    targetPromises.push(run);
  };
  const discoveryRequest: PatternSteeredTalPathRequest = {
    ...request.discovery,
    onProgress: line => {
      latestDiscovery = line;
      request.discovery.onProgress?.(line);
      emit();
    },
    onTargetAffinity
  };
  const discovery = await generatePatternSteeredTalPath(discoveryRequest);
  if (isErr(discovery)) return err(discovery.error);
  latestDiscovery = discovery.value;
  emit();
  try {
    await Promise.all(targetPromises);
  } catch (error) {
    return err({ code: "PROVIDER_UNAVAILABLE", path: "patternTargetBranching.target", message: error instanceof Error ? error.message : String(error) });
  }
  return ok(snapshot(discovery.value, targets));
};
