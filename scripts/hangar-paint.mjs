#!/usr/bin/env node
import { chromium } from "playwright";

const BASE = (process.env.BAY_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--ignore-gpu-blocklist",
  "--use-gl=angle",
  "--use-angle=swiftshader",
];

let browser = null;
let shuttingDown = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function closeBrowser() {
  const current = browser;
  browser = null;
  if (!current) return;
  try {
    await current.close();
  } catch {
    /* already gone */
  }
}

function stay(page) {
  return new Promise((resolve) => {
    const done = () => resolve();
    page.once("close", done);
    page.once("crash", done);
    page.context().once("close", done);
    if (browser) browser.once("disconnected", done);
  });
}

async function hold() {
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    chromiumSandbox: false,
    args: LAUNCH_ARGS,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    window.__bayOwned = true;
    if (window.__bayHmrFrozen) return;
    window.__bayHmrFrozen = true;
    const Native = window.WebSocket;
    function FrozenWebSocket(url, protocols) {
      const list = Array.isArray(protocols)
        ? protocols
        : protocols == null
          ? []
          : [protocols];
      if (list.includes("vite-hmr") || list.includes("vite-ping")) {
        const et = new EventTarget();
        const sock = {
          url,
          protocol: "",
          extensions: "",
          binaryType: "blob",
          bufferedAmount: 0,
          readyState: 1,
          CONNECTING: 0,
          OPEN: 1,
          CLOSING: 2,
          CLOSED: 3,
          send() {},
          close() {},
          addEventListener: et.addEventListener.bind(et),
          removeEventListener: et.removeEventListener.bind(et),
          dispatchEvent: et.dispatchEvent.bind(et),
        };
        queueMicrotask(() => {
          sock.dispatchEvent(new Event("open"));
          sock.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ type: "connected" }),
            }),
          );
        });
        return sock;
      }
      if (protocols === undefined) return new Native(url);
      return new Native(url, protocols);
    }
    FrozenWebSocket.CONNECTING = Native.CONNECTING;
    FrozenWebSocket.OPEN = Native.OPEN;
    FrozenWebSocket.CLOSING = Native.CLOSING;
    FrozenWebSocket.CLOSED = Native.CLOSED;
    FrozenWebSocket.prototype = Native.prototype;
    window.WebSocket = FrozenWebSocket;
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/?hmr=false`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector("canvas");
      return Boolean(window.__bay) && c && c.width >= 64 && c.clientWidth > 64;
    },
    null,
    { timeout: 45000 },
  );
  process.stdout.write(`${JSON.stringify({ ok: true, held: true, url: BASE })}\n`);
  await stay(page);
}

async function shutdown() {
  shuttingDown = true;
  await closeBrowser();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});

while (!shuttingDown) {
  try {
    await hold();
  } catch (err) {
    if (!shuttingDown) {
      process.stderr.write(`${err?.stack || err}\n`);
    }
  }
  await closeBrowser();
  if (shuttingDown) break;
  await sleep(1500);
}
