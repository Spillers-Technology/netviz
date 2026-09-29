import fs from "node:fs";
import path from "node:path";

export const profiles = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "compact", width: 960, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

export function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
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

export async function captureView(page, errors, filename) {
  await assertNoOverflow(page, errors);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  await page.screenshot({ path: filename, fullPage: true });
}
