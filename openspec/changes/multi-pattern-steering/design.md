# Design

`PatternSteeredTalPathRequest.targetFamily` is an optional fixed attractor. When
present, every attacker-side decision scores candidates against that family;
Maia still supplies defender plies and the Tal gate remains authoritative.

The discovery path records every unique family after an observed post-Maia
affinity reaches 0.97. A bounded scheduler runs at most three fixed-family
branches concurrently, queues later threshold hits, and ranks completed
branches by total root-to-terminal plies. The final result contains the three
shortest completed terminal lines, with unfinished branches retained only when
fewer than three terminal results exist.
