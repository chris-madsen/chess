import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import type { ChessRulesPort } from "../application/ports/chess-rules";
import type { LocalStyleEngineProvider, MoveProvider, StylePathProviders } from "../application/ports/providers";
import type { ProviderIdentity } from "../domain/provenance/provenance";
import { createUciMoveProvider, type UciEngineConfig, type UciGoLimit } from "../adapters/uci/uci-engine-adapter";

export type LocalEnginePaths = Readonly<{
  stockfish19Path?: string;
  patriciaPath?: string;
  jackalPath?: string;
  seerPath?: string;
  maia9Path?: string;
  maia9Args?: readonly string[];
  cstalAbsurdPath?: string;
  cstalExtremePath?: string;
  maia3Path?: string;
  maia3Command?: string;
  maia3Args?: readonly string[];
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

const stringArrayAt = (data: Record<string, unknown>, key: string): readonly string[] | undefined => {
  const value = data[key];
  return Array.isArray(value) && value.every(item => typeof item === "string")
    ? value as readonly string[]
    : undefined;
};

export const loadLocalEnginePaths = (configPath = localConfigPath): LocalEnginePaths => {
  const data = readJsonObject(configPath);
  const paths: Record<string, string | readonly string[]> = {};
  ([
    "stockfish19Path",
    "patriciaPath",
    "jackalPath",
    "seerPath",
    "maia9Path",
    "cstalAbsurdPath",
    "cstalExtremePath",
    "maia3Path",
    "maia3Command"
  ] as const).forEach(key => {
    const value = stringAt(data, key);
    if (value !== undefined) {
      paths[key] = value;
    }
  });
  const maia3Args = stringArrayAt(data, "maia3Args");
  if (maia3Args !== undefined) {
    paths.maia3Args = maia3Args;
  }
  const maia9Args = stringArrayAt(data, "maia9Args");
  if (maia9Args !== undefined) {
    paths.maia9Args = maia9Args;
  }
  return paths as LocalEnginePaths;
};

const identity = (name: string, displayName: string, version: string): ProviderIdentity => ({ name, displayName, version });

export type WindowsCstalOpponent = "maia3" | "maia1900";
export type WindowsCstalOptions = Readonly<{
  opponent?: WindowsCstalOpponent;
  maia3Elo?: number;
}>;

const defaultStyleDepth = 13;
const cstalStyleDepth = 14;
const jackalStyleDepth = 8;
const engineMemoryMb = 10_240;
const winnerStyleThreads = Math.min(2, Math.max(1, availableParallelism()));
const cstalThreads = Math.min(2, Math.max(1, availableParallelism()));
const jackalThreads = 1;
const maiaMoveTimeMs = 4_000;
const maiaThreads = Math.min(6, Math.max(1, availableParallelism()));
const cstalOpponentMaiaThreads = Math.min(4, Math.max(1, availableParallelism()));
const maiaLimit: UciGoLimit = { tag: "MoveTime", milliseconds: maiaMoveTimeMs };

const styleEngineTimeoutMs = 300_000;
const maiaTransportTimeoutMs = 300_000;
const maia3TransportTimeoutMs = 120_000;

const commandPath = (command: string): string => (
  /[\\/]/.test(command) || /^[a-zA-Z]:/.test(command) ? resolve(command) : command
);

const styleConfig = (
  key: "patricia" | "jackal" | "seer" | "cstal-absurd" | "cstal-extreme",
  displayName: string,
  command: string,
  version: string,
  styleDepth = defaultStyleDepth,
  timeoutMs = styleEngineTimeoutMs,
  threads = winnerStyleThreads
): UciEngineConfig => ({
  key,
  command: commandPath(command),
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

const policyName = (limit: UciGoLimit): string => {
  switch (limit.tag) {
    case "Depth": return `depth-${limit.depth}`;
    case "MoveTime": return `movetime-${limit.milliseconds}`;
    case "Nodes": return `nodes-${limit.nodes}`;
  }
};

const maiaConfig = (
  command: string,
  args: readonly string[] = [],
  limit: UciGoLimit = maiaLimit,
  threads = maiaThreads
): UciEngineConfig => ({
  key: "maia1900",
  command: commandPath(command),
  args,
  identity: identity("maia", "Maia 1900", "maia-1900.pb.gz via lc0"),
  source: "MAIA",
  options: [
    { name: "Threads", value: threads },
    { name: "TaskWorkers", value: threads },
    { name: "MaxConcurrentSearchers", value: threads },
    { name: "RamLimitMb", value: engineMemoryMb },
    { name: "MinibatchSize", value: 32 },
    { name: "HistoryFill", value: "always" }
  ],
  limit,
  timeoutMs: maiaTransportTimeoutMs,
  configuration: {
    engineKey: "maia1900",
    role: "opponent-human-model",
    policy: policyName(limit),
    threads,
    taskWorkers: threads,
    maxConcurrentSearchers: threads,
    ramLimitMb: engineMemoryMb,
    minibatchSize: 32,
    historyFill: "always"
  }
});

const maia3Command = (paths: LocalEnginePaths): Readonly<{ command: string; args: readonly string[] }> => {
  if (paths.maia3Command !== undefined) {
    return { command: paths.maia3Command, args: paths.maia3Args ?? [] };
  }
  if (paths.maia3Path !== undefined) {
    return {
      command: paths.maia3Path,
      args: paths.maia3Args ?? ["--model", "maia3-79m", "--device", "cpu", "--no-use-amp", "--elo", "1900", "--temperature", "1.0", "--top-p", "1.0", "--use-uci-history"]
    };
  }
  return {
    command: "python",
    args: paths.maia3Args ?? ["-m", "maia3.uci", "--model", "maia3-79m", "--device", "cpu", "--no-use-amp", "--elo", "1900", "--temperature", "1.0", "--top-p", "1.0", "--use-uci-history"]
  };
};

const maia3Config = (paths: LocalEnginePaths, elo = 1900): UciEngineConfig => {
  const command = maia3Command(paths);
  return {
    key: "maia3-79m",
    command: commandPath(command.command),
    args: command.args,
    identity: identity("maia3", "Maia3 79M", "maia3-79m"),
    source: "MAIA",
    options: [
      { name: "Elo", value: elo },
      { name: "SelfElo", value: elo },
      { name: "OppoElo", value: elo },
      { name: "Temperature", value: 1.0 },
      { name: "TopP", value: 1.0 },
      { name: "MultiPV", value: 5 }
    ],
    limit: maiaLimit,
    timeoutMs: maia3TransportTimeoutMs,
    configuration: {
      engineKey: "maia3-79m",
      role: "opponent-human-model",
      policy: policyName(maiaLimit),
      model: "maia3-79m",
      device: command.args.includes("cpu") ? "cpu" : "configured",
      elo,
      selfElo: elo,
      opponentElo: elo,
      temperature: 1.0,
      topP: 1.0,
      multiPv: 5,
      useUciHistory: command.args.includes("--use-uci-history") || command.args.includes("--use_uci_history")
    }
  };
};

const requirePath = (paths: LocalEnginePaths, key: keyof LocalEnginePaths): string => {
  const value = paths[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${key} in engines.local.json`);
  }
  return value;
};

const styleProvider = (
  chess: ChessRulesPort,
  config: UciEngineConfig,
  profile?: Readonly<{ key?: string; label?: string }>
): LocalStyleEngineProvider => ({
  key: profile?.key ?? config.key,
  source: config.source,
  identity: config.identity,
  configuration: config.configuration,
  ...(profile?.label !== undefined ? { label: profile.label } : {}),
  provideMove: createUciMoveProvider(chess, config)
});

export const createLocalStylePathProviders = (
  chess: ChessRulesPort,
  paths = loadLocalEnginePaths()
): StylePathProviders => {
  const engineConfigs = [
    styleConfig("patricia", "Patricia", requirePath(paths, "patriciaPath"), "latest-local", defaultStyleDepth),
    styleConfig("jackal", "Jackal", requirePath(paths, "jackalPath"), "latest-local", jackalStyleDepth, 10_000, jackalThreads),
    styleConfig("seer", "Seer", requirePath(paths, "seerPath"), "local-build", defaultStyleDepth)
  ];
  const styleEngines: readonly LocalStyleEngineProvider[] = engineConfigs.map(config => styleProvider(chess, config));
  const maia: MoveProvider = createUciMoveProvider(chess, maiaConfig(requirePath(paths, "maia9Path"), paths.maia9Args));
  return { maia, styleEngines };
};

export const createWindowsCstalStylePathProviders = (
  chess: ChessRulesPort,
  paths = loadLocalEnginePaths(),
  options: WindowsCstalOptions = {}
): StylePathProviders => {
  const opponent = options.opponent ?? "maia3";
  const maia3Elo = options.maia3Elo ?? 1900;
  const absurdConfig = styleConfig("cstal-absurd", "CSTal ABSURD", requirePath(paths, "cstalAbsurdPath"), "2.07-cst-absurd", cstalStyleDepth, styleEngineTimeoutMs, cstalThreads);
  const extremeConfig = styleConfig("cstal-extreme", "CSTal EXTREME", requirePath(paths, "cstalExtremePath"), "2.07-cst-extreme", cstalStyleDepth, styleEngineTimeoutMs, cstalThreads);
  const maia: MoveProvider = opponent === "maia1900"
    ? createUciMoveProvider(chess, maiaConfig(requirePath(paths, "maia9Path"), paths.maia9Args, maiaLimit, cstalOpponentMaiaThreads))
    : createUciMoveProvider(chess, maia3Config(paths, maia3Elo));
  const opponentLabel = opponent === "maia1900" ? "Maia 1900" : "Maia3 79M";
  const opponentKey = opponent === "maia1900" ? "maia1900" : "maia3";
  const styleEngines: readonly LocalStyleEngineProvider[] = [
    styleProvider(chess, absurdConfig, { key: `cstal-absurd-${opponentKey}`, label: `CSTal ABSURD vs ${opponentLabel} StylePath` }),
    styleProvider(chess, extremeConfig, { key: `cstal-extreme-${opponentKey}`, label: `CSTal EXTREME vs ${opponentLabel} StylePath` })
  ];
  return { maia, styleEngines };
};
