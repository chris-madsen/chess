#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const configPath = "engines.local.json";
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};

const maia3Command = () => {
  if (typeof config.maia3Command === "string") {
    return {
      command: config.maia3Command,
      args: Array.isArray(config.maia3Args) ? config.maia3Args : []
    };
  }
  if (typeof config.maia3Path === "string") {
    return {
      command: config.maia3Path,
      args: Array.isArray(config.maia3Args)
        ? config.maia3Args
        : ["--model", "maia3-79m", "--device", "cpu", "--no-use-amp"]
    };
  }
  return {
    command: "python",
    args: ["-m", "maia3.uci", "--model", "maia3-79m", "--device", "cpu", "--no-use-amp"]
  };
};

const maia9Command = () => {
  if (typeof config.maia9Path === "string") {
    return {
      command: config.maia9Path,
      args: Array.isArray(config.maia9Args) ? config.maia9Args : []
    };
  }
  return {
    command: undefined,
    args: []
  };
};

const engines = [
  ["CSTal ABSURD", config.cstalAbsurdPath, [], [], "go depth 1"],
  ["CSTal EXTREME", config.cstalExtremePath, [], [], "go depth 1"],
  ["Maia3 79M", maia3Command().command, maia3Command().args, [
    ["Elo", 1900],
    ["SelfElo", 1900],
    ["OppoElo", 1900],
    ["Temperature", 1.0],
    ["TopP", 1.0],
    ["MultiPV", 5]
  ], "go movetime 4000"],
  ["Maia 1900", maia9Command().command, maia9Command().args, [
    ["Threads", 6],
    ["TaskWorkers", 6],
    ["MaxConcurrentSearchers", 6],
    ["RamLimitMb", 10240],
    ["MinibatchSize", 32],
    ["HistoryFill", "always"]
  ], "go movetime 4000"]
];

const verify = ([name, command, args, options, go]) => new Promise(resolve => {
  if (typeof command !== "string" || (/[\\/]/.test(command) && !existsSync(command))) {
    resolve({ name, ok: false, reason: "missing command" });
    return;
  }

  const child = spawn(command, args, { stdio: "pipe" });
  let stage = "uci";
  let output = "";
  let settled = false;

  const safeWrite = line => {
    if (settled || child.stdin.destroyed || !child.stdin.writable) {
      return;
    }
    try {
      child.stdin.write(`${line}\n`);
    } catch {
      // Finalization owns the outcome.
    }
  };

  const finish = result => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    if (!child.killed) {
      safeWrite("quit");
      child.kill("SIGTERM");
    }
    resolve(result);
  };

  const timer = setTimeout(() => finish({ name, ok: false, reason: `timeout; output: ${output.slice(-1000)}` }), 120_000);

  child.stdout.on("data", chunk => {
    output += chunk.toString();
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (stage === "uci" && line.trim() === "uciok") {
        stage = "ready";
        for (const [optionName, optionValue] of options) {
          safeWrite(`setoption name ${optionName} value ${optionValue}`);
        }
        safeWrite("isready");
        continue;
      }
      if (stage === "ready" && line.trim() === "readyok") {
        stage = "bestmove";
        safeWrite("ucinewgame");
        safeWrite(`position fen ${fen}`);
        safeWrite(go);
        continue;
      }
      if (stage === "bestmove" && line.startsWith("bestmove ")) {
        const bestmove = line.trim().split(/\s+/)[1];
        finish({ name, ok: bestmove !== undefined && bestmove !== "(none)", reason: bestmove ?? "missing bestmove" });
      }
    }
  });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  child.stdin.on("error", () => undefined);
  child.once("error", error => finish({ name, ok: false, reason: error.message }));
  child.once("exit", code => {
    if (!settled) {
      finish({ name, ok: false, reason: `engine exited before bestmove (${code}); output: ${output.slice(-1000)}` });
    }
  });

  safeWrite("uci");
});

const results = await Promise.all(engines.map(verify));
for (const result of results) {
  console.log(`${result.ok ? "ok" : "fail"}: ${result.name} ${result.reason}`);
}
if (results.some(result => !result.ok)) {
  process.exit(1);
}
