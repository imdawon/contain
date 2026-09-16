/**
 * Dev-only `/__bay` pipe. The live page polls `/__bay/take` and runs
 * `window.__bay[fn](...args)`. Agents call the same API with
 * `node scripts/bay.mjs peek` — no second browser.
 *
 * Restage/load/run fan out to every waiting taker so a hidden/headless
 * tab cannot steal the job from the painted Chrome tab. Peek prefers
 * the visible canvas with the most live Rapier bodies.
 */
let bayTapeFreeze = false;

const HMR_FREEZE_SCRIPT = `(function(){
  if (window.__bayHmrFrozen) return;
  window.__bayHmrFrozen = true;
  const Native = window.WebSocket;
  function FrozenWebSocket(url, protocols) {
    const list = Array.isArray(protocols) ? protocols : protocols == null ? [] : [protocols];
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
        sock.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "connected" }) }));
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
})();`;

function dropFrozenHmr(payload) {
  return bayTapeFreeze && payload && typeof payload === "object" && (payload.type === "full-reload" || payload.type === "update");
}

function wrapHmrSend(orig) {
  return function wrapped(payload, ...rest) {
    if (dropFrozenHmr(payload)) return;
    return orig.call(this, payload, ...rest);
  };
}

export function bayHarnessPlugin() {
  return {
    name: "contain:bay-harness",
    apply: "serve",
    handleHotUpdate() {
      if (bayTapeFreeze) return [];
    },
    hotUpdate() {
      if (bayTapeFreeze) return [];
    },
    transformIndexHtml: {
      order: "pre",
      enforce: "pre",
      handler(_html, ctx) {
        const hay = `${ctx?.url ?? ""}${ctx?.originalUrl ?? ""}${ctx?.path ?? ""}`;
        if (!hay.includes("hmr=false")) return;
        return [{ tag: "script", injectTo: "head-prepend", children: HMR_FREEZE_SCRIPT }];
      },
    },
    configureServer(server) {
      const wsSend = server.ws?.send;
      if (typeof wsSend === "function") server.ws.send = wrapHmrSend(wsSend.bind(server.ws));
      const hotSend = server.hot?.send;
      if (typeof hotSend === "function" && hotSend !== wsSend) server.hot.send = wrapHmrSend(hotSend.bind(server.hot));

      /** @type {Map<string, Job>} */
      const jobs = new Map();
      /** @type {Taker[]} */
      const takers = [];
      let seq = 0;

      function clientCount() {
        try {
          const clients = server.ws?.clients;
          if (clients && typeof clients.size === "number") return clients.size;
          if (clients && typeof clients[Symbol.iterator] === "function") return [...clients].length;
        } catch {
          /* ignore */
        }
        return 0;
      }

      function metaFromReq(req) {
        try {
          const u = new URL(req.url ?? "", "http://127.0.0.1");
          return {
            vis: u.searchParams.get("vis") || "hidden",
            nobj: Number(u.searchParams.get("nobj") || 0),
            paint: u.searchParams.get("paint") === "1",
            bot: u.searchParams.get("bot") === "1",
            fps: Number(u.searchParams.get("fps") || 0),
            ms: Number(u.searchParams.get("ms") || 0),
            gen: Number(u.searchParams.get("gen") || 0),
            owned: u.searchParams.get("owned") === "1",
          };
        } catch {
          return { vis: "hidden", nobj: 0, paint: false, bot: false, fps: 0, ms: 0, gen: 0, owned: false };
        }
      }

      function rank(t) {
        return (t.paint ? 10000 : 0) + (t.owned ? 8000 : 0) + ((t.bot && !t.owned) ? -8000 : 0) + (t.vis === "visible" ? 1000 : 0) + (Number(t.gen) || 0) * 50 + (t.nobj || 0);
      }

      let lastScene = null;

      function sceneOf(r) {
        const v = r && r.value ? r.value : r;
        return (v && (v.scene && v.scene.id || v.scene || v.id || (v.level && v.level.id) || v.levelId)) || null;
      }

      function wantedScene(job) {
        if (!job) return lastScene;
        if (job.fn === "restage") {
          const a = job.args && job.args[0];
          if (typeof a === "string" && a.length) return a;
          if (a && typeof a === "object" && a.id) return a.id;
        }
        if (job.fn === "run" || job.fn === "load") {
          const a = job.args && job.args[0];
          if (typeof a === "string" && a.length) return a;
        }
        return lastScene;
      }

      function pickBest(replies, prefer) {
        const live = (replies || []).filter((r) => r && !r.skipped);
        if (!live.length) return replies?.[0] ?? { error: "no-taker", value: null };
        live.sort((a, b) => {
          const sa = sceneOf(a);
          const sb = sceneOf(b);
          const ma = prefer && sa === prefer ? 1 : 0;
          const mb = prefer && sb === prefer ? 1 : 0;
          const pa = a.paint || a.value?.paint ? 1 : 0;
          const pb = b.paint || b.value?.paint ? 1 : 0;
          const na = Number(a.nobj ?? a.value?.objects?.length ?? a.value?.n ?? 0);
          const nb = Number(b.nobj ?? b.value?.objects?.length ?? b.value?.n ?? 0);
          const oa = a.error ? 0 : 1;
          const ob = b.error ? 0 : 1;
          return mb - ma || ob - oa || pb - pa || nb - na;
        });
        return live[0];
      }

      function liveTakers() {
        return takers.filter((t) => t && !t.ghost);
      }

      function clearTapeWatch(job) {
        if (job?.watch) {
          clearInterval(job.watch);
          job.watch = null;
        }
      }

      function removeGhost(job) {
        if (!job?.ghost) return;
        const i = takers.indexOf(job.ghost);
        if (i >= 0) takers.splice(i, 1);
        job.ghost = null;
      }

      function tapeAbortValue(job) {
        return { ok: false, aborted: true, jpegN: job?.jpegN || 0 };
      }

      function armTapeWatch(job) {
        clearTapeWatch(job);
        job.takersZeroSince = null;
        job.watch = setInterval(() => {
          if (!job || job.status === "done") {
            clearTapeWatch(job);
            return;
          }
          // Ghost hold counts: live HTTP taker is spliced during bake.
          if (takers.length === 0) {
            if (!job.takersZeroSince) job.takersZeroSince = Date.now();
            else if (Date.now() - job.takersZeroSince > 5000) {
              settle(job, { error: "tape-no-taker", value: tapeAbortValue(job) });
              return;
            }
          } else {
            job.takersZeroSince = null;
          }
          if (Date.now() - (job.lastJpegAt || 0) > 90000) {
            settle(job, { error: "tape-stall", value: tapeAbortValue(job) });
          }
        }, 1000);
      }

      function settle(job, fallback) {
        if (!job || job.status === "done") return;
        job.busyPaint = false;
        if (job.fn === "tape") bayTapeFreeze = false;
        job.status = "done";
        jobs.delete(job.id);
        clearTimeout(job.timer);
        clearTapeWatch(job);
        removeGhost(job);
        const prefer = wantedScene(job);
        let payload =
          job.expect > 1 ? pickBest(job.replies, prefer) : job.replies[0] || fallback || { error: "timeout", value: null };
        if (job.fn === "tape") {
          const frames = job.frames;
          if (Array.isArray(frames) && frames.length) {
            const v = payload && payload.value;
            if (!v || typeof v !== "object") payload = { ...payload, value: { ...(v && typeof v === "object" ? v : {}), frames } };
            else if (!Array.isArray(v.frames) || v.frames.length === 0) payload = { ...payload, value: { ...v, frames } };
          }
        }
        const sid = sceneOf(payload);
        if ((job.fn === "restage" || job.fn === "run" || job.fn === "load") && sid) lastScene = sid;
        if (job.expect > 1 && job.fn === "peek") {
          const all = (job.replies || []).map((r) => {
            const v = r && r.value ? r.value : r;
            return {
              paint: Boolean(r && (r.paint || v && v.paint)),
              hidden: Boolean(v && v.hidden),
              fps: v && v.fps,
              frameMs: v && v.frameMs,
              nobj: Number(r && r.nobj != null ? r.nobj : v && v.nobj || 0),
              level: v && v.level && v.level.id,
              error: r && r.error,
              skipped: Boolean(r && r.skipped),
            };
          });
          payload = { ...payload, all, replies: all.length };
        }
        job.resolve(payload);
      }

      function dispatch(job, list) {
        const real = (list || []).filter((t) => t && !t.ghost);
        if (!real.length) return;
        if (job.fn === "tape") {
          bayTapeFreeze = true;
          job.lastJpegAt = Date.now();
          job.jpegN = job.jpegN || 0;
          job.frames = job.frames || [];
          const src = real.find((t) => t.paint) || real[0];
          const ghost = {
            ghost: true,
            paint: true,
            owned: Boolean(src && src.owned),
            vis: src && src.vis,
            nobj: src && src.nobj,
            bot: src && src.bot,
            fps: src && src.fps,
            ms: src && src.ms,
            gen: src && src.gen,
            res: { writableEnded: true },
          };
          job.ghost = ghost;
          takers.push(ghost);
          armTapeWatch(job);
        }
        job.status = "out";
        job.expect = real.length;
        const painted = real.find((t) => t && t.paint === true);
        if (painted) {
          job.busyPaint = true;
          job.vis = painted.vis;
          job.nobj = painted.nobj;
          job.bot = painted.bot;
        }
        for (const taker of real) {
          if (!taker || taker.ghost || taker.res.writableEnded) {
            job.expect -= 1;
            continue;
          }
          clearTimeout(taker.timer);
          sendJson(taker.res, 200, { id: job.id, fn: job.fn, args: job.args, waitMs: job.waitMs });
        }
        if (job.expect <= 0) settle(job, { error: "no-taker", value: null });
      }

      function pair() {
        while (true) {
          const open = [...jobs.values()].find((j) => j.status === "open");
          const live = liveTakers();
          if (!open || !live.length) return;
          if (FANOUT.has(open.fn)) {
            const batch = [];
            for (let i = takers.length - 1; i >= 0; i--) {
              if (!takers[i].ghost) batch.push(takers.splice(i, 1)[0]);
            }
            batch.reverse();
            dispatch(open, batch);
            continue;
          }
          const painted = live.filter((t) => t.paint || t.vis === "visible");
          const fresh = live.filter((t) => (Number(t.gen) || 0) >= 90);
          const pool = painted.length ? painted : fresh.length ? fresh : live;
          pool.sort((a, b) => rank(b) - rank(a));
          const best = pool[0];
          const i = takers.indexOf(best);
          if (i >= 0) takers.splice(i, 1);
          dispatch(open, best ? [best] : []);
        }
      }

      function finish(id, payload) {
        const job = jobs.get(id);
        if (!job || job.status === "done") return;
        job.replies.push(payload);
        if (job.replies.length >= job.expect) settle(job);
      }

      if (typeof server.hot?.on === "function") {
        server.hot.on("bay:return", (payload) => {
          if (payload?.id) finish(String(payload.id), { value: payload.value ?? null, error: payload.error ?? null, skipped: payload.skipped === true, paint: payload.paint === true, nobj: payload.nobj });
        });
      }

      server.middlewares.use((req, res, next) => {
        const pathOnly = (req.url ?? "").split("?", 1)[0];
        if (!pathOnly.startsWith("/__bay")) {
          next();
          return;
        }
        const method = (req.method ?? "GET").toUpperCase();

        if (pathOnly === "/__bay/health" && method === "GET") {
          const busyJobs = [...jobs.values()].filter((j) => j.status === "out" && j.busyPaint);
          const ownedTakers = takers.filter((t) => t.owned);
          const paintList = ownedTakers.length ? takers.filter((t) => t.owned && t.paint) : takers.filter((t) => t.paint);
          const paints = paintList.length + (paintList.length ? 0 : busyJobs.length);
          sendJson(res, 200, {
            ok: true,
            takers: takers.length,
            jobs: jobs.size,
            clients: clientCount(),
            paints,
            list: [
              ...takers.map((t) => ({ vis: t.vis, nobj: t.nobj, paint: t.paint, bot: t.bot, fps: t.fps, ms: t.ms, gen: t.gen, owned: t.owned, ...(t.ghost ? { ghost: true } : {}) })),
              ...busyJobs.map((j) => ({ paint: true, busy: true, fn: j.fn, vis: j.vis, nobj: j.nobj, bot: j.bot })),
            ],
          });
          return;
        }

        if (pathOnly === "/__bay/taker.js" && method === "GET") {
          sendJs(res, TAKER_SRC);
          return;
        }

        if (pathOnly === "/__bay/reload" && method === "POST") {
          if (!bayTapeFreeze) {
            try {
              server.ws?.send({ type: "full-reload" });
            } catch {
              /* ignore */
            }
          }
          sendJson(res, 200, { ok: true, clients: clientCount() });
          return;
        }

        if (pathOnly === "/__bay/take" && method === "GET") {
          const wait = Math.min(30000, Number(new URL(req.url ?? "", "http://127.0.0.1").searchParams.get("wait")) || 10000);
          const flying = [...jobs.values()].find((j) => j.status === "out" && FANOUT.has(j.fn));
          if (flying) {
            flying.expect += 1;
            sendJson(res, 200, { id: flying.id, fn: flying.fn, args: flying.args, waitMs: flying.waitMs });
            return;
          }
          const timer = setTimeout(() => {
            const i = takers.findIndex((t) => t.res === res);
            if (i >= 0) takers.splice(i, 1);
            if (!res.writableEnded) {
              res.statusCode = 204;
              res.end();
            }
          }, wait);
          takers.push({ res, timer, ...metaFromReq(req) });
          req.on("close", () => {
            clearTimeout(timer);
            const i = takers.findIndex((t) => t.res === res);
            if (i >= 0) takers.splice(i, 1);
          });
          pair();
          return;
        }

        if (pathOnly === "/__bay/progress" && method === "POST") {
          readBody(req)
            .then((body) => {
              let job = body.id != null && body.id !== "" ? jobs.get(String(body.id)) : null;
              if (!job) {
                const out = [...jobs.values()].filter((j) => j.status === "out" && j.fn === "tape");
                if (out.length === 1) job = out[0];
              }
              if (job) {
                const frame = body.frame;
                if (typeof frame === "string" && frame.startsWith("data:image")) {
                  (job.frames ??= []).push(frame);
                }
                if (body.jpegN != null && body.jpegN !== "") job.jpegN = Number(body.jpegN);
                else if (typeof frame === "string" && frame.startsWith("data:image")) job.jpegN = (job.jpegN || 0) + 1;
                job.lastJpegAt = Date.now();
              }
              sendJson(res, 200, { ok: true });
            })
            .catch((err) => sendJson(res, 400, { ok: false, error: String(err) }));
          return;
        }

        if (pathOnly === "/__bay/done" && method === "POST") {
          readBody(req)
            .then((body) => {
              finish(String(body.id ?? ""), {
                value: body.value ?? null,
                error: body.error ?? null,
                skipped: body.skipped === true,
                paint: body.paint === true,
                nobj: body.nobj,
              });
              sendJson(res, 200, { ok: true });
            })
            .catch((err) => sendJson(res, 400, { ok: false, error: String(err) }));
          return;
        }

        if ((pathOnly === "/__bay/abort" || pathOnly === "/__bay/cancel") && method === "POST") {
          for (const job of [...jobs.values()]) {
            job.expect = 1;
            job.replies = [];
            settle(job, { error: "aborted", value: null });
          }
          jobs.clear();
          sendJson(res, 200, { ok: true, jobs: jobs.size });
          return;
        }

        if (pathOnly === "/__bay" && method === "POST") {
          readBody(req)
            .then(async (body) => {
              const fn = String(body.fn ?? "");
              if (!fn) {
                sendJson(res, 400, { ok: false, error: "missing-fn" });
                return;
              }
              const args = Array.isArray(body.args) ? body.args : [];
              const waitMs = Math.min(fn === "tape" ? 120000 : 240000, Number(body.waitMs) || 20000);
              const id = `c${Date.now().toString(36)}${++seq}`;
              const payload = await new Promise((resolve) => {
                const timer = setTimeout(() => {
                  const job = jobs.get(id);
                  if (job) {
                    if (job.fn === "tape" && Array.isArray(job.frames) && job.frames.length >= 3) {
                      settle(job, {
                        value: { ok: true, aborted: false, jpegN: job.frames.length, n: job.frames.length, frames: job.frames },
                      });
                    } else {
                      const value = job.fn === "tape" ? tapeAbortValue(job) : null;
                      settle(job, { error: "timeout", value });
                    }
                  } else resolve({ error: "timeout", value: null });
                }, waitMs);
                jobs.set(id, {
                  id,
                  fn,
                  args,
                  waitMs,
                  status: "open",
                  resolve,
                  timer,
                  replies: [],
                  expect: 1,
                  jpegN: 0,
                  lastJpegAt: 0,
                  frames: [],
                  ghost: null,
                  watch: null,
                  takersZeroSince: null,
                });
                try {
                  if (typeof server.hot?.send === "function") server.hot.send("bay:call", { id, fn, args, waitMs });
                } catch {
                  /* ignore */
                }
                try {
                  server.ws?.send({ type: "custom", event: "bay:call", data: { id, fn, args, waitMs } });
                } catch {
                  /* ignore */
                }
                pair();
              });
              const status = payload.error === "timeout" ? 504 : payload.error ? 500 : 200;
              sendJson(res, status, { ok: !payload.error, ...payload });
            })
            .catch((err) => sendJson(res, 400, { ok: false, error: String(err) }));
          return;
        }

        next();
      });
    },
  };
}

const FANOUT = new Set(["restage", "run", "load", "reset", "next", "peek", "boot", "reload"]);

/** @typedef {{ id: string, fn: string, args: unknown[], waitMs?: number, status: "open" | "out" | "done", resolve: (v: { value?: unknown, error?: string | null }) => void, timer: NodeJS.Timeout, replies: unknown[], expect: number, busyPaint?: boolean, vis?: string, nobj?: number, bot?: boolean, jpegN?: number, lastJpegAt?: number, frames?: string[], ghost?: Taker | null, watch?: NodeJS.Timeout | null, takersZeroSince?: number | null }} Job */
/** @typedef {{ res: import("node:http").ServerResponse, timer: NodeJS.Timeout, vis: string, nobj: number, paint: boolean, bot: boolean, ghost?: boolean }} Taker */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("content-length", String(body.byteLength));
  res.end(body);
}

const TAKER_SRC = `const g = globalThis;
if (!(g.__bayPipeCtl && !g.__bayPipeCtl.signal.aborted)) {
  const ctl = new AbortController();
  g.__bayPipeCtl = ctl;
  const paintInfo = () => {
    const vis = typeof document !== "undefined" ? document.visibilityState : "hidden";
    let nobj = 0;
    try { nobj = (g.__bay?.peek?.().objects || []).length; } catch {}
    const bot = typeof navigator !== "undefined" && navigator.webdriver === true;
    const canvas = typeof document !== "undefined" && !!document.querySelector("canvas");
    const owned = Boolean(g.__bayOwned);
    const bake = Boolean(g.__bayBake);
    const paint = Boolean(canvas && (owned || bake || vis === "visible"));
    const fps = Number(g.__bayFps || 0);
    const ms = Number(g.__bayFrameMs || 0);
    const gen = Number(g.__bayPipeGen || 0);
    return { vis, nobj, paint, bot, fps, ms, gen, owned };
  };
  const takeUrl = () => {
    const p = paintInfo();
    return "/__bay/take?wait=10000&vis=" + encodeURIComponent(p.vis) + "&nobj=" + p.nobj + "&paint=" + (p.paint ? "1" : "0") + "&bot=" + (p.bot ? "1" : "0") + "&fps=" + Math.round(p.fps) + "&ms=" + Math.round(p.ms) + "&gen=" + p.gen + "&owned=" + (p.owned ? "1" : "0");
  };
  const run = async (fn, args, jobId) => {
    if (g.__bayBake && fn === "tape" && String(g.__bayTapeJob) !== String(jobId)) return { skipped: true };
    const api = g.__bay;
    if (fn === "orbit") {
      const canvas = [...document.querySelectorAll("canvas")].find((el) => el.width >= 64 && el.height >= 64);
      if (!canvas) return { error: "no-canvas" };
      const dx = Number((args && args[0]) != null ? args[0] : 320) || 320;
      const dy = Number((args && args[1]) != null ? args[1] : 40) || 0;
      const r = canvas.getBoundingClientRect();
      const x0 = (r.width > 8 ? r.left + r.width * 0.5 : canvas.width * 0.5);
      const y0 = (r.height > 8 ? r.top + r.height * 0.42 : canvas.height * 0.42);
      const fire = (type, x, y, target, up) => {
        const common = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: up ? 0 : 1 };
        target.dispatchEvent(new PointerEvent(type, { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
        const mouseType = type === "pointerdown" ? "mousedown" : type === "pointerup" ? "mouseup" : type === "pointermove" ? "mousemove" : null;
        if (mouseType) target.dispatchEvent(new MouseEvent(mouseType, common));
      };
      const before = api && typeof api.camera === "function" ? api.camera() : null;
      fire("pointerdown", x0, y0, canvas, false);
      for (let i = 1; i <= 12; i++) {
        const mx = x0 + (dx * i) / 12;
        const my = y0 + (dy * i) / 12;
        fire("pointermove", mx, my, canvas, false);
        fire("pointermove", mx, my, document, false);
      }
      fire("pointerup", x0 + dx, y0 + dy, document, true);
      try { g.__bayKick && g.__bayKick(); } catch (e) {}
      const after = api && typeof api.camera === "function" ? api.camera() : null;
      return { value: { ok: true, dx, dy, before, after } };
    }
    if (fn === "boot") {
      location.reload();
      return { value: { ok: true, boot: true } };
    }
    if (!api || typeof api[fn] !== "function") return { error: "no-fn:" + fn };
    try {
      const value = await api[fn](...(args || []));
      let payload = value ?? null;
      try { payload = JSON.parse(JSON.stringify(payload)); } catch {}
      if (payload && Array.isArray(payload.frames)) delete payload.frames;
      return { value: payload };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
  const postDone = async (id, out) => {
    const after = paintInfo();
    const body = { id, ...out, paint: after.paint, nobj: after.nobj, gen: after.gen, owned: after.owned };
    if (body.value && Array.isArray(body.value.frames)) delete body.value.frames;
    await fetch("/__bay/done", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  };
  const loop = async () => {
    while (!ctl.signal.aborted) {
      try {
        const r = await fetch(takeUrl(), { signal: ctl.signal });
        if (ctl.signal.aborted) return;
        if (r.status === 204) continue;
        if (!r.ok) {
          await new Promise((res) => setTimeout(res, 400));
          continue;
        }
        const msg = await r.json();
        if (!msg?.id) continue;
        const jobs = (g.__bayJobs ??= new Map());
        const jobKey = String(msg.id) + ":" + String(msg.fn ?? "");
        const fnName = String(msg.fn ?? "");
        let pending = jobs.get(jobKey);
        if (!pending) {
          const cap = Math.min(fnName === "tape" ? 120000 : 240000, Number(msg.waitMs) || 16000);
          if (fnName === "tape") g.__bayTapeJob = msg.id;
          pending = Promise.race([
            run(fnName, Array.isArray(msg.args) ? msg.args : [], msg.id),
            new Promise((res) => setTimeout(() => res({ error: "run-timeout" }), cap)),
          ]);
          jobs.set(jobKey, pending);
          if (jobs.size > 80) {
            const first = jobs.keys().next().value;
            if (first && first !== msg.id) jobs.delete(first);
          }
        }
        if (fnName === "tape") {
          void pending.then(async (out) => {
            try {
              await postDone(msg.id, out);
            } finally {
              jobs.delete(jobKey);
              if (g.__bayTapeJob === msg.id) g.__bayTapeJob = null;
            }
          });
          continue;
        }
        const out = await pending;
        await postDone(msg.id, out);
        jobs.delete(jobKey);
      } catch {
        if (ctl.signal.aborted) return;
        await new Promise((res) => setTimeout(res, 500));
      }
    }
  };
  void loop();
}
`;

function sendJs(res, src) {
  const body = Buffer.from(src, "utf8");
  res.statusCode = 200;
  res.setHeader("content-type", "text/javascript; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", String(body.byteLength));
  res.end(body);
}
