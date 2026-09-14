## Requirement: Local UCI engines stay behind adapters

The system SHALL access Patricia, Jackal, Seer, and Maia through provider ports and SHALL keep UCI subprocess details outside the domain layer.

### Scenario: Local style engine move request

- GIVEN a valid PositionSnapshot and local style engine configuration
- WHEN a style-engine provider is called
- THEN the adapter sends UCI commands to the configured local process
- AND returns exactly one legal move candidate with provider identity and configuration.

### Scenario: Stockfish not used in local StylePath

- GIVEN local StylePath analysis is requested
- WHEN odd/player plies are generated
- THEN Stockfish 19 is not invoked
- AND the selected local style engine is invoked instead.

### Scenario: Windows CSTal engines stay local

- GIVEN the Windows CSTal suite is selected
- WHEN the default engine registry is loaded
- THEN CSTal ABSURD and CSTal EXTREME are loaded from ignored local Windows `.exe` paths
- AND they are exposed only as `LOCAL_STYLE_ENGINE` providers.

### Scenario: Maia3 provides Windows CSTal opponent replies

- GIVEN the Windows CSTal suite is selected
- WHEN an even opponent ply is requested
- THEN Maia3 79M is invoked through UCI
- AND its move provenance remains source `MAIA`.
