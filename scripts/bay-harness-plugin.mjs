/**
 * Dev-only `/__bay` pipe. The live page polls `/__bay/take` and runs
 * `window.__bay[fn](...args)`. Agents call the same API with
 * `node scripts/bay.mjs peek` — no second browser.
 */
export function bayHarnessPlugin() {
  return {
    name: "contain:bay-harness",
    apply: "serve",
    configureServer(server) {
      /** @type {Map<string, Job>} */
      const jobs = new Map();
      /** @type {{ res: import("node:http").ServerResponse, timer: NodeJS.Timeout }[]} */
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

      function pair() {
        while (takers.length) {
          const open = [...jobs.values()].find((j) => j.status === "open");
          if (!open) return;
          const taker = takers.shift();
          if (!taker || taker.res.writableEnded) continue;
          clearTimeout(taker.timer);
          open.status = "out";
          sendJson(taker.res, 200, { id: open.id, fn: open.fn, args: open.args });
        }
      }

      function finish(id, payload) {
        const job = jobs.get(id);
        if (!job || job.status === "done") return;
        job.status = "done";
        jobs.delete(id);
        clearTimeout(job.timer);
        job.resolve(payload);
      }

      if (typeof server.hot?.on === "function") {
        server.hot.on("bay:return", (payload) => {
          if (payload?.id) finish(String(payload.id), { value: payload.value ?? null, error: payload.error ?? null });
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
          sendJson(res, 200, { ok: true, takers: takers.length, jobs: jobs.size, clients: clientCount() });
          return;
        }

        if (pathOnly === "/__bay/take" && method === "GET") {
          const wait = Math.min(30000, Number(new URL(req.url ?? "", "http://127.0.0.1").searchParams.get("wait")) || 10000);
          const open = [...jobs.values()].find((j) => j.status === "open");
          if (open) {
            open.status = "out";
            sendJson(res, 200, { id: open.id, fn: open.fn, args: open.args });
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
          takers.push({ res, timer });
          req.on("close", () => {
            clearTimeout(timer);
            const i = takers.findIndex((t) => t.res === res);
            if (i >= 0) takers.splice(i, 1);
          });
          return;
        }

        if (pathOnly === "/__bay/done" && method === "POST") {
          readBody(req)
            .then((body) => {
              finish(String(body.id ?? ""), { value: body.value ?? null, error: body.error ?? null });
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
                  jobs.delete(id);
                  resolve({ error: "timeout", value: null });
                }, waitMs);
                jobs.set(id, { id, fn, args, status: "open", resolve, timer });
                try {
                  if (typeof server.hot?.send === "function") server.hot.send("bay:call", { id, fn, args });
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

/** @typedef {{ id: string, fn: string, args: unknown[], status: "open" | "out" | "done", resolve: (v: { value?: unknown, error?: string | null }) => void, timer: NodeJS.Timeout }} Job */

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
