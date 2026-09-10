import { domainError, type DomainError } from "../shared/errors";
import { event, type DomainEvent } from "../shared/events";
import { err, ok, type Result } from "../shared/result";

export type ScenarioLineState =
  | Readonly<{ tag: "SeedPending" }>
  | Readonly<{ tag: "SeedAccepted" }>
  | Readonly<{ tag: "AwaitingMaia" }>
  | Readonly<{ tag: "AwaitingStockfish" }>
  | Readonly<{ tag: "Completed" }>
  | Readonly<{ tag: "Incomplete"; reason: DomainError }>
  | Readonly<{ tag: "Terminal" }>
  | Readonly<{ tag: "Failed"; reason: DomainError }>;

export type ScenarioLineEventName =
  | "AcceptSeed"
  | "RequestMaia"
  | "AcceptMaia"
  | "AcceptStockfish"
  | "Complete"
  | "ReachTerminal"
  | "ProviderError"
  | "Fail";

export type ScenarioLineFsmResult<S> = Readonly<{ state: S; events: readonly DomainEvent[] }>;

const transitionTable: Readonly<Record<string, ScenarioLineState["tag"]>> = {
  "SeedPending:AcceptSeed": "SeedAccepted",
  "SeedAccepted:RequestMaia": "AwaitingMaia",
  "AwaitingMaia:AcceptMaia": "AwaitingStockfish",
  "AwaitingStockfish:AcceptStockfish": "AwaitingMaia",
  "AwaitingMaia:Complete": "Completed",
  "AwaitingStockfish:Complete": "Completed",
  "SeedAccepted:Complete": "Completed",
  "AwaitingMaia:ReachTerminal": "Terminal",
  "AwaitingStockfish:ReachTerminal": "Terminal",
  "SeedAccepted:ReachTerminal": "Terminal"
};

export const transitionScenarioLine = (
  state: ScenarioLineState,
  eventName: ScenarioLineEventName,
  reason?: DomainError
): Result<ScenarioLineFsmResult<ScenarioLineState>, DomainError> => {
  if (eventName === "ProviderError") {
    const failure = reason ?? domainError("PROVIDER_UNAVAILABLE", "scenarioLine.provider", "Provider failed");
    return ok({ state: { tag: "Incomplete", reason: failure }, events: [event("ScenarioLineIncomplete", { code: failure.code })] });
  }
  if (eventName === "Fail") {
    const failure = reason ?? domainError("INVALID_STATE_TRANSITION", "scenarioLine", "Scenario line failed");
    return ok({ state: { tag: "Failed", reason: failure }, events: [event("ScenarioLineFailed", { code: failure.code })] });
  }

  const next = transitionTable[`${state.tag}:${eventName}`];
  if (next === undefined) {
    return err(domainError("INVALID_STATE_TRANSITION", "scenarioLine", "Invalid scenario line transition", {
      from: state.tag,
      event: eventName
    }));
  }
  return ok({ state: { tag: next } as ScenarioLineState, events: [event(`ScenarioLine${next}`)] });
};
