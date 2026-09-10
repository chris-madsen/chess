export type DomainErrorCode =
  | "INVALID_FEN"
  | "INVALID_MOVE_NOTATION"
  | "INVALID_RAW_GAME"
  | "ILLEGAL_MOVE"
  | "MISSING_PROVENANCE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_MALFORMED_OUTPUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ILLEGAL_MOVE"
  | "SOURCE_SEQUENCE_VIOLATION"
  | "EXTERNAL_WRITE_FORBIDDEN"
  | "INVALID_STATE_TRANSITION"
  | "INVALID_HORIZON";

export type DomainError = Readonly<{
  code: DomainErrorCode;
  path: string;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}>;

export const domainError = (
  code: DomainErrorCode,
  path: string,
  message: string,
  details?: Readonly<Record<string, unknown>>
): DomainError => ({ code, path, message, ...(details === undefined ? {} : { details }) });
