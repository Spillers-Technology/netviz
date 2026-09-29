import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profiles, trackErrors, captureView } from "./validation.mjs";

const out = process.env.NETVIZ_CAPTURE_OUT_DIR || fileURLToPath(new URL("../assets/workspaces", import.meta.url));
const base = process.env.NETVIZ_SERVER_CAPTURE_BASE_URL || "http://127.0.0.1:5174";
const browser = await chromium.launch({ headless: true });
function check(condition, message) { if (!condition) throw new Error(message); }
try {
  for (const profile of profiles) {
    const page = await browser.newPage({ viewport: profile });
    const errors = trackErrors(page);
    // Demo mode uses only the repository's synthetic observations.
    await page.goto(`${base}/?demo`, { waitUntil: "networkidle" });
    await page.locator("tbody tr").first().waitFor();
    await captureView(page, errors, path.join(out, `server-${profile.name}-devices.png`));
    const search = page.getByRole("searchbox", { name: "Find a device" });
    await search.fill("192.168.1.1");
    const count = await page.locator("tbody tr").count();
    await page.getByRole("button", { name: "Map", exact: true }).click();
    check(await search.inputValue() === "192.168.1.1", "Search lost switching to map");
    await captureView(page, errors, path.join(out, `server-${profile.name}-filtered-map.png`));
    await page.getByRole("button", { name: "Devices", exact: true }).click();
    check(await page.locator("tbody tr").count() === count, "Device filter changed between views");
    await search.fill("no-such-device");
    await page.getByRole("heading", { name: "No matching devices" }).waitFor();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await captureView(page, errors, path.join(out, `server-${profile.name}-map.png`));
    await page.locator(".workspaceNav button").last().click();
    await captureView(page, errors, path.join(out, `server-${profile.name}-probe.png`));
    await page.close();

    // Live loading, empty, and refresh-error states, without a network scan.
    const live = await browser.newPage({ viewport: profile });
    const liveErrors = trackErrors(live);
    await live.route("**/api/me", (route) => route.fulfill({ json: { auth: false } }));
    await live.route("**/api/state", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({ json: { version: "synthetic", devices: [] } });
    });
    await live.goto(base, { waitUntil: "domcontentloaded" });
    await captureView(live, liveErrors, path.join(out, `server-${profile.name}-loading.png`));
    await live.getByRole("heading", { name: "No device pushes yet" }).waitFor();
    await captureView(live, liveErrors, path.join(out, `server-${profile.name}-empty.png`));
    await live.unroute("**/api/state");
    await live.route("**/api/state", (route) => route.abort("failed"));
    await live.getByRole("button", { name: "Refresh", exact: true }).click();
    await live.getByRole("alert").waitFor();
    // Chromium reports the intentionally aborted request as console.error.
    await captureView(live, liveErrors.filter((error) => !error.includes("net::ERR_FAILED")), path.join(out, `server-${profile.name}-error.png`));
    await live.close();
  }
} finally { await browser.close(); }
