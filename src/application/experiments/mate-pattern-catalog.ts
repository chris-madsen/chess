import { PATTERN_FAMILY_CATALOG, type PatternFamilyId } from "../../domain/patterns/pattern";

export type MatePatternSourceMetadata = Readonly<{
  family: PatternFamilyId;
  source: "LICHESS_MATE_THEME";
  sourceKey: string;
  trainingUrl: string;
}>;

/** External taxonomy metadata belongs in the application boundary, not domain rules. */
export const LICHESS_MATE_PATTERN_CATALOG: readonly MatePatternSourceMetadata[] = PATTERN_FAMILY_CATALOG.map(definition => ({
  family: definition.id,
  source: "LICHESS_MATE_THEME",
  sourceKey: definition.aliases[0] ?? definition.canonicalKey,
  trainingUrl: `https://lichess.org/training/${definition.aliases[0] ?? definition.canonicalKey}`
}));
