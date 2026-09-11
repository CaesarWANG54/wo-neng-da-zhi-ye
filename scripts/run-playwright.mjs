import { spawn } from "node:child_process";
import { join } from "node:path";
import { createServer } from "vite";

const port = Number(process.env.MOBILE_RUNTIME_TEST_PORT ?? 4174);
const server = await createServer({
  server: {
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
  await server.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await server.listen();
  const cli = join(process.cwd(), "node_modules", "@playwright", "test", "cli.js");
  child = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: { ...process.env, MOBILE_RUNTIME_TEST_PORT: String(port) },
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
