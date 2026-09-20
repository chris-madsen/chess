#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createChessJsRulesAdapter } from "../adapters/chessjs/chess-rules-adapter";
import { fetchRemoteStylePaths, makeRemoteStylePathConfig, type RemoteStylePathConfig } from "../adapters/http/remote-style-path-adapter";
import { isErr } from "../domain/shared/result";
import { makeScenarioHorizon } from "../domain/chess/value-objects";
import { windowsCstalRuntimeConfig } from "../wiring/local-style-engines";

type RootLine = Readonly<{ engineKey: string; moves: readonly string[] }>;

const valueAfter = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};

const positive = (args: readonly string[], flag: string, fallback: number): number => {
  const value = Number(valueAfter(args, flag) ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer`);
  return value;
};

const remoteStyleCliRoots = async (config: RemoteStylePathConfig, rawGame: string, horizonPlies: number, styleDepth: number): Promise<readonly RootLine[]> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const createdResponse = await fetch(`${config.baseUrl}/v1/style-lines/jobs`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ rawGameBase64: Buffer.from(rawGame, "utf8").toString("base64"), engineSuite: "cstal-windows", cstalOpponent: config.cstalOpponent, maia3Elo: config.maia3Elo, refreshMs: 2_000, maxFullMoves: Math.max(1, Math.floor(horizonPlies / 2)), timeoutMs: config.timeoutMs, styleDepth })
    });
    const created = await createdResponse.json() as { jobId?: unknown };
    if (!createdResponse.ok || typeof created.jobId !== "string") throw new Error(`style:lines API create failed (${createdResponse.status})`);
    const eventsResponse = await fetch(`${config.baseUrl}/v1/style-lines/jobs/${encodeURIComponent(created.jobId)}/events`, { signal: controller.signal, headers: { authorization: `Bearer ${config.token}` } });
    if (!eventsResponse.ok) throw new Error(`style:lines API events failed (${eventsResponse.status})`);
    const text = await eventsResponse.text();
    const snapshots = text.split(/\r?\n\r?\n/u)
      .map(frame => frame.split(/\r?\n/u).find(line => line.startsWith("data: "))?.slice(6))
      .filter((value): value is string => value !== undefined)
      .map(value => JSON.parse(value) as { lines?: readonly Readonly<{ engineKey?: unknown; plies?: readonly Readonly<{ uci?: unknown; move?: Readonly<{ uci?: unknown }> }>[] }>[] })
      .filter(snapshot => Array.isArray(snapshot.lines));
    const final = snapshots.at(-1);
    if (final === undefined || !Array.isArray(final.lines)) throw new Error("style:lines API returned no final snapshot");
    const lines = final.lines as readonly Readonly<{ engineKey?: unknown; plies?: readonly Readonly<{ uci?: unknown; move?: Readonly<{ uci?: unknown }> }>[] }>[];
    return lines.flatMap(line => {
      if (typeof line.engineKey !== "string" || !Array.isArray(line.plies)) return [];
      return [{ engineKey: line.engineKey, moves: line.plies.flatMap(ply => typeof ply.uci === "string" ? [ply.uci] : typeof ply.move?.uci === "string" ? [ply.move.uci] : []) }];
    });
  } finally {
    clearTimeout(timer);
  }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const rawFile = valueAfter(args, "--raw-file");
  if (rawFile === undefined || !existsSync(rawFile)) throw new Error("--raw-file must point to an existing PGN/raw SAN file");
  const runs = positive(args, "--runs", 10);
  const maia3Elo = positive(args, "--maia3-elo", 1900);
  const horizonPlies = positive(args, "--horizon-plies", 68);
  const mode = valueAfter(args, "--mode") ?? "parity";
  if (mode !== "parity" && mode !== "repeatability") throw new Error("--mode must be parity or repeatability");
  const requireRoot = mode === "parity" || args.includes("--require-root-parity");
  const requireExact = args.includes("--require-exact-parity");
  const chess = createChessJsRulesAdapter();
  const rawGame = readFileSync(rawFile, "utf8");
  const start = chess.ingestRawGame(rawGame);
  if (isErr(start)) throw new Error(`${start.error.code}: ${start.error.message}`);
  const horizon = makeScenarioHorizon(horizonPlies);
  if (isErr(horizon)) throw new Error(`${horizon.error.code}: ${horizon.error.message}`);
  const config = makeRemoteStylePathConfig({ maia3Elo });
  if (isErr(config)) throw new Error(`${config.error.code}: ${config.error.message}`);
  const runtime = windowsCstalRuntimeConfig();
  process.stdout.write(`${mode === "parity" ? "Canonical baseline parity" : "Canonical baseline repeatability"}\nWindows backend: ${config.value.baseUrl}\nCSTal depth ${runtime.styleDepth}, threads ${runtime.cstalThreads}\nMaia3 Elo ${maia3Elo}\n`);

  let exactMatches = 0;
  let rootMatches = 0;
  for (let run = 1; run <= runs; run += 1) {
    const first = await fetchRemoteStylePaths(chess, start.value, horizon.value, config.value, runtime.styleDepth, rawGame);
    if (isErr(first)) throw new Error(`first run ${run}: ${first.error.code}: ${first.error.message}`);
    const firstRoots = first.value.map(item => ({ engineKey: item.engineKey, moves: item.line.plies.map(ply => String(ply.move.uci)) }));
    let secondRoots: readonly RootLine[];
    if (mode === "parity") {
      secondRoots = await remoteStyleCliRoots(config.value, rawGame, horizonPlies, runtime.styleDepth);
    } else {
      const second = await fetchRemoteStylePaths(chess, start.value, horizon.value, config.value, runtime.styleDepth, rawGame);
      if (isErr(second)) throw new Error(`second run ${run}: ${second.error.code}: ${second.error.message}`);
      secondRoots = second.value.map(item => ({ engineKey: item.engineKey, moves: item.line.plies.map(ply => String(ply.move.uci)) }));
    }
    const secondByKey = new Map(secondRoots.map(item => [item.engineKey, item]));
    let exact = true;
    let root = true;
    for (const baseline of firstRoots) {
      const comparison = secondByKey.get(baseline.engineKey);
      const sameRoot = baseline.moves[0] === comparison?.moves[0];
      const sameLine = sameRoot && baseline.moves.length === comparison?.moves.length && baseline.moves.every((move, index) => move === comparison?.moves[index]);
      root = root && sameRoot;
      exact = exact && sameLine;
      const firstLabel = mode === "parity" ? "pattern-baseline" : "run-1";
      const secondLabel = mode === "parity" ? "style:lines:cstal" : "run-2";
      process.stdout.write(`Run ${run} ${baseline.engineKey}: ${firstLabel} root = ${baseline.moves[0] ?? "none"}, ${secondLabel} root = ${comparison?.moves[0] ?? "none"} ${sameLine ? "MATCH" : sameRoot ? "ROOT MATCH" : "MISMATCH"}\n`);
    }
    if (root) rootMatches += 1;
    if (exact) exactMatches += 1;
  }
  process.stdout.write(`exact line match: ${exactMatches}/${runs}\nroot move match: ${rootMatches}/${runs}\n`);
  if (requireExact ? exactMatches !== runs : requireRoot && rootMatches !== runs) process.exitCode = 1;
};

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
