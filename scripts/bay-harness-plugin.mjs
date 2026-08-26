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
          };
        } catch {
          return { vis: "hidden", nobj: 0, paint: false, bot: false };
        }
      }

      function rank(t) {
        return (t.paint ? 10000 : 0) + (t.bot ? -8000 : 0) + (t.vis === "visible" ? 1000 : 0) + (t.nobj || 0);
      }

      function pickBest(replies) {
        const live = (replies || []).filter((r) => r && !r.skipped);
        if (!live.length) return replies?.[0] ?? { error: "no-taker", value: null };
        live.sort((a, b) => {
          const pa = a.paint || a.value?.paint ? 1 : 0;
          const pb = b.paint || b.value?.paint ? 1 : 0;
          const na = Number(a.nobj ?? a.value?.objects?.length ?? a.value?.n ?? 0);
          const nb = Number(b.nobj ?? b.value?.objects?.length ?? b.value?.n ?? 0);
          const oa = a.error ? 0 : 1;
          const ob = b.error ? 0 : 1;
          return ob - oa || pb - pa || nb - na;
        });
        return live[0];
      }

      function settle(job, fallback) {
        if (!job || job.status === "done") return;
        job.status = "done";
        jobs.delete(job.id);
        clearTimeout(job.timer);
        const payload =
          job.expect > 1 ? pickBest(job.replies) : job.replies[0] || fallback || { error: "timeout", value: null };
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
          const pool = painted.length ? painted : takers;
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
              const waitMs = Math.min(60000, Number(body.waitMs) || 20000);
              const id = `c${++seq}`;
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

const FANOUT = new Set(["restage", "run", "load", "reset", "next"]);

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
  const seen = (g.__baySeen ??= new Set());
  const paintInfo = () => {
    const vis = typeof document !== "undefined" ? document.visibilityState : "hidden";
    let nobj = 0;
    try { nobj = (g.__bay?.peek?.().objects || []).length; } catch {}
    const bot = typeof navigator !== "undefined" && navigator.webdriver === true;
    const paint = vis === "visible" && typeof document !== "undefined" && !!document.querySelector("canvas") && !bot;
    return { vis, nobj, paint, bot };
  };
  const takeUrl = () => {
    const p = paintInfo();
    return "/__bay/take?wait=10000&vis=" + encodeURIComponent(p.vis) + "&nobj=" + p.nobj + "&paint=" + (p.paint ? "1" : "0") + "&bot=" + (p.bot ? "1" : "0");
  };
  const run = async (fn, args) => {
    const api = g.__bay;
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
        const p = paintInfo();
        if (seen.has(msg.id)) {
          await fetch("/__bay/done", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: msg.id, skipped: true, paint: p.paint, nobj: p.nobj }),
          });
          continue;
        }
        seen.add(msg.id);
        if (seen.size > 80) {
          const first = seen.values().next().value;
          if (first) seen.delete(first);
        }
        const cap = Math.min(20000, Number(msg.waitMs) || 16000);
        const out = await Promise.race([
          run(String(msg.fn ?? ""), Array.isArray(msg.args) ? msg.args : []),
          new Promise((res) => setTimeout(() => res({ error: "run-timeout" }), cap)),
        ]);
        const after = paintInfo();
        await fetch("/__bay/done", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: msg.id, ...out, paint: after.paint, nobj: after.nobj }),
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
