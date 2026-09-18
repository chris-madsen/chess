# Windows Pattern batch deployment

The Linux CLI calls the Windows StylePath service through Cloudflare. The batch API is part of the same `style-server` process, but the live `/v1/style-lines/jobs` semantics remain unchanged.

## Safe update

Run from a clean Windows checkout. Do not use `git reset --hard` when there are local engine/config changes.

```powershell
git status --short
git fetch origin
git merge --ff-only origin/master
npm install
```

If the checkout is not clean, save local work first (`git stash push -u -m pattern-batch-update`) or use a separate deployment checkout. Never commit tokens, `engines.local.json`, or `style-server-token.txt`.

## Start/restart

Restart the process that owns the Cloudflare tunnel after starting the updated server:

```powershell
npm run style:server
cloudflared tunnel run <tunnel-name>
```

The server must be reachable through the existing hostname before the smoke test is run.

## Smoke test from Linux

The token is read locally from the protected token file; it must not be pasted into logs or committed:

```bash
TOKEN="$(cat /media/ilja/DATA/chess/chess-api.ken)"
curl -sS -X POST https://chess.network-communications.net/v1/pattern-experiments/batches \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"cases":[{"caseId":"smoke","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}],"engineSuite":"cstal-windows","cstalOpponent":"maia3","maia3Elo":1800,"concurrency":2}'
```

Expected result is JSON containing a non-empty `batchId`, not `404 Not found`. Then run the bounded held-out benchmark from Linux:

```bash
npm run pattern:experiment -- \
  --dataset datasets/pattern-mvp-lichess.jsonl \
  --provider remote \
  --subset steering-100 \
  --remote-concurrency 2 \
  --maia3-elo 1800
```

If the smoke test returns `404`, the tunnel is up but the Windows process is still running a pre-batch build. If it returns `401`, fix the token/configuration boundary; do not weaken authentication.
