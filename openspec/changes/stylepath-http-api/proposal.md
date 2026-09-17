# Change: StylePath HTTP API and Windows Cloudflare Tunnel

## Summary

Expose the existing local StylePath analysis as a read-only authenticated HTTP API that can run on a Windows machine with local CSTal and Maia engines, then be published through Cloudflare Tunnel.

## Motivation

The current CSTal and Maia mixed lines are available through the CLI only. A remote coach or client needs a stable URL that can request the same StylePath output without shell access to the Windows host.

## Scope

- Add a local HTTP API entrypoint for one-shot StylePath generation.
- Keep chess rules, StylePath orchestration, UCI engines, and Maia behind existing ports/adapters.
- Require bearer-token authentication for analysis requests.
- Document Windows `cloudflared` tunnel setup for a Cloudflare-managed hostname.

## Out of scope

- External chess platform writes.
- Lichess bot probes.
- Streaming/watch HTTP API.
- Cloudflare credential storage in the repository.
