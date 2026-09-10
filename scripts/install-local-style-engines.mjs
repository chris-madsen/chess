#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, ".local", "chess-engines");
const binDir = join(base, "bin");
const downloadsDir = join(base, "downloads");
const sourcesDir = join(base, "sources");
const configPath = join(root, "engines.local.json");

const ensureDir = path => mkdirSync(path, { recursive: true });
const run = (cmd, args, options = {}) => {
  console.log([cmd, ...args].join(" "));
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed with exit ${result.status}`);
  }
};
const readJson = path => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const fetchJson = url => JSON.parse(execFileSync("curl", ["-L", "--fail", "--silent", "--show-error", url], { encoding: "utf8" }));
const download = (url, path, expectedBytes = undefined) => {
  if (existsSync(path)) {
    if (expectedBytes === undefined || statSync(path).size === expectedBytes) {
      return;
    }
    console.log(`Existing ${path} has unexpected size ${statSync(path).size}; re-downloading.`);
  }
  const partPath = `${path}.part`;
  if (expectedBytes !== undefined && existsSync(partPath) && statSync(partPath).size > expectedBytes) {
    writeFileSync(partPath, "");
  }
  run("curl", [
    "-L",
    "--fail",
    "--show-error",
    "--retry", "3",
    "--retry-delay", "2",
    "--connect-timeout", "20",
    "--max-time", "1800",
    "-C", "-",
    "-o", partPath,
    url
  ]);
  if (expectedBytes !== undefined && statSync(partPath).size !== expectedBytes) {
    throw new Error(`Downloaded ${path} has size ${statSync(partPath).size}; expected ${expectedBytes}`);
  }
  copyFileSync(partPath, path);
};
const symlinkOrCopy = (source, target) => {
  copyFileSync(source, target);
  chmodSync(target, 0o755);
};
const engineStarts = command => {
  const result = spawnSync(command, [], {
    input: "uci\nquit\n",
    encoding: "utf8",
    timeout: 5000
  });
  return result.status === 0 && String(result.stdout).includes("uciok");
};

ensureDir(binDir);
ensureDir(downloadsDir);
ensureDir(sourcesDir);

const config = readJson(configPath);

const patriciaRelease = fetchJson("https://api.github.com/repos/Adam-Kulju/Patricia/releases/latest");
const patriciaAsset = patriciaRelease.assets.find(asset => asset.name === "patricia_v3") ?? patriciaRelease.assets.find(asset => asset.name === "patricia_v2");
if (patriciaAsset === undefined) {
  throw new Error("No Linux Patricia release asset found");
}
const patriciaDownload = join(downloadsDir, patriciaAsset.name);
download(patriciaAsset.browser_download_url, patriciaDownload);
const patriciaPath = join(binDir, "patricia");
symlinkOrCopy(patriciaDownload, patriciaPath);
config.patriciaPath = patriciaPath;

const jackalRelease = fetchJson("https://api.github.com/repos/TomaszJaworski777/Jackal/releases/latest");
const jackalAsset = jackalRelease.assets.find(asset => asset.name.includes("x86-64-v3") && !asset.name.endsWith(".exe"))
  ?? jackalRelease.assets.find(asset => asset.name.includes("x86-64-v2") && !asset.name.endsWith(".exe"));
if (jackalAsset === undefined) {
  throw new Error("No Linux Jackal release asset found");
}
const jackalDownload = join(downloadsDir, jackalAsset.name);
download(jackalAsset.browser_download_url, jackalDownload);
const jackalPath = join(binDir, "jackal");
symlinkOrCopy(jackalDownload, jackalPath);
if (!engineStarts(jackalPath)) {
  console.log("Downloaded Jackal binary is not compatible with this host; building Jackal from source.");
  const jackalRepo = join(sourcesDir, "Jackal");
  if (!existsSync(jackalRepo)) {
    run("git", ["clone", "--depth", "1", "https://github.com/TomaszJaworski777/Jackal", jackalRepo]);
  } else {
    run("git", ["-C", jackalRepo, "pull", "--ff-only"]);
  }
  const jackalNetworks = [
    ["v5000_8192_s1.network", 673204288],
    ["v5000_8192_f2.network", 673204288],
    ["p8008192009q.network", 57294496],
    ["p8008192009qft3.network", 57294496],
    ["p8008192009qft4.network", 57294496],
    ["p8008192009qft5.network", 57294496]
  ];
  const jackalNetworkDir = join(jackalRepo, "resources", "networks");
  ensureDir(jackalNetworkDir);
  for (const [networkName, expectedBytes] of jackalNetworks) {
    download(
      `https://huggingface.co/datasets/Snekkers/networks/resolve/main/${networkName}`,
      join(jackalNetworkDir, networkName),
      expectedBytes
    );
  }
  run("make", ["-C", jackalRepo]);
  symlinkOrCopy(join(jackalRepo, "jackal"), jackalPath);
}
config.jackalPath = jackalPath;

const seerRepo = join(sourcesDir, "seer-nnue");
if (!existsSync(seerRepo)) {
  run("git", ["clone", "--depth", "1", "https://github.com/connormcmonigle/seer-nnue", seerRepo]);
} else {
  run("git", ["-C", seerRepo, "pull", "--ff-only"]);
}
const seerWeightsDir = join(seerRepo, "build", "weights");
ensureDir(seerWeightsDir);
const seerWeightName = "q0x2291e0ff.bin";
const seerWeightPath = join(seerWeightsDir, seerWeightName);
download("https://github.com/connormcmonigle/seer-training/releases/download/0x2291e0ff/q0x2291e0ff.bin", seerWeightPath);
run("make", ["-C", join(seerRepo, "build"), "binary", "EXE=seer", `EVALFILE=weights/${seerWeightName}`]);
const seerBuilt = join(seerRepo, "build", "seer");
const seerPath = join(binDir, "seer");
symlinkOrCopy(seerBuilt, seerPath);
config.seerPath = seerPath;

if (typeof config.maia9Path !== "string") {
  const maiaCandidate = join(binDir, "maia9");
  if (existsSync(maiaCandidate)) {
    config.maia9Path = maiaCandidate;
  }
}

writeJson(configPath, config);
console.log(`Updated ${configPath}`);
console.log(`Patricia: ${config.patriciaPath}`);
console.log(`Jackal: ${config.jackalPath}`);
console.log(`Seer: ${config.seerPath}`);
