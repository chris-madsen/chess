import { PATTERN_FAMILY_CATALOG, type PatternFamilyId } from "../../domain/patterns/pattern";
import { TACTICAL_MOTIF_CATALOG, type TacticalMotifId } from "../../domain/patterns/motifs";

export type MatePatternSourceMetadata = Readonly<{
  family: PatternFamilyId;
  source: "LICHESS_MATE_THEME" | "EXTENDED_REFERENCE";
  sourceKey: string;
  trainingUrl?: string;
}>;

/** External taxonomy metadata belongs in the application boundary, not domain rules. */
export const MATE_PATTERN_SOURCE_CATALOG: readonly MatePatternSourceMetadata[] = PATTERN_FAMILY_CATALOG.map(definition => {
  const sourceKey = definition.aliases[0] ?? definition.canonicalKey;
  return {
    family: definition.id,
    source: definition.tier === "MVP_NAMED_CORE" ? "LICHESS_MATE_THEME" : "EXTENDED_REFERENCE",
    sourceKey,
    ...(definition.tier === "MVP_NAMED_CORE" ? { trainingUrl: `https://lichess.org/training/${sourceKey}` } : {})
  };
});

export const LICHESS_MATE_PATTERN_CATALOG = MATE_PATTERN_SOURCE_CATALOG.filter(item => item.source === "LICHESS_MATE_THEME");

export type TacticalMotifSourceMetadata = Readonly<{
  motif: TacticalMotifId;
  source: "LICHESS_TACTICAL_THEME";
  sourceKey: string;
  trainingUrl: string;
}>;

export const TACTICAL_MOTIF_SOURCE_CATALOG: readonly TacticalMotifSourceMetadata[] = TACTICAL_MOTIF_CATALOG.map(definition => {
  const sourceKey = definition.aliases[0] ?? definition.canonicalKey;
  return {
    motif: definition.id,
    source: "LICHESS_TACTICAL_THEME",
    sourceKey,
    trainingUrl: `https://lichess.org/training/${sourceKey}`
  };
});
