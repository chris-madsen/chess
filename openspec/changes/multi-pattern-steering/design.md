# Design

`PatternSteeredTalPathRequest.targetFamily` is an optional fixed attractor. When
present, every attacker-side decision scores candidates against that family;
Maia still supplies defender plies and the Tal gate remains authoritative.

The discovery path invokes a bounded target callback only after an observed
post-Maia affinity reaches 0.97. The callback starts a branch from that exact
position. Duplicate families are ignored and the first five unique threshold
hits are the only target branches created; no later filtering runs extra lines.
