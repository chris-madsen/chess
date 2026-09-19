import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2] ?? "datasets/pattern-mvp-lichess.jsonl";
const lines = readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean).map(line => {
  const entry = JSON.parse(line);
  const actualStart = entry.trajectory?.find(state => state.ply === 1);
  if (actualStart !== undefined) {
    entry.trajectoryStartPly = 1;
    entry.attackerSide = actualStart.fen.split(/\s+/u)[1] === "w" ? "white" : "black";
  }
  return JSON.stringify(entry);
});
writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
