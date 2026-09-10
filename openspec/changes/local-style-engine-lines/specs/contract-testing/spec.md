## Requirement: Contract tests cover local StylePath behavior

The system SHALL test preconditions, postconditions, and invariants for local StylePath generation.

### Scenario: Invalid input rejects before providers

- GIVEN invalid FEN or invalid RAW SAN notation
- WHEN local StylePath analysis is requested
- THEN no style engine or Maia provider is called
- AND a typed DomainError is returned.

### Scenario: Domain isolation

- GIVEN the domain source tree
- WHEN architecture tests inspect imports
- THEN domain files do not import UCI, child_process, filesystem, or adapter modules.
