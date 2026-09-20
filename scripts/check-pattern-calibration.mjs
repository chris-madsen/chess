#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const temp = mkdtempSync(join(tmpdir(), "chess-pattern-calibration-"));
try {
  const json = join(temp, "pattern-calibration.json");
  const generated = join(temp, "pattern-calibration.generated.ts");
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/pattern-calibrate.ts", "datasets/pattern-mvp-lichess.jsonl", json, generated], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "pattern calibration failed");
  const checkedJson = readFileSync("src/domain/patterns/pattern-calibration.json", "utf8");
  const checkedGenerated = readFileSync("src/domain/patterns/pattern-calibration.generated.ts", "utf8");
  if (readFileSync(json, "utf8") !== checkedJson) throw new Error("src/domain/patterns/pattern-calibration.json is stale; run npm run pattern:calibrate");
  if (readFileSync(generated, "utf8") !== checkedGenerated) throw new Error("src/domain/patterns/pattern-calibration.generated.ts is stale; run npm run pattern:calibrate");
  process.stdout.write("pattern calibration artifacts are fresh\n");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
