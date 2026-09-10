## Requirement: Local style engine provenance

The system SHALL record local style engine provenance on every style-engine ply.

### Scenario: Local style move provenance

- GIVEN Patricia returns a legal move
- WHEN the move is appended to a StylePath line
- THEN the MoveProvenance source is `LOCAL_STYLE_ENGINE`
- AND provider identity identifies Patricia
- AND configuration records UCI limits and engine key when available.

### Scenario: Maia provenance remains distinct

- GIVEN Maia returns an opponent response in a StylePath line
- WHEN the move is appended
- THEN the MoveProvenance source is `MAIA`
- AND the line does not attribute that Maia move to the local style engine.
