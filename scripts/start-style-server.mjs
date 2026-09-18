import { appendFileSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tsxCli = resolve(projectRoot, "node_modules/tsx/dist/cli.mjs");
const logDirectory = resolve(projectRoot, ".local");
const logPath = resolve(logDirectory, "style-server.log");
const errorLogPath = resolve(logDirectory, "style-server.error.log");
const readyPath = resolve(logDirectory, `style-server-ready-${process.pid}-${Date.now()}.tmp`);
const port = Number(process.env.STYLE_SERVER_PORT ?? "8787");
const healthUrl = `http://127.0.0.1:${port}/health`;

mkdirSync(logDirectory, { recursive: true });
if (existsSync(readyPath)) rmSync(readyPath, { force: true });
appendFileSync(logPath, `\n--- StylePath server launch ${new Date().toISOString()} ---\n`, "utf8");
process.env.STYLE_SERVER_READY_FILE = readyPath;

const quotePowerShell = value => `'${value.replaceAll("'", "''")}'`;
const startServer = () => {
  if (process.platform === "win32") {
    const command = [
      `Start-Process -FilePath ${quotePowerShell(process.execPath)}`,
      `-ArgumentList @(${quotePowerShell(tsxCli)}, ${quotePowerShell("src/server/style-server.ts")})`,
      `-WorkingDirectory ${quotePowerShell(projectRoot)}`,
      `-RedirectStandardOutput ${quotePowerShell(logPath)}`,
      `-RedirectStandardError ${quotePowerShell(errorLogPath)}`,
      "-WindowStyle Hidden"
    ].join(" ");
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { stdio: "ignore" });
    return undefined;
  }
  const logHandle = openSync(logPath, "a");
  const child = spawn(process.execPath, [tsxCli, "src/server/style-server.ts"], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", logHandle, logHandle],
    windowsHide: true
  });
  child.unref();
  return child.pid;
};

const serverPid = startServer();

const waitForHealth = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (process.platform === "win32" && !existsSync(readyPath)) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
      continue;
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return true;
    } catch {
      // The detached server may need another moment to bind its port.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  return false;
};

if (await waitForHealth()) {
  const pidText = serverPid === undefined ? "detached" : `PID ${serverPid}`;
  process.stdout.write(`StylePath server started in background (${pidText}) at http://127.0.0.1:${port}\n`);
  process.stdout.write(`Server log: ${logPath}\n`);
  if (process.platform === "win32") process.stdout.write(`Server errors: ${errorLogPath}\n`);
  rmSync(readyPath, { force: true });
  process.exit(0);
}

rmSync(readyPath, { force: true });
process.stderr.write(`StylePath server failed to start. Check ${logPath}\n`);
process.exit(1);
