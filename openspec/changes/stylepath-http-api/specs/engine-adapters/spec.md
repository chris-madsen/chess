## Requirement: Windows Cloudflare Tunnel publishes only the local API origin

The Windows tunnel setup SHALL publish the local HTTP API origin without storing Cloudflare tunnel tokens in repository files.

### Scenario: Windows tunnel forwards to local API

- GIVEN the Chess Trainer API listens on `127.0.0.1`
- AND a Cloudflare Tunnel route maps a hostname to that local port
- WHEN a client calls the public hostname
- THEN `cloudflared` forwards the request to the local API
- AND analysis requests still require the API bearer token.
