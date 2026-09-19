import type { PatternFamilyId } from "../../domain/patterns/pattern";
import type { ScenarioLine, ScenarioPly } from "../../domain/scenario-lines/scenario-line";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { DomainError } from "../../domain/shared/errors";
import { err, ok, isErr, type Result } from "../../domain/shared/result";
import type { PatternSteeredTalPathRequest } from "./pattern-steered-tal-path";
import { generatePatternSteeredTalPath } from "./pattern-steered-tal-path";

export const MAX_PATTERN_TARGETS = 3;

export const rankPatternTargets = <T extends Readonly<{ targetFamily: string; line?: Readonly<{ status: string; plies: readonly unknown[] }> }>>(
  targets: readonly T[],
  limit = MAX_PATTERN_TARGETS
): readonly T[] => [...targets]
  .sort((first, second) => {
    const firstTerminal = first.line?.status === "Terminal";
    const secondTerminal = second.line?.status === "Terminal";
    if (firstTerminal !== secondTerminal) return firstTerminal ? -1 : 1;
    const firstPlies = first.line?.plies.length ?? Number.POSITIVE_INFINITY;
    const secondPlies = second.line?.plies.length ?? Number.POSITIVE_INFINITY;
    return firstPlies - secondPlies || first.targetFamily.localeCompare(second.targetFamily);
  })
  .slice(0, Math.min(MAX_PATTERN_TARGETS, Math.max(1, limit)));

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
  maxTargets = MAX_PATTERN_TARGETS
): Readonly<{ accepted: boolean; targets: readonly PatternTargetBranch[] }> => {
  const limit = Math.max(1, maxTargets);
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
  const maxTargets = Math.min(MAX_PATTERN_TARGETS, Math.max(1, request.maxTargets ?? MAX_PATTERN_TARGETS));
  const targets: PatternTargetBranch[] = [];
  let latestDiscovery: ScenarioLine | undefined;
  const pendingTargets: PatternTargetBranch[] = [];
  let activeTargets = 0;
  let discoveryFinished = false;
  let resolveAllTargets: (() => void) | undefined;
  const allTargetsFinished = new Promise<void>(resolve => { resolveAllTargets = resolve; });
  const emit = (): void => {
    if (latestDiscovery !== undefined) request.onProgress?.(snapshot(latestDiscovery, targets));
  };
  const pumpTargets = (): void => {
    while (activeTargets < MAX_PATTERN_TARGETS && pendingTargets.length > 0) {
      const target = pendingTargets.shift();
      if (target === undefined) break;
      activeTargets += 1;
      const remainingHorizonPlies = Math.max(1, Number(request.discovery.horizon) - target.prefixPlies.length);
      void Promise.resolve().then(() => request.runTarget({ target, remainingHorizonPlies }, line => {
        const index = targets.findIndex(item => item.targetFamily === target.targetFamily);
        if (index >= 0) targets[index] = { ...target, line };
        emit();
      })).then(result => {
        const index = targets.findIndex(item => item.targetFamily === target.targetFamily);
        if (index >= 0) {
          targets[index] = isErr(result)
            ? { ...target, line: { tag: "ScenarioLine", mode: "HumanPath", label: "PatternSteeredTalPath", start: target.position, horizon: request.discovery.horizon, plies: [], status: "Incomplete", targetFamily: target.targetFamily, error: result.error } }
            : { ...target, line: result.value };
        }
      }).catch(() => undefined).finally(() => {
        activeTargets -= 1;
        emit();
        pumpTargets();
        if (discoveryFinished && activeTargets === 0 && pendingTargets.length === 0) resolveAllTargets?.();
      });
    }
    if (discoveryFinished && activeTargets === 0 && pendingTargets.length === 0) resolveAllTargets?.();
  };
  const onTargetAffinity = (event: Parameters<NonNullable<PatternSteeredTalPathRequest["onTargetAffinity"]>>[0]): void => {
    const registered = registerPatternTarget(targets, event, threshold, Number.MAX_SAFE_INTEGER);
    if (!registered.accepted) return;
    const target = registered.targets.at(-1);
    if (target === undefined) return;
    targets.push(target);
    pendingTargets.push(target);
    emit();
    pumpTargets();
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
  discoveryFinished = true;
  emit();
  pumpTargets();
  await allTargetsFinished;
  return ok(snapshot(discovery.value, rankPatternTargets(targets, maxTargets)));
};
