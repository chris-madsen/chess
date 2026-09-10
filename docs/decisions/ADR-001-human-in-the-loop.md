# ADR-001: Preserve Human-in-the-Loop Decision Making

## Status

Accepted

## Context

The product is intended to raise the Player's chess understanding. A system that silently selects and submits moves becomes an autoplay tool and removes the reflective practice that coaching is meant to create.

## Decision

The Player supplies an assessment, plan, and candidate moves whenever practical. Chess Trainer may add candidate ideas and explain scenario lines, but the Player owns the Decision. Normal analysis has no external move-submission capability.

## Consequences

- UI and API distinguish `Decision` from any potential external platform command.
- Analysis sessions can be reviewed and compared without changing a live game.
- Any future write integration requires a new ADR, separate capability specification, explicit confirmation, and audit trail.
