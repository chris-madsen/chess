# Windows Pattern API Recovery and Deployment Plan

## Purpose

This document is the handoff for the Windows host that runs the CSTal ABSURD/EXTREME plus Maia providers.
Linux is an API client. It must not need CSTal Windows binaries locally for the remote PatternSelectionExperiment.

The Windows host must expose the same authenticated StylePath job API through Cloudflare:

```text
Linux PatternSelectionExperiment
        |
        | POST /v1/style-lines/jobs with FEN
        | GET  /v1/style-lines/jobs/<jobId>/events
        v
Windows CSTal ABSURD + EXTREME + Maia
```

## Read these documents before changing code

Read them in this order:

1. `AGENTS.md`
2. `openspec/AGENTS.md`
3. `openspec/project.md`
4. `docs/glossary.md`
5. `docs/architecture.md`
6. `docs/decisions/INDEX.md` and the relevant ADRs, especially ADR-005 and ADR-006
7. `openspec/changes/pattern-guided-stylepath/proposal.md`
8. `openspec/changes/pattern-guided-stylepath/design.md`
9. `openspec/changes/pattern-guided-stylepath/tasks.md`
10. `openspec/changes/pattern-guided-stylepath/specs/pattern-guided-analysis/spec.md`
11. `docs/ops/stylepath-http-api.md`
12. `docs/ops/local-engines.md`
13. `src/server/style-server.ts`
14. `src/adapters/http/remote-style-path-adapter.ts`
15. `src/cli/pattern-experiment.ts`

## Do not delete the Pattern MVP

The following are active, required code and must remain in the repository:

- `src/adapters/http/remote-style-path-adapter.ts`
- `src/application/use-cases/pattern-experiment.ts`
- `src/cli/pattern-experiment.ts`
- `src/application/experiments/`
- `src/domain/patterns/`
- `src/domain/cache/`
- `src/adapters/cache/`
- `src/adapters/uci/uci-forced-mate-proof-adapter.ts`
- `tests/remote-style-path.contract.test.js`
- `tests/pattern-experiment.contract.test.js`
- `datasets/pattern-mvp-lichess.jsonl`

Do not reset, force-push, or restore the repository to an older commit just to update the Windows server.
The Windows runtime must be updated to the branch containing commit `44cf76a` and its ancestors.

## Current Git situation

`origin/master` contains later Windows operational commits, but it was based on an older repository state and does not contain the Pattern MVP. A blind pull or reset can delete the Pattern Layer. Integrate changes; do not replace the newer local tree with the older remote tree.

Before changing anything:

```powershell
git status --short
git branch --show-current
git log --oneline --decorate -12
git fetch origin
```

If the branches diverge, stop and inspect the graph. Never use:

```text
git reset --hard origin/master
git push --force
```

Resolve the branch integration in a reviewable merge/rebase and verify that the Pattern MVP files listed above still exist.

## Required server contract

`POST /v1/style-lines/jobs` must accept exactly one input:

- `rawGameBase64`, or
- `fen`.

For the Linux benchmark, `fen` is mandatory because every dataset case starts from a validated position.
The server must normalize it into the existing CLI input ADT:

```ts
{ tag: "Fen", value: request.fen }
```

The server must return both existing lines:

- `cstal-absurd-maia3`
- `cstal-extreme-maia3`

Every returned ply must retain source/provider provenance. The server must reject invalid input and must never fabricate a line.

## Windows deployment steps

Run from the repository root on Windows:

```powershell
git fetch origin
git status --short
npm install
npm run lint
npm run typecheck
npm run test:contracts
```

Make sure the server process is running the checked-out source, not an old detached Node process. Stop the old process using the project’s documented operational procedure, then start:

```powershell
npm run style:server
```

The Cloudflare tunnel must point to the local StylePath server port. `/health` may remain unauthenticated; job endpoints must require the bearer token.

## Verify the API before the benchmark

First check the public health endpoint:

```powershell
curl.exe -i https://chess.network-communications.net/health
```

Then submit one small FEN job. Use the token from the local secret file or environment; never paste it into source, documentation, logs, or chat:

```powershell
$body = @{
  fen = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPPP1P/RNBQKBNR b KQkq - 0 2"
  engineSuite = "cstal-windows"
  cstalOpponent = "maia3"
  maia3Elo = 1800
  refreshMs = 2000
  maxFullMoves = 1
  timeoutMs = 300000
} | ConvertTo-Json -Compress

Invoke-RestMethod `
  -Method Post `
  -Uri "https://chess.network-communications.net/v1/style-lines/jobs" `
  -Headers @{ Authorization = "Bearer $env:STYLE_SERVER_TOKEN" } `
  -ContentType "application/json" `
  -Body $body
```

Expected result: HTTP `202` and a `jobId`. HTTP `400` with `rawGameBase64 is required` means an old server binary/source is still running; fix the Windows deployment before touching Linux code.

## Linux benchmark command

After the Windows smoke test succeeds:

```bash
npm run pattern:experiment -- \
  --dataset datasets/pattern-mvp-lichess.jsonl \
  --provider remote \
  --maia3-elo 1800
```

Linux reads the API token from the configured secret file/environment, submits each FEN, consumes the final SSE snapshot, validates every imported UCI move locally, and only then runs the prefix-only Pattern selector.

## Completion checklist

- [ ] Required documents were read.
- [ ] Git history was inspected before pulling.
- [ ] No Pattern MVP files were deleted.
- [ ] Windows server accepts `fen` jobs.
- [ ] Public job creation returns HTTP `202` and `jobId`.
- [ ] SSE returns both ABSURD and EXTREME lines.
- [ ] Linux remote contract tests pass.
- [ ] A small remote smoke test completes.
- [ ] The full benchmark artifact is saved as JSONL.
- [ ] No secret or authorization header is committed.
