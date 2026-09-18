import { appendFileSync, mkdirSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tsxCli = resolve(projectRoot, "node_modules/tsx/dist/cli.mjs");
const logDirectory = resolve(projectRoot, ".local");
const logPath = resolve(logDirectory, "style-server.log");
const port = Number(process.env.STYLE_SERVER_PORT ?? "8787");
const healthUrl = `http://127.0.0.1:${port}/health`;

mkdirSync(logDirectory, { recursive: true });
appendFileSync(logPath, `\n--- StylePath server launch ${new Date().toISOString()} ---\n`, "utf8");
const logHandle = openSync(logPath, "a");
const child = spawn(process.execPath, [tsxCli, "src/server/style-server.ts"], {
  cwd: projectRoot,
  detached: true,
  stdio: ["ignore", logHandle, logHandle],
  windowsHide: true
});
child.unref();

let childExited = false;
child.once("exit", () => {
  childExited = true;
});

const waitForHealth = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (childExited) return false;
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
  process.stdout.write(`StylePath server started in background (PID ${child.pid}) at http://127.0.0.1:${port}\n`);
  process.stdout.write(`Server log: ${logPath}\n`);
  process.exit(0);
}

process.stderr.write(`StylePath server failed to start. Check ${logPath}\n`);
process.exit(1);
