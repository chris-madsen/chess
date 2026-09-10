import type { LegalMove } from "../../domain/chess/moves";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { Fen, PositionHash } from "../../domain/chess/value-objects";
import type { PositionFacts } from "../../domain/position-intelligence/facts";
import type { DomainError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";

export type ChessRulesPort = Readonly<{
  ingestPosition: (rawFen: string) => Result<PositionSnapshot, DomainError>;
  ingestRawGame: (rawGame: string) => Result<PositionSnapshot, DomainError>;
  parseLegalMove: (position: PositionSnapshot, rawMove: string) => Result<LegalMove, DomainError>;
  applyMove: (position: PositionSnapshot, move: LegalMove) => Result<PositionSnapshot, DomainError>;
  computeFacts: (position: PositionSnapshot) => Result<PositionFacts, DomainError>;
  hashFen: (fen: Fen) => PositionHash;
}>;
