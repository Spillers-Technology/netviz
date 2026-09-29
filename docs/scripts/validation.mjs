import fs from "node:fs";
import path from "node:path";

// Desktop window sizes: a typical laptop, and the app's minimum window
// (desktop/main.go MinWidth x MinHeight). The desktop app can't be narrower.
export const desktopProfiles = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "compact", width: 960, height: 640 },
];

// The server UI is a website, so it is also checked at phone width.
export const serverProfiles = [...desktopProfiles, { name: "mobile", width: 390, height: 844 }];

export const colorSchemes = ["light", "dark"];

// WebGL in headless Chromium, including on runners without a GPU.
export const chromiumArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

export function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

export async function assertNoOverflow(page, errors) {
  if (errors.length) throw new Error(`Browser errors: ${errors.join("\n")}`);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  if (dimensions.document > dimensions.viewport + 1) {
    throw new Error(`Page overflow: ${dimensions.document}px > ${dimensions.viewport}px at ${page.url()}`);
  }
}

// assertCanvasPainted fails when the 3D map rendered nothing: it samples the
// WebGL canvas and requires real variation, not one flat background color.
export async function assertCanvasPainted(page) {
  const result = await page.evaluate(() => {
    const canvas = document.querySelector("[data-topology-renderer='3d'] canvas");
    if (!canvas) return { ok: false, reason: "no canvas" };
    const probe = document.createElement("canvas");
    probe.width = 64;
    probe.height = 64;
    const context = probe.getContext("2d");
    context.drawImage(canvas, 0, 0, 64, 64);
    const data = context.getImageData(0, 0, 64, 64).data;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) colors.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
    return { ok: colors.size > 12, reason: `${colors.size} distinct colors` };
  });
  if (!result.ok) throw new Error(`3D map looks blank (${result.reason}) at ${page.url()}`);
}

export async function captureView(page, errors, filename) {
  await assertNoOverflow(page, errors);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  await page.screenshot({ path: filename, fullPage: true });
}
