# Educational beauty ranking

Add a post-generation educational analysis layer for Pattern Steering. The
layer ranks complete, legal continuations from the final position supplied by
`game.txt`; the supplied game history remains available for replay and
rendering but is excluded from beauty metrics.

The change keeps Tal admission and Maia response generation authoritative. It
adds explicit, explainable lesson metrics after generation and uses them to
choose up to three unique target lessons, including a shorter Tal alternative
when the length gap exceeds seven full moves.
