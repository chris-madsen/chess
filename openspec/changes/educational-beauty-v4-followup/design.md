# Design

Pattern steering treats `targetFamily` as an invariant whenever a target is
requested. Discovery may choose a family, but a target branch measures only
its declared family.

The lesson analyzer uses board snapshots and legal move history to verify ray
openings and whether a captured defender attacked a later destination. It does
not infer player intent. Sacrifice profiles expose `functionalContribution`
and `tacticallySupported`; the old type alias remains source-compatible for
consumers importing the contribution type.

Promotion-grind scoring is based on plies after promotion and checks, including
lines that eventually end in mate. Immediate promotion mates remain unpenalized.
