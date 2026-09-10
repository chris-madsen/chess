import type { PositionHash, RequestId } from "../chess/value-objects";

export type MoveSource =
  | "PLAYER_IDEA"
  | "LEELA_ALIEN_PROBE"
  | "BORIS_TRAPSKY_PROBE"
  | "IMPORTED"
  | "PUZZLE_TARGET"
  | "LOCAL_STYLE_ENGINE"
  | "MAIA"
  | "STOCKFISH";

export type ObservationStatus = "PLAYER_ENTERED" | "OBSERVED_EXTERNAL" | "MODELED_LOCAL" | "ENGINE_GENERATED" | "IMPORTED";

export type ProviderIdentity = Readonly<{
  name: string;
  displayName: string;
  version?: string;
}>;

export type MoveProvenance = Readonly<{
  source: MoveSource;
  provider: ProviderIdentity;
  status: ObservationStatus;
  requestId: RequestId;
  inputPositionHash: PositionHash;
  configuration: Readonly<Record<string, unknown>>;
  observedAtIso?: string;
}>;

export const playerProvider: ProviderIdentity = {
  name: "player",
  displayName: "Player"
};

export const maiaProvider = (version = "fake-maia-contract"): ProviderIdentity => ({
  name: "maia",
  displayName: "Maia",
  version
});

export const stockfishProvider = (version = "fake-stockfish-contract"): ProviderIdentity => ({
  name: "stockfish",
  displayName: "Stockfish 19 NNUE",
  version
});

export const localStyleEngineProvider = (name: string, displayName: string, version?: string): ProviderIdentity => (
  version === undefined
    ? { name, displayName }
    : { name, displayName, version }
);
