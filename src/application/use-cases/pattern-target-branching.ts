import type { PatternFamilyId } from "../../domain/patterns/pattern";
import type { ScenarioLine, ScenarioPly } from "../../domain/scenario-lines/scenario-line";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { DomainError } from "../../domain/shared/errors";
import { err, ok, isErr, type Result } from "../../domain/shared/result";
import type { ForcedMateVerifier } from "../ports/forced-mate";
import type { ForcedMateVerification } from "../../domain/patterns/outcomes";
import type { PatternSteeredTalPathRequest } from "./pattern-steered-tal-path";
import { generatePatternSteeredTalPath } from "./pattern-steered-tal-path";
import { patternTargetTriggerFor } from "../../domain/patterns/thresholds";

export const MAX_PATTERN_TARGETS = 3;

const lineSignatureFor = (target: Readonly<{ prefixPlies: readonly ScenarioPly[]; line?: ScenarioLine }>): string | undefined => {
  if (target.line === undefined) return undefined;
  return [...target.prefixPlies, ...target.line.plies].map(ply => String(ply.move.uci)).join(" ");
};

export const deduplicatePatternTargets = <T extends Readonly<{ targetFamily: string }>>(targets: readonly T[]): readonly T[] => {
  const groups = new Map<string, T[]>();
  const passthrough: T[] = [];
  for (const target of targets) {
    const candidate = target as T & { fullLineSignature?: string; line?: Readonly<{ plies: readonly Readonly<{ move?: Readonly<{ uci: string }> }>[] }>; triggerAffinity?: number; alsoMatches?: readonly string[] };
    const signature = candidate.fullLineSignature ?? (candidate.line === undefined ? undefined : candidate.line.plies.map(ply => ply.move?.uci ?? "").join(" "));
    if (signature === undefined || signature.length === 0) passthrough.push(target);
    else groups.set(signature, [...(groups.get(signature) ?? []), target]);
  }
  const merged = [...groups.entries()].map(([signature, group]) => {
    const representative = [...group].sort((first, second) => ((second as typeof first & { triggerAffinity?: number }).triggerAffinity ?? 0) - ((first as typeof second & { triggerAffinity?: number }).triggerAffinity ?? 0) || first.targetFamily.localeCompare(second.targetFamily))[0]!;
    const alsoMatches = [...new Set(group.flatMap(item => [item.targetFamily, ...(((item as typeof item & { alsoMatches?: readonly string[] }).alsoMatches) ?? [])]).filter(family => family !== representative.targetFamily))].sort();
    return { ...representative, fullLineSignature: signature, ...(alsoMatches.length === 0 ? {} : { alsoMatches }) };
  });
  return [...passthrough, ...merged] as readonly T[];
};

export const rankPatternTargets = <T extends Readonly<{ targetFamily: string; humanPathMate?: boolean; line?: Readonly<{ status: string; plies: readonly unknown[] }> }>>(
  targets: readonly T[],
  limit = MAX_PATTERN_TARGETS
): readonly T[] => [...deduplicatePatternTargets(targets)]
  .sort((first, second) => {
    const firstMate = first.humanPathMate === true;
    const secondMate = second.humanPathMate === true;
    if (firstMate !== secondMate) return firstMate ? -1 : 1;
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
  forcedMate?: ForcedMateVerification;
  humanPathMate?: boolean;
  fullLineSignature?: string;
  fullRootToTerminalPlies?: number;
  alsoMatches?: readonly PatternFamilyId[];
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
  verifyForcedMate?: ForcedMateVerifier;
  onProgress?: (session: PatternTargetSession) => void;
}>;

const snapshot = (discovery: ScenarioLine, targets: readonly PatternTargetBranch[]): PatternTargetSession => ({ discovery, targets });

export const generatePatternTargetSession = async (
  request: PatternTargetSessionRequest
): Promise<Result<PatternTargetSession, DomainError>> => {
  const threshold = request.threshold;
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
      })).then(async result => {
        const index = targets.findIndex(item => item.targetFamily === target.targetFamily);
        if (index >= 0) {
          if (isErr(result)) {
            targets[index] = { ...target, line: { tag: "ScenarioLine", mode: "HumanPath", label: "PatternSteeredTalPath", start: target.position, horizon: request.discovery.horizon, plies: [], status: "Incomplete", targetFamily: target.targetFamily, error: result.error } };
          } else {
            let forcedMate: ForcedMateVerification | undefined;
            if (request.verifyForcedMate !== undefined) {
              let terminalPosition = target.position;
              let positionError: DomainError | undefined;
              for (const ply of result.value.plies) {
                const next = request.discovery.chess.applyMove(terminalPosition, ply.move);
                if (isErr(next)) { positionError = next.error; break; }
                terminalPosition = next.value;
              }
              if (positionError !== undefined) forcedMate = { status: "UNAVAILABLE", reason: positionError.message };
              else {
                const proof = await request.verifyForcedMate({ start: target.position, line: result.value, terminalPosition });
                forcedMate = isErr(proof) ? { status: "UNAVAILABLE", reason: proof.error.message } : proof.value;
              }
            }
            const terminalPositionResult = result.value.status === "Terminal"
              ? result.value.plies.reduce((current, ply) => {
                if (isErr(current)) return current;
                return request.discovery.chess.applyMove(current.value, ply.move);
              }, ok(target.position) as Result<PositionSnapshot, DomainError>)
              : undefined;
            const humanPathMate = terminalPositionResult !== undefined && !isErr(terminalPositionResult)
              ? request.discovery.chess.computeFacts(terminalPositionResult.value)
              : undefined;
            const fullLineSignature = lineSignatureFor({ prefixPlies: target.prefixPlies, line: result.value });
            targets[index] = {
              ...target,
              line: result.value,
              ...(forcedMate === undefined ? {} : { forcedMate }),
              ...(fullLineSignature === undefined ? {} : { fullLineSignature, fullRootToTerminalPlies: target.prefixPlies.length + result.value.plies.length }),
              ...(humanPathMate !== undefined && !isErr(humanPathMate) ? { humanPathMate: humanPathMate.value.isCheckmate } : {})
            };
          }
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
    const registered = registerPatternTarget(targets, event, threshold ?? patternTargetTriggerFor(event.targetFamily), Number.MAX_SAFE_INTEGER);
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
