import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serverProfiles, colorSchemes, chromiumArgs, trackErrors, captureView, assertCanvasPainted } from "./validation.mjs";

const out = process.env.NETVIZ_CAPTURE_OUT_DIR || fileURLToPath(new URL("../assets/workspaces", import.meta.url));
const base = process.env.NETVIZ_SERVER_CAPTURE_BASE_URL || "http://127.0.0.1:5174";
const browser = await chromium.launch({ headless: true, args: chromiumArgs });
function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function openNav(page, profile, id) {
  // Phones get the navigation in a drawer behind the menu button.
  if (profile.name === "mobile") await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(`[data-nav="${id}"]`).click();
}

try {
  for (const profile of serverProfiles) {
    for (const scheme of colorSchemes) {
      const tag = `${profile.name}-${scheme}`;
      const context = await browser.newContext({ viewport: profile, colorScheme: scheme, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = trackErrors(page);
      // Demo mode uses only the repository's synthetic observations.
      await page.goto(`${base}/?demo`, { waitUntil: "networkidle" });
      await page.locator("tbody tr[data-ip]").first().waitFor();
      await captureView(page, errors, path.join(out, `server-${tag}-devices.png`));

      const search = page.getByRole("searchbox", { name: "Find a device" });
      await search.fill("192.168.1.1");
      const count = await page.locator("tbody tr[data-ip]").count();
      await page.getByRole("button", { name: "Map", exact: true }).click();
      check((await search.inputValue()) === "192.168.1.1", "Search lost switching to the map");
      await page.locator("[data-topology-renderer]").waitFor();
      await page.getByRole("button", { name: "Devices", exact: true }).click();
      check((await page.locator("tbody tr[data-ip]").count()) === count, "Device filter changed between views");
      await search.fill("no-such-device");
      await page.getByRole("heading", { name: "No matching devices" }).waitFor();
      await page.getByRole("button", { name: "Clear filters" }).click();

      await page.getByRole("button", { name: "Map", exact: true }).click();
      await page.locator('[data-topology-ready="true"]').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600);
      await assertCanvasPainted(page);
      await captureView(page, errors, path.join(out, `server-${tag}-map.png`));

      await openNav(page, profile, "probes");
      await page.getByRole("heading", { name: /^Connect (a probe|another network)$/ }).waitFor();
      await captureView(page, errors, path.join(out, `server-${tag}-probes.png`));
      await context.close();

      // Live loading, empty, and refresh-error states, without a network scan.
      const liveContext = await browser.newContext({ viewport: profile, colorScheme: scheme, reducedMotion: "reduce" });
      const live = await liveContext.newPage();
      const liveErrors = trackErrors(live);
      await live.route("**/api/me", (route) => route.fulfill({ json: { auth: false } }));
      await live.route("**/api/state", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.fulfill({ json: { version: "synthetic", devices: [] } });
      });
      await live.goto(base, { waitUntil: "domcontentloaded" });
      await live.getByRole("progressbar", { name: "Loading the inventory" }).waitFor();
      await captureView(live, liveErrors, path.join(out, `server-${tag}-loading.png`));
      await live.getByRole("heading", { name: "No devices reported yet" }).waitFor();
      await captureView(live, liveErrors, path.join(out, `server-${tag}-empty.png`));
      await live.unroute("**/api/state");
      await live.route("**/api/state", (route) => route.abort("failed"));
      await live.getByRole("button", { name: "Refresh", exact: true }).click();
      await live.getByRole("alert").waitFor();
      // Chromium reports the intentionally aborted request as console.error.
      await captureView(live, liveErrors.filter((error) => !error.includes("net::ERR_FAILED")), path.join(out, `server-${tag}-error.png`));
      await liveContext.close();
      console.log(`Captured ${tag} server views`);
    }
  }
} finally {
  await browser.close();
}
