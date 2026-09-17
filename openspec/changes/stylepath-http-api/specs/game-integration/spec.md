## Requirement: HTTP analysis remains read-only

The StylePath HTTP API SHALL NOT submit moves, create challenges, send chat, resign, abort, or otherwise write to an external chess platform.

### Scenario: API request cannot create a platform command

- GIVEN a valid authenticated StylePath API request
- WHEN the request completes
- THEN the response contains analysis data only
- AND no PlatformCommand is created.
