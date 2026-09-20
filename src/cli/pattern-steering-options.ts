export const defaultPatternHorizonMoves = (rawFile: string | undefined): number => (
  // Match the longest normal StylePath conversion window. Pattern discovery
  // can still stop earlier on mate; an explicit flag remains available for
  // longer exploratory searches.
  rawFile === undefined ? 8 : 34
);
