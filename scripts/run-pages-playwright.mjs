import { spawn } from "node:child_process";
import { join } from "node:path";
import { preview } from "vite";

const port = Number(process.env.GITHUB_PAGES_TEST_PORT ?? 4175);
const base = "/wo-neng-da-zhi-ye/";
const server = await preview({
  base,
  preview: {
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
});

let child;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  if (child && child.exitCode == null) child.kill("SIGTERM");
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => error ? reject(error) : resolve());
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  const cli = join(process.cwd(), "node_modules", "@playwright", "test", "cli.js");
  child = spawn(process.execPath, [cli, "test", "--config=playwright.pages.config.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, GITHUB_PAGES_TEST_PORT: String(port) },
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  await shutdown();
}
