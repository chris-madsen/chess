# FSM Design

## AnalysisSessionFSM

States:

```text
Created -> ReasoningRecorded -> SeedsReady -> Generating -> ReadyForReview -> DecisionRecorded
```

Failure transition:

```text
any non-terminal state -> Failed
```

Invalid transitions fail closed with `INVALID_STATE_TRANSITION`.

## ScenarioLineFSM

States:

```text
SeedPending -> SeedAccepted -> AwaitingMaia -> AwaitingStockfish -> AwaitingMaia ... -> Completed
```

Terminal states:

```text
Completed
Incomplete
Terminal
Failed
```

A terminal chess board moves to `Terminal`. Provider errors move to `Incomplete`. Contract violations move to `Failed`.

## Event style

Transitions return new immutable state plus domain events. They do not mutate existing state.
