#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const configPath = "engines.local.json";
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const engines = [
  ["Patricia", config.patriciaPath, [], "go movetime 200"],
  ["Jackal", config.jackalPath, [], "go movetime 200"],
  ["Seer", config.seerPath, [], "go movetime 200"],
  ["Maia 1900", config.maia9Path, [], "go nodes 1"]
];

const verify = ([name, command, args, go]) => new Promise(resolve => {
  if (typeof command !== "string" || !existsSync(command)) {
    resolve({ name, ok: false, reason: "missing path" });
    return;
  }

  const child = spawn(command, args, { stdio: "pipe" });
  const rl = createInterface({ input: child.stdout });
  let stage = "uci";
  let settled = false;

  const safeWrite = line => {
    if (settled || child.stdin.destroyed || !child.stdin.writable) {
      return;
    }
    try {
      child.stdin.write(`${line}\n`);
    } catch {
      // The process may exit quickly after producing a result. Finalization owns the outcome.
    }
  };

  const finish = result => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    rl.close();
    if (!child.killed) {
      safeWrite("quit");
      child.kill("SIGTERM");
    }
    resolve(result);
  };

  const timer = setTimeout(() => finish({ name, ok: false, reason: "timeout" }), 15000);

  child.stdin.on("error", () => undefined);
  child.once("error", error => finish({ name, ok: false, reason: error.message }));
  child.once("exit", () => {
    if (!settled) {
      finish({ name, ok: false, reason: "engine exited before bestmove" });
    }
  });

  rl.on("line", line => {
    if (stage === "uci" && line.trim() === "uciok") {
      stage = "ready";
      safeWrite("isready");
      return;
    }
    if (stage === "ready" && line.trim() === "readyok") {
      stage = "bestmove";
      safeWrite("ucinewgame");
      safeWrite(`position fen ${fen}`);
      safeWrite(go);
      return;
    }
    if (stage === "bestmove" && line.startsWith("bestmove ")) {
      const bestmove = line.trim().split(/\s+/)[1];
      finish({ name, ok: bestmove !== undefined && bestmove !== "(none)", reason: bestmove ?? "missing bestmove" });
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
