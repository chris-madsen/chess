export type TacticalMotifId =
  | "ATTRACTION"
  | "CLEARANCE"
  | "DEFLECTION"
  | "DISCOVERED_ATTACK"
  | "DISCOVERED_CHECK"
  | "DOUBLE_CHECK"
  | "INTERFERENCE"
  | "PIN"
  | "SACRIFICE"
  | "SKEWER"
  | "X_RAY_ATTACK"
  | "CAPTURING_DEFENDER"
  | "EXPOSED_KING"
  | "KINGSIDE_ATTACK"
  | "ATTACKING_F2_F7";

export type TacticalMotifDefinition = Readonly<{
  id: TacticalMotifId;
  canonicalKey: string;
  displayName: string;
  aliases: readonly string[];
  tier: "MVP_TACTICAL_CORE";
}>;

const motifSeeds = [
  ["ATTRACTION", "attraction", "Attraction", "attraction"],
  ["CLEARANCE", "clearance", "Clearance", "clearance"],
  ["DEFLECTION", "deflection", "Deflection", "deflection"],
  ["DISCOVERED_ATTACK", "discovered_attack", "Discovered Attack", "discoveredAttack"],
  ["DISCOVERED_CHECK", "discovered_check", "Discovered Check", "discoveredCheck"],
  ["DOUBLE_CHECK", "double_check", "Double Check", "doubleCheck"],
  ["INTERFERENCE", "interference", "Interference", "interference"],
  ["PIN", "pin", "Pin", "pin"],
  ["SACRIFICE", "sacrifice", "Sacrifice", "sacrifice"],
  ["SKEWER", "skewer", "Skewer", "skewer"],
  ["X_RAY_ATTACK", "x_ray_attack", "X-Ray Attack", "xRayAttack"],
  ["CAPTURING_DEFENDER", "capturing_defender", "Capturing Defender", "capturingDefender"],
  ["EXPOSED_KING", "exposed_king", "Exposed King", "exposedKing"],
  ["KINGSIDE_ATTACK", "kingside_attack", "Kingside Attack", "kingsideAttack"],
  ["ATTACKING_F2_F7", "attacking_f2_f7", "Attacking f2/f7", "attackingF2F7"]
] as const;

export const TACTICAL_MOTIF_CATALOG: readonly TacticalMotifDefinition[] = motifSeeds.map(([id, canonicalKey, displayName, sourceKey]) => ({
  id: id as TacticalMotifId,
  canonicalKey,
  displayName,
  aliases: [sourceKey, canonicalKey, displayName],
  tier: "MVP_TACTICAL_CORE" as const
}));

export const TACTICAL_MOTIF_IDS: readonly TacticalMotifId[] = TACTICAL_MOTIF_CATALOG.map(definition => definition.id);

export const isTacticalMotifId = (value: string): value is TacticalMotifId => TACTICAL_MOTIF_IDS.includes(value as TacticalMotifId);
