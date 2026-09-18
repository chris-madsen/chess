#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { Chess } from "chess.js";

const dumpUrl = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const sourceLicense = "CC-BY-SA-4.0";
const sourceReference = "https://database.lichess.org/#puzzles";
const themeFamilies = new Map([
  ["anastasiaMate", "ANASTASIA"], ["arabianMate", "ARABIAN"], ["backRankMate", "BACK_RANK"],
  ["balestraMate", "BALESTRA"], ["blindSwineMate", "BLIND_SWINE"], ["bodenMate", "BODEN"],
  ["cornerMate", "CORNER"], ["doubleBishopMate", "DOUBLE_BISHOP"], ["dovetailMate", "DOVETAIL"],
  ["epauletteMate", "EPAULETTE"], ["hookMate", "HOOK"], ["killBoxMate", "KILL_BOX"],
  ["pillsburysMate", "PILLSBURY"], ["morphysMate", "MORPHYS"], ["operaMate", "OPERA"],
  ["smotheredMate", "SMOTHERED"], ["swallowstailMate", "SWALLOWTAIL"], ["triangleMate", "TRIANGLE"],
  ["vukovicMate", "VUKOVIC"]
]);

const args = process.argv.slice(2);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const outputPath = valueAfter("--out") ?? "datasets/pattern-mvp-lichess.jsonl";
const targetPerFamily = Number(valueAfter("--per-family") ?? "16");
const controlCount = Number(valueAfter("--controls") ?? "16");
const datasetVersion = valueAfter("--dataset-version") ?? "lichess-puzzle-mvp-2026-09";
if (!Number.isInteger(targetPerFamily) || targetPerFamily <= 0 || !Number.isInteger(controlCount) || controlCount < 0) {
  throw new Error("--per-family must be positive and --controls must be non-negative integers");
}

const csvFields = line => {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
};

const hashFen = fen => createHash("sha256").update(fen).digest("hex");
const validFen = fen => {
  if (typeof fen !== "string" || fen.length === 0) return false;
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
};
const counts = new Map([...themeFamilies.values()].map(family => [family, 0]));
const selected = [];
const usedFens = new Set();
const controls = [];
const required = targetPerFamily * themeFamilies.size + controlCount;

const ensureDump = async dumpPath => {
  if (existsSync(dumpPath)) return;
  mkdirSync(".local/datasets", { recursive: true });
  await new Promise((resolve, reject) => {
    const curl = spawn("curl", ["-L", "--fail", "--silent", "--show-error", "--output", dumpPath, dumpUrl], { stdio: "inherit" });
    curl.once("error", reject);
    curl.once("exit", code => code === 0 ? resolve() : reject(new Error(`curl exited with ${code}`)));
  });
};

const main = async () => {
  const dumpPath = ".local/datasets/lichess_db_puzzle.csv.zst";
  await ensureDump(dumpPath);
  const decompressor = spawn("zstd", ["--decompress", "--stdout", "--quiet", dumpPath], { stdio: ["ignore", "pipe", "inherit"] });
  const lines = createInterface({ input: decompressor.stdout });
  let header;
  for await (const line of lines) {
    if (header === undefined) {
      header = csvFields(line).map(field => field.replace(/^\uFEFF/u, "").trim());
      continue;
    }
    const fields = csvFields(line);
    const row = Object.fromEntries(header.map((name, index) => [name, fields[index] ?? ""]));
    const fen = row.FEN;
    const themes = new Set((row.Themes ?? "").split(" ").filter(Boolean));
    if (!validFen(fen) || usedFens.has(fen)) continue;
    const matchingFamily = [...themeFamilies.entries()].find(([theme, family]) => themes.has(theme) && (counts.get(family) ?? 0) < targetPerFamily);
    if (matchingFamily !== undefined) {
      const [theme, family] = matchingFamily;
      selected.push({
        caseId: `${family.toLowerCase()}-${row.PuzzleId}`,
        datasetVersion,
        split: (counts.get(family) ?? 0) < Math.ceil(targetPerFamily / 2) ? "calibration" : "evaluation",
        exampleKind: "positive",
        fen,
        family,
        sourcePositionHash: hashFen(fen),
        source: { kind: "lichess-puzzle-database", reference: `${sourceReference}#${row.PuzzleId}`, license: sourceLicense },
        expected: { terminalMate: true },
        sourceTheme: theme,
        solutionMoves: row.Moves,
        rating: Number(row.Rating),
        gameUrl: row.GameUrl
      });
      counts.set(family, (counts.get(family) ?? 0) + 1);
      usedFens.add(fen);
      continue;
    }
    if (controls.length < controlCount && ![...themeFamilies.keys()].some(theme => themes.has(theme))) {
      controls.push({
        caseId: `control-${row.PuzzleId}`,
        datasetVersion,
        split: controls.length < Math.ceil(controlCount / 2) ? "calibration" : "evaluation",
        exampleKind: "control",
        fen,
        family: "ANASTASIA",
        sourcePositionHash: hashFen(fen),
        source: { kind: "lichess-puzzle-database-control", reference: `${sourceReference}#${row.PuzzleId}`, license: sourceLicense },
        sourceTheme: "control",
        solutionMoves: row.Moves,
        rating: Number(row.Rating),
        gameUrl: row.GameUrl
      });
      usedFens.add(fen);
    }
    if (selected.length + controls.length >= required && [...counts.values()].every(count => count >= targetPerFamily)) break;
  }
  decompressor.kill();
  const missing = [...counts.entries()].filter(([, count]) => count < targetPerFamily);
  if (missing.length > 0 || controls.length < controlCount) {
    throw new Error(`insufficient corpus: missing ${JSON.stringify(missing)}; controls=${controls.length}/${controlCount}`);
  }
  mkdirSync("datasets", { recursive: true });
  const output = [...selected, ...controls].map(entry => JSON.stringify(entry)).join("\n") + "\n";
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(outputPath);
    stream.once("error", reject);
    stream.once("finish", resolve);
    stream.end(output);
  });
  console.log(JSON.stringify({ outputPath, datasetVersion, cases: selected.length + controls.length, perFamily: Object.fromEntries(counts), controls: controls.length, license: sourceLicense }));
};

await main();
