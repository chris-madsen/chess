import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const readUntil = (child, predicate, timeoutMs, label) => new Promise((resolve, reject) => {
  let output = "";
  const timer = setTimeout(() => {
    reject(new Error(`${label} timed out. Output:\n${output}`));
  }, timeoutMs);
  const onData = chunk => {
    output += chunk.toString();
    if (predicate(output)) {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      resolve(output);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
});

const runUciSmoke = async ({ name, command, goCommand, expected }) => {
  if (!existsSync(command)) {
    throw new Error(`${name} command not found: ${command}`);
  }

  const child = spawn(command, [], { stdio: ["pipe", "pipe", "pipe"] });
  let allOutput = "";
  child.stdout.on("data", chunk => { allOutput += chunk.toString(); });
  child.stderr.on("data", chunk => { allOutput += chunk.toString(); });

  child.stdin.write("uci\n");
  await readUntil(child, output => output.includes("uciok"), 20_000, `${name} uci`);
  child.stdin.write("isready\n");
  await readUntil(child, output => output.includes("readyok"), 20_000, `${name} isready`);
  child.stdin.write("position startpos\n");
  child.stdin.write(`${goCommand}\n`);
  await readUntil(child, output => output.includes("bestmove"), 20_000, `${name} bestmove`);
  child.stdin.end("quit\n");

  const code = await new Promise(resolve => child.on("close", resolve));
  const missing = expected.filter(token => !allOutput.includes(token));
  if (code !== 0 || missing.length > 0) {
    throw new Error(`${name} failed with code ${code}; missing ${missing.join(", ")}\n${allOutput}`);
  }
  console.log(`${name}: ok`);
};

await runUciSmoke({
  name: "Stockfish 19",
  command: ".local/chess-engines/bin/stockfish19",
  goCommand: "go depth 1",
  expected: ["id name Stockfish 19", "uciok", "readyok", "bestmove"]
});

await runUciSmoke({
  name: "Maia-9 via Lc0",
  command: ".local/chess-engines/bin/maia9",
  goCommand: "go movetime 4000",
  expected: ["id name Lc0", "maia-1900.pb.gz", "uciok", "readyok", "bestmove"]
});
