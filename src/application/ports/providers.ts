import type { LegalMove } from "../../domain/chess/moves";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { MoveProvenance, MoveSource, ProviderIdentity } from "../../domain/provenance/provenance";
import type { DomainError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";

export type ProvidedMove = Readonly<{
  move: LegalMove;
  provenance: MoveProvenance;
}>;

export type ProviderSearchLimit =
  | Readonly<{ tag: "Depth"; depth: number }>
  | Readonly<{ tag: "MoveTime"; milliseconds: number }>
  | Readonly<{ tag: "Nodes"; nodes: number }>;

export type ProviderRequest = Readonly<{
  position: PositionSnapshot;
  lineId: string;
  ply: number;
  searchLimit?: ProviderSearchLimit;
}>;

export type ProviderProfile = Readonly<{
  key: string;
  source: MoveSource;
  identity: ProviderIdentity;
  configuration: Readonly<Record<string, unknown>>;
}>;

export type MoveProvider = ((request: ProviderRequest) => Promise<Result<ProvidedMove, DomainError>>) & Readonly<{
  dispose?: () => void;
}>;

export type HumanPathProviders = Readonly<{
  maia: MoveProvider;
  stockfish: MoveProvider;
}>;

export type LocalStyleEngineProvider = ProviderProfile & Readonly<{
  provideMove: MoveProvider;
  opponent?: MoveProvider;
  label?: string;
}>;

export type StylePathProviders = Readonly<{
  maia: MoveProvider;
  styleEngines: readonly LocalStyleEngineProvider[];
}>;
