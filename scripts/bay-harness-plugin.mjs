/**
 * Dev-only `/__bay` pipe. The live page polls `/__bay/take` and runs
 * `window.__bay[fn](...args)`. Agents call the same API with
 * `node scripts/bay.mjs peek` — no second browser.
 *
 * Restage/load/run fan out to every waiting taker so a hidden/headless
 * tab cannot steal the job from the painted Chrome tab. Peek prefers
 * the visible canvas with the most live Rapier bodies.
 */
export function bayHarnessPlugin() {
  return {
    name: "contain:bay-harness",
    apply: "serve",
    configureServer(server) {
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
          };
        } catch {
          return { vis: "hidden", nobj: 0, paint: false, bot: false, fps: 0, ms: 0, gen: 0 };
        }
      }

      function rank(t) {
        return (t.paint ? 10000 : 0) + (t.bot ? -8000 : 0) + (t.vis === "visible" ? 1000 : 0) + (Number(t.gen) || 0) * 50 + (t.nobj || 0);
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

      function settle(job, fallback) {
        if (!job || job.status === "done") return;
        job.status = "done";
        jobs.delete(job.id);
        clearTimeout(job.timer);
        const prefer = wantedScene(job);
        let payload =
          job.expect > 1 ? pickBest(job.replies, prefer) : job.replies[0] || fallback || { error: "timeout", value: null };
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
        if (!list.length) return;
        job.status = "out";
        job.expect = list.length;
        for (const taker of list) {
          if (!taker || taker.res.writableEnded) {
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
          if (!open || !takers.length) return;
          if (FANOUT.has(open.fn)) {
            dispatch(open, takers.splice(0, takers.length));
            continue;
          }
          const painted = takers.filter((t) => t.paint || t.vis === "visible");
          const fresh = takers.filter((t) => (Number(t.gen) || 0) >= 90);
          const pool = painted.length ? painted : fresh.length ? fresh : takers;
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
          sendJson(res, 200, {
            ok: true,
            takers: takers.length,
            jobs: jobs.size,
            clients: clientCount(),
            paints: takers.filter((t) => t.paint).length,
            list: takers.map((t) => ({ vis: t.vis, nobj: t.nobj, paint: t.paint, bot: t.bot, fps: t.fps, ms: t.ms, gen: t.gen })),
          });
          return;
        }

        if (pathOnly === "/__bay/taker.js" && method === "GET") {
          sendJs(res, TAKER_SRC);
          return;
        }

        if (pathOnly === "/__bay/reload" && method === "POST") {
          try {
            server.ws?.send({ type: "full-reload" });
          } catch {
            /* ignore */
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

        if (pathOnly === "/__bay" && method === "POST") {
          readBody(req)
            .then(async (body) => {
              const fn = String(body.fn ?? "");
              if (!fn) {
                sendJson(res, 400, { ok: false, error: "missing-fn" });
                return;
              }
              const args = Array.isArray(body.args) ? body.args : [];
              const waitMs = Math.min(240000, Number(body.waitMs) || 20000);
              const id = `c${Date.now().toString(36)}${++seq}`;
              const payload = await new Promise((resolve) => {
                const timer = setTimeout(() => {
                  const job = jobs.get(id);
                  if (job) settle(job, { error: "timeout", value: null });
                  else resolve({ error: "timeout", value: null });
                }, waitMs);
                jobs.set(id, { id, fn, args, waitMs, status: "open", resolve, timer, replies: [], expect: 1 });
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

/** @typedef {{ id: string, fn: string, args: unknown[], waitMs?: number, status: "open" | "out" | "done", resolve: (v: { value?: unknown, error?: string | null }) => void, timer: NodeJS.Timeout, replies: unknown[], expect: number }} Job */
/** @typedef {{ res: import("node:http").ServerResponse, timer: NodeJS.Timeout, vis: string, nobj: number, paint: boolean, bot: boolean }} Taker */

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
    const paint = vis === "visible" && typeof document !== "undefined" && !!document.querySelector("canvas") && !bot;
    const fps = Number(g.__bayFps || 0);
    const ms = Number(g.__bayFrameMs || 0);
    const gen = Number(g.__bayPipeGen || 0);
    return { vis, nobj, paint, bot, fps, ms, gen };
  };
  const takeUrl = () => {
    const p = paintInfo();
    return "/__bay/take?wait=10000&vis=" + encodeURIComponent(p.vis) + "&nobj=" + p.nobj + "&paint=" + (p.paint ? "1" : "0") + "&bot=" + (p.bot ? "1" : "0") + "&fps=" + Math.round(p.fps) + "&ms=" + Math.round(p.ms) + "&gen=" + p.gen;
  };
  const run = async (fn, args) => {
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
      return { value: JSON.parse(JSON.stringify(value ?? null)) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
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
        let pending = jobs.get(jobKey);
        if (!pending) {
          const cap = Math.min(240000, Number(msg.waitMs) || 16000);
          pending = Promise.race([
            run(String(msg.fn ?? ""), Array.isArray(msg.args) ? msg.args : []),
            new Promise((res) => setTimeout(() => res({ error: "run-timeout" }), cap)),
          ]);
          jobs.set(jobKey, pending);
          if (jobs.size > 80) {
            const first = jobs.keys().next().value;
            if (first && first !== msg.id) jobs.delete(first);
          }
        }
        const out = await pending;
        const after = paintInfo();
        await fetch("/__bay/done", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: msg.id, ...out, paint: after.paint, nobj: after.nobj, gen: after.gen }),
        });
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
