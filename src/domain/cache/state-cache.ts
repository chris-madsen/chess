import type { PositionSnapshot } from "../chess/position";
import {
  makeHistorySignature,
  makeProviderConfigFingerprint,
  makeZobristPositionKey,
  type HistorySignature,
  type PatternModelVersion,
  type ProviderConfigFingerprint,
  type ZobristPositionKey
} from "../chess/value-objects";

export type RuleContext = Readonly<{
  halfmoveClock: number;
  repetitionSignature?: HistorySignature;
}>;

export type PositionStateKey = Readonly<{
  tag: "PositionStateKey";
  zobrist: ZobristPositionKey;
  ruleContext: RuleContext;
  historySignature?: HistorySignature;
}>;

export type CacheNamespace =
  | "POSITION_EVALUATION"
  | "MAIA_RESPONSE"
  | "PATTERN_ASSESSMENT"
  | "ROLLOUT_SUFFIX";

export type AnalysisCacheKey = Readonly<{
  tag: "AnalysisCacheKey";
  namespace: CacheNamespace;
  position: PositionStateKey;
  configuration: ProviderConfigFingerprint;
  modelVersion?: PatternModelVersion;
}>;

export type CacheEntry = Readonly<{
  tag: "CacheEntry";
  key: AnalysisCacheKey;
  schemaVersion: number;
  createdAtIso: string;
  value: Readonly<Record<string, unknown>>;
}>;

const MASK_64 = (1n << 64n) - 1n;
const SPLITMIX_INCREMENT = 0x9e3779b97f4a7c15n;

const mix64 = (input: bigint): bigint => {
  let value = (input + SPLITMIX_INCREMENT) & MASK_64;
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (value ^ (value >> 31n)) & MASK_64;
};

const tokenKey = (namespace: bigint, token: bigint): bigint => mix64((namespace * 0x100000001b3n + token) & MASK_64);

const squareIndex = (file: number, rank: number): number => rank * 8 + file;

const pieceIndex = (piece: string): number => {
  const pieces = "PNBRQKpnbrqk";
  const index = pieces.indexOf(piece);
  return index < 0 ? 0 : index + 1;
};

const zobristFromFen = (fen: string): ZobristPositionKey => {
  const fields = fen.trim().split(/\s+/);
  const placement = fields[0] ?? "";
  const side = fields[1] ?? "w";
  const castling = fields[2] ?? "-";
  const enPassant = fields[3] ?? "-";
  let key = 0n;
  let rank = 7;
  let file = 0;

  for (const token of placement) {
    if (token === "/") {
      rank -= 1;
      file = 0;
      continue;
    }
    if (/^[1-8]$/.test(token)) {
      file += Number(token);
      continue;
    }
    key ^= tokenKey(1n, BigInt(pieceIndex(token) * 64 + squareIndex(file, rank)));
    file += 1;
  }

  if (side === "b") {
    key ^= tokenKey(2n, 1n);
  }
  for (const right of castling === "-" ? "" : castling) {
    key ^= tokenKey(3n, BigInt("KQkq".indexOf(right) + 1));
  }
  if (enPassant !== "-" && /^[a-h][36]$/.test(enPassant)) {
    const fileIndex = enPassant.charCodeAt(0) - "a".charCodeAt(0);
    key ^= tokenKey(4n, BigInt(fileIndex + 1));
  }

  return makeZobristPositionKey(`z64:${key.toString(16).padStart(16, "0")}`);
};

const fnv1a64 = (value: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = (hash * 0x100000001b3n) & MASK_64;
  }
  return `h64:${hash.toString(16).padStart(16, "0")}`;
};

const historyFromPosition = (position: PositionSnapshot): HistorySignature | undefined => {
  const moves = position.uciPosition.moves.map(String);
  return moves.length === 0 ? undefined : makeHistorySignature(fnv1a64(moves.join(" ")));
};

export const positionStateKey = (position: PositionSnapshot): PositionStateKey => {
  const fields = String(position.fen).trim().split(/\s+/);
  const halfmoveClock = Number.parseInt(fields[4] ?? "0", 10);
  const historySignature = historyFromPosition(position);
  return {
    tag: "PositionStateKey",
    zobrist: zobristFromFen(String(position.fen)),
    ruleContext: {
      halfmoveClock: Number.isInteger(halfmoveClock) && halfmoveClock >= 0 ? halfmoveClock : 0,
      ...(historySignature === undefined ? {} : { repetitionSignature: historySignature })
    },
    ...(historySignature === undefined ? {} : { historySignature })
  };
};

const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(object[key])}`).join(",")}}`;
};

export const providerConfigFingerprint = (configuration: Readonly<Record<string, unknown>>): ProviderConfigFingerprint => (
  makeProviderConfigFingerprint(fnv1a64(stableSerialize(configuration)))
);

export const analysisCacheKey = (input: Readonly<{
  namespace: CacheNamespace;
  position: PositionSnapshot;
  configuration: Readonly<Record<string, unknown>>;
  modelVersion?: PatternModelVersion;
}>): AnalysisCacheKey => ({
  tag: "AnalysisCacheKey",
  namespace: input.namespace,
  position: positionStateKey(input.position),
  configuration: providerConfigFingerprint(input.configuration),
  ...(input.modelVersion === undefined ? {} : { modelVersion: input.modelVersion })
});

export const makeCacheEntry = (input: Readonly<{
  key: AnalysisCacheKey;
  schemaVersion: number;
  createdAtIso: string;
  value: Readonly<Record<string, unknown>>;
}>): CacheEntry => ({
  tag: "CacheEntry",
  key: input.key,
  schemaVersion: input.schemaVersion,
  createdAtIso: input.createdAtIso,
  value: input.value
});

export const cacheKeyString = (key: AnalysisCacheKey): string => stableSerialize(key);
