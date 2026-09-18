import type { AnalysisCacheKey, CacheEntry } from "../../domain/cache/state-cache";
import type { DomainError } from "../../domain/shared/errors";
import type { Result } from "../../domain/shared/result";

export type AnalysisCachePort = Readonly<{
  get: (key: AnalysisCacheKey) => Promise<Result<CacheEntry | undefined, DomainError>>;
  put: (entry: CacheEntry) => Promise<Result<void, DomainError>>;
}>;
