import type { AnalysisCachePort } from "../../application/ports/analysis-cache";
import { cacheKeyString, type AnalysisCacheKey, type CacheEntry } from "../../domain/cache/state-cache";
import { ok, type Result } from "../../domain/shared/result";

export const createInMemoryAnalysisCache = (maxEntries = 512): AnalysisCachePort => {
  const entries = new Map<string, CacheEntry>();

  const get = async (key: AnalysisCacheKey): Promise<Result<CacheEntry | undefined, never>> => {
    const cacheKey = cacheKeyString(key);
    const entry = entries.get(cacheKey);
    if (entry === undefined) {
      return ok(undefined);
    }
    entries.delete(cacheKey);
    entries.set(cacheKey, entry);
    return ok(entry);
  };

  const put = async (entry: CacheEntry): Promise<Result<void, never>> => {
    const cacheKey = cacheKeyString(entry.key);
    entries.delete(cacheKey);
    entries.set(cacheKey, entry);
    while (entries.size > Math.max(1, maxEntries)) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      entries.delete(oldest);
    }
    return ok(undefined);
  };

  return { get, put };
};
