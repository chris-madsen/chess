# Pattern Layer Rebuild

The current Pattern MVP ranks completed ABSURD and EXTREME trajectories after the fact. This change introduces a correct contextual recognizer, trajectory-aware benchmark, and opt-in move steering while preserving the existing StylePath and HumanPath contracts.

The rebuild is split into a cheap recognizer benchmark over the full corpus and an expensive steering benchmark over a deterministic representative subset. Windows batch execution uses bounded concurrency and does not change the single-latest-job semantics of the live StylePath endpoint.
