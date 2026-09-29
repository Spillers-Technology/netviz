// Start isolated preview servers and validate the real compiled frontends.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const children = [];
function start(script, args, cwd = root) {
  const child = spawn(process.execPath, [script, ...args], { cwd, stdio: "inherit", windowsHide: true });
  children.push(child);
  return child;
}
async function run(script) {
  const child = start(path.join(root, "docs/scripts", script), []);
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)));
  });
}
try {
  start(path.join(root, "desktop/frontend/node_modules/vite/bin/vite.js"), ["preview", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], path.join(root, "desktop/frontend"));
  start(path.join(root, "web/node_modules/vite/bin/vite.js"), ["preview", "--host", "127.0.0.1", "--port", "5174", "--strictPort"], path.join(root, "web"));
  await run("capture-desktop-media.mjs");
  await run("capture-server-media.mjs");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
}
