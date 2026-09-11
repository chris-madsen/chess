import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import type { ChessRulesPort } from "../application/ports/chess-rules";
import type { LocalStyleEngineProvider, MoveProvider, StylePathProviders } from "../application/ports/providers";
import type { ProviderIdentity } from "../domain/provenance/provenance";
import { createUciMoveProvider, type UciEngineConfig, type UciGoLimit } from "../adapters/uci/uci-engine-adapter";

export type LocalEnginePaths = Readonly<{
  patriciaPath?: string;
  jackalPath?: string;
  seerPath?: string;
  maia9Path?: string;
}>;

const localConfigPath = "engines.local.json";

const readJsonObject = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) {
    return {};
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
};

const stringAt = (data: Record<string, unknown>, key: string): string | undefined => (
  typeof data[key] === "string" ? data[key] : undefined
);

export const loadLocalEnginePaths = (configPath = localConfigPath): LocalEnginePaths => {
  const data = readJsonObject(configPath);
  const paths: Record<string, string> = {};
  (["patriciaPath", "jackalPath", "seerPath", "maia9Path"] as const).forEach(key => {
    const value = stringAt(data, key);
    if (value !== undefined) {
      paths[key] = value;
    }
  });
  return paths;
};

const identity = (name: string, displayName: string, version: string): ProviderIdentity => ({ name, displayName, version });

const defaultStyleDepth = 13;
const jackalStyleDepth = 8;
const engineMemoryMb = 10_240;
const winnerStyleThreads = Math.min(2, Math.max(1, availableParallelism()));
const jackalThreads = 1;
const maiaMoveTimeMs = 3_000;
const maiaThreads = Math.min(6, Math.max(1, availableParallelism()));
const maiaLimit: UciGoLimit = { tag: "MoveTime", milliseconds: maiaMoveTimeMs };

const styleEngineTimeoutMs = 300_000;
const maiaTransportTimeoutMs = 30_000;

const styleConfig = (
  key: "patricia" | "jackal" | "seer",
  displayName: string,
  command: string,
  version: string,
  styleDepth = defaultStyleDepth,
  timeoutMs = styleEngineTimeoutMs,
  threads = winnerStyleThreads
): UciEngineConfig => ({
  key,
  command: resolve(command),
  identity: identity(key, displayName, version),
  source: "LOCAL_STYLE_ENGINE",
  options: [
    { name: "Threads", value: threads },
    { name: "Hash", value: engineMemoryMb }
  ],
  limit: { tag: "Depth", depth: styleDepth },
  timeoutMs,
  configuration: {
    engineKey: key,
    role: "player-style",
    protocol: "uci",
    styleDepth,
    threads,
    hashMb: engineMemoryMb
  },
  ...(key === "jackal" ? { allowInfoPvBestMoveFallback: true } : {})
});

const maiaConfig = (command: string): UciEngineConfig => ({
  key: "maia1900",
  command: resolve(command),
  identity: identity("maia", "Maia 1900", "maia-1900.pb.gz via lc0"),
  source: "MAIA",
  options: [
    { name: "Threads", value: maiaThreads },
    { name: "TaskWorkers", value: maiaThreads },
    { name: "MaxConcurrentSearchers", value: maiaThreads },
    { name: "RamLimitMb", value: engineMemoryMb },
    { name: "MinibatchSize", value: 32 }
  ],
  limit: maiaLimit,
  timeoutMs: maiaTransportTimeoutMs,
  configuration: {
    engineKey: "maia1900",
    role: "opponent-human-model",
    policy: "movetime-3000",
    threads: maiaThreads,
    taskWorkers: maiaThreads,
    maxConcurrentSearchers: maiaThreads,
    ramLimitMb: engineMemoryMb,
    minibatchSize: 32
  }
});

const requirePath = (paths: LocalEnginePaths, key: keyof LocalEnginePaths): string => {
  const value = paths[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${key} in engines.local.json`);
  }
  return value;
};

export const createLocalStylePathProviders = (
  chess: ChessRulesPort,
  paths = loadLocalEnginePaths()
): StylePathProviders => {
  const engineConfigs = [
    styleConfig("patricia", "Patricia", requirePath(paths, "patriciaPath"), "latest-local", defaultStyleDepth),
    styleConfig("jackal", "Jackal", requirePath(paths, "jackalPath"), "latest-local", jackalStyleDepth, 10_000, jackalThreads),
    styleConfig("seer", "Seer", requirePath(paths, "seerPath"), "local-build", defaultStyleDepth)
  ];
  const styleEngines: readonly LocalStyleEngineProvider[] = engineConfigs.map(config => ({
    key: config.key,
    source: config.source,
    identity: config.identity,
    configuration: config.configuration,
    provideMove: createUciMoveProvider(chess, config)
  }));
  const maia: MoveProvider = createUciMoveProvider(chess, maiaConfig(requirePath(paths, "maia9Path")));
  return { maia, styleEngines };
};
