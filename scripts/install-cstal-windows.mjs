#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, ".local", "chess-engines");
const binDir = join(base, "bin");
const downloadsDir = join(base, "downloads");
const cstalUnpackDir = join(base, "cstal");
const lc0UnpackDir = join(base, "lc0");
const maiaDir = join(base, "maia");
const configPath = join(root, "engines.local.json");
const repo = "ChrisWhittington/Chess-System-Tal-NNUE-2";
const lc0Repo = "LeelaChessZero/lc0";
const maiaRepo = "CSSLab/maia-chess";
const maiaWeightsName = "maia-1900.pb.gz";
const assets = [
  {
    label: "CSTal ABSURD",
    configKey: "cstalAbsurdPath",
    assetName: "CSTal-2.07-cst-absurd-AVX2.zip",
    binName: "cstal-absurd.exe"
  },
  {
    label: "CSTal EXTREME",
    configKey: "cstalExtremePath",
    assetName: "CSTal-2.07-cst-extreme-AVX2.zip",
    binName: "cstal-extreme.exe"
  }
];

const ensureDir = path => mkdirSync(path, { recursive: true });
const readJson = path => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const fetchJson = url => JSON.parse(execFileSync("curl", ["-L", "--fail", "--silent", "--show-error", url], { encoding: "utf8" }));
const run = (cmd, args) => {
  console.log([cmd, ...args].join(" "));
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed with exit ${result.status}`);
  }
};

const engineStarts = (command, args = []) => {
  const result = spawnSync(command, args, {
    input: "uci\nquit\n",
    encoding: "utf8",
    timeout: 10_000
  });
  return result.status === 0 && String(result.stdout).includes("uciok");
};

const findExe = dir => {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findExe(full);
      if (nested !== undefined) {
        return nested;
      }
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".exe")) {
      return full;
    }
  }
  return undefined;
};

const findFile = (dir, fileName) => {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(full, fileName);
      if (nested !== undefined) {
        return nested;
      }
    }
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return full;
    }
  }
  return undefined;
};

ensureDir(binDir);
ensureDir(downloadsDir);
ensureDir(cstalUnpackDir);
ensureDir(lc0UnpackDir);
ensureDir(maiaDir);

const release = fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
const config = readJson(configPath);

for (const wanted of assets) {
  const asset = release.assets.find(item => item.name === wanted.assetName);
  if (asset === undefined) {
    throw new Error(`Release ${release.tag_name} does not contain ${wanted.assetName}`);
  }

  const zipPath = join(downloadsDir, asset.name);
  if (!existsSync(zipPath)) {
    run("curl", ["-L", "--fail", "--show-error", "-o", zipPath, asset.browser_download_url]);
  }

  const targetUnpackDir = join(cstalUnpackDir, basename(asset.name, ".zip"));
  if (existsSync(targetUnpackDir)) {
    rmSync(targetUnpackDir, { recursive: true, force: true });
  }
  ensureDir(targetUnpackDir);
  run("tar", ["-xf", zipPath, "-C", targetUnpackDir]);

  const sourceExe = findExe(targetUnpackDir);
  if (sourceExe === undefined) {
    throw new Error(`${wanted.assetName} did not contain an .exe`);
  }

  const targetExe = join(binDir, wanted.binName);
  if (!existsSync(targetExe) || !engineStarts(targetExe)) {
    copyFileSync(sourceExe, targetExe);
  }
  if (!engineStarts(targetExe)) {
    throw new Error(`${wanted.label} AVX2 executable did not start: ${targetExe}. Try the scalar CSTal build.`);
  }

  config[wanted.configKey] = targetExe;
  console.log(`${wanted.label}: ${targetExe}`);
}

const lc0Release = fetchJson(`https://api.github.com/repos/${lc0Repo}/releases/latest`);
const lc0Asset = lc0Release.assets.find(item => /windows-cpu-dnnl\.zip$/i.test(item.name));
if (lc0Asset === undefined) {
  throw new Error(`Release ${lc0Release.tag_name} does not contain a Windows CPU DNNL zip`);
}
const lc0ZipPath = join(downloadsDir, lc0Asset.name);
if (!existsSync(lc0ZipPath)) {
  run("curl", ["-L", "--fail", "--show-error", "-o", lc0ZipPath, lc0Asset.browser_download_url]);
}
const lc0TargetUnpackDir = join(lc0UnpackDir, basename(lc0Asset.name, ".zip"));
if (existsSync(lc0TargetUnpackDir)) {
  rmSync(lc0TargetUnpackDir, { recursive: true, force: true });
}
ensureDir(lc0TargetUnpackDir);
run("tar", ["-xf", lc0ZipPath, "-C", lc0TargetUnpackDir]);
const lc0Exe = findFile(lc0TargetUnpackDir, "lc0.exe");
if (lc0Exe === undefined) {
  throw new Error(`${lc0Asset.name} did not contain lc0.exe`);
}

const maiaRelease = fetchJson(`https://api.github.com/repos/${maiaRepo}/releases/latest`);
const maiaAsset = maiaRelease.assets.find(item => item.name === maiaWeightsName);
if (maiaAsset === undefined) {
  throw new Error(`Release ${maiaRelease.tag_name} does not contain ${maiaWeightsName}`);
}
const maiaWeightsPath = join(maiaDir, maiaWeightsName);
if (!existsSync(maiaWeightsPath)) {
  run("curl", ["-L", "--fail", "--show-error", "-o", maiaWeightsPath, maiaAsset.browser_download_url]);
}

const maia9Args = [`--weights=${maiaWeightsPath}`, "--backend=blas"];
if (!engineStarts(lc0Exe, maia9Args)) {
  throw new Error(`Maia 1900 via Lc0 did not start: ${lc0Exe}`);
}
config.maia9Path = lc0Exe;
config.maia9Args = maia9Args;
console.log(`Maia 1900: ${lc0Exe} ${maia9Args.join(" ")}`);

if (typeof config.maia3Command !== "string" && typeof config.maia3Path !== "string") {
  config.maia3Command = "python";
  config.maia3Args = ["-m", "maia3.uci", "--model", "maia3-79m", "--device", "cpu", "--no-use-amp", "--elo", "1900", "--temperature", "1.0", "--top-p", "1.0", "--use-uci-history"];
}

writeJson(configPath, config);
console.log(`Updated ${configPath}`);
