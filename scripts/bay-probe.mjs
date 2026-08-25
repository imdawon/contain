import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const url = process.env.BAY_URL || "http://192.168.1.6:8080/";
const outDir = new URL("../screenshots/", import.meta.url);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (err) => console.error("PAGEERROR", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("CONSOLE", msg.text());
});

await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForFunction(() => Boolean(window.__bay?.snapshot), { timeout: 20000 });
await page.waitForTimeout(1800);

const rest = await page.evaluate(() => {
  window.__bay.track("can0");
  return JSON.parse(window.__bay.dump());
});

const canRest = rest.objects.find((o) => o.id === "can0");
const lidRest = rest.objects.find((o) => o.id === "can0-lid");

await page.screenshot({
  path: new URL("bay-rest.png", outDir).pathname,
  type: "png",
});

const puncture = page.getByRole("button", { name: "PUNCTURE" });
await puncture.waitFor({ state: "visible" });
if (await puncture.isDisabled()) {
  await page.evaluate(() => {
    const pack = window.__bay.snapshot().objects.find((o) => o.kind === "pack");
    if (pack) {
      /* click is the UI path; selection is already pack0 */
    }
  });
}
await puncture.click();

const broke = await page.waitForFunction(
  () => window.__bay.snapshot().latch === "hinged" || window.__bay.snapshot().latch === "free",
  { timeout: 8000 },
).catch(() => null);

const atPop = await page.evaluate(() => {
  const s = window.__bay.snapshot();
  const can = s.objects.find((o) => o.id === "can0");
  const lid = s.objects.find((o) => o.id === "can0-lid");
  return { y: can?.y, vy: can?.vy, mass: can?.mass, lidY: lid?.y, lidRx: lid?.rx, latch: s.latch };
});
await page.waitForTimeout(1200);
const shortly = await page.evaluate(() => {
  const s = window.__bay.snapshot();
  const can = s.objects.find((o) => o.id === "can0");
  const lid = s.objects.find((o) => o.id === "can0-lid");
  return { y: can?.y, vy: can?.vy, mass: can?.mass, lidY: lid?.y, lidRx: lid?.rx, latch: s.latch };
});
await page.screenshot({
  path: new URL("bay-after.png", outDir).pathname,
  type: "png",
});
await page.waitForTimeout(3500);

const after = await page.evaluate(() => JSON.parse(window.__bay.dump()));
const canAfter = after.objects.find((o) => o.id === "can0");
const lidAfter = after.objects.find((o) => o.id === "can0-lid");
const events = after.events.map((e) => e.type);

const applyOk = await page.evaluate(() => {
  const before = window.__bay.snapshot().objects.find((o) => o.id === "can0");
  window.__bay.apply("can0", { y: 2, mass: 20 });
  return { beforeY: before?.y, applied: true };
});
await page.waitForTimeout(80);
const lifted = await page.evaluate(() => {
  const o = window.__bay.snapshot().objects.find((x) => x.id === "can0");
  return { y: o?.y, mass: o?.mass };
});
await page.waitForTimeout(2500);
const fell = await page.evaluate(() => {
  const o = window.__bay.snapshot().objects.find((x) => x.id === "can0");
  return { y: o?.y, vy: o?.vy };
});

await page.screenshot({
  path: new URL("bay-apply.png", outDir).pathname,
  type: "png",
});

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({
  path: new URL("bay-mobile.png", outDir).pathname,
  type: "png",
});

await browser.close();

const report = {
  url,
  rest: { y: canRest?.y, vy: canRest?.vy, mass: canRest?.mass, lidRx: lidRest?.rx, latch: rest.latch, trackId: rest.trackId },
  atPop,
  shortly,
  after: {
    y: canAfter?.y,
    vy: canAfter?.vy,
    mass: canAfter?.mass,
    lidRx: lidAfter?.rx,
    latch: after.latch,
    events,
    t: after.t,
  },
  apply: { applyOk, lifted, fell },
  grounded: canAfter && canAfter.y < 1.0 && Math.abs(canAfter.vy ?? 0) < 1.5,
  massApply: lifted.mass != null && Math.abs(lifted.mass - 20) < 0.2,
  latchPopped: after.latch === "hinged" || after.latch === "free",
  hingeHeld: after.latch !== "free",
  lidMoved: lidRest && lidAfter ? Math.abs((lidAfter.rx ?? 0) - (lidRest.rx ?? 0)) > 0.05 : false,
  inspector: true,
  broke: Boolean(broke),
};
console.log(JSON.stringify(report, null, 2));

if (!report.grounded || !report.latchPopped || report.after.y > 1.0 || (report.rest.mass ?? 0) < 4 || !report.massApply) {
  process.exit(1);
}
