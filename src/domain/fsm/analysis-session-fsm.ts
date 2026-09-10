import { domainError, type DomainError } from "../shared/errors";
import { event, type DomainEvent } from "../shared/events";
import { err, ok, type Result } from "../shared/result";

export type AnalysisSessionState =
  | Readonly<{ tag: "Created" }>
  | Readonly<{ tag: "ReasoningRecorded" }>
  | Readonly<{ tag: "SeedsReady" }>
  | Readonly<{ tag: "Generating" }>
  | Readonly<{ tag: "ReadyForReview" }>
  | Readonly<{ tag: "DecisionRecorded" }>
  | Readonly<{ tag: "Failed"; reason: DomainError }>;

export type AnalysisSessionEventName =
  | "RecordReasoning"
  | "AcceptSeeds"
  | "StartGeneration"
  | "CompleteGeneration"
  | "RecordDecision"
  | "Fail";

export type AnalysisSessionFsmResult<S> = Readonly<{ state: S; events: readonly DomainEvent[] }>;

const transitionTable: Readonly<Record<string, AnalysisSessionState["tag"]>> = {
  "Created:RecordReasoning": "ReasoningRecorded",
  "ReasoningRecorded:AcceptSeeds": "SeedsReady",
  "SeedsReady:StartGeneration": "Generating",
  "Generating:CompleteGeneration": "ReadyForReview",
  "ReadyForReview:RecordDecision": "DecisionRecorded"
};

export const transitionAnalysisSession = (
  state: AnalysisSessionState,
  eventName: AnalysisSessionEventName,
  reason?: DomainError
): Result<AnalysisSessionFsmResult<AnalysisSessionState>, DomainError> => {
  if (eventName === "Fail") {
    const failure = reason ?? domainError("INVALID_STATE_TRANSITION", "analysisSession", "Analysis session failed");
    return ok({ state: { tag: "Failed", reason: failure }, events: [event("AnalysisSessionFailed", { code: failure.code })] });
  }

  const next = transitionTable[`${state.tag}:${eventName}`];
  if (next === undefined) {
    return err(domainError("INVALID_STATE_TRANSITION", "analysisSession", "Invalid analysis session transition", {
      from: state.tag,
      event: eventName
    }));
  }
  return ok({ state: { tag: next } as AnalysisSessionState, events: [event(`AnalysisSession${next}`)] });
};
