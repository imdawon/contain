/** Attach to live Chrome DevTools HTTP and count WebGL context-lost console lines. */
const CONTEXT_LOST_RE = /webglrenderer\s+context\s+lost/i;
const CONTAIN_URL_RE = /8080|contain/i;
const CDP_HTTP_MS = 800;
const CDP_LISTEN_MS = 2000;

function uniqPorts() {
  const out = [];
  const env = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT);
  for (const p of [env, 9229, 9222]) {
    if (Number.isFinite(p) && p > 0 && !out.includes(p)) out.push(p);
  }
  return out;
}

async function getJson(url, ms = CDP_HTTP_MS) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
}

export async function discoverCdpPort() {
  for (const port of uniqPorts()) {
    try {
      const ver = await getJson(`http://127.0.0.1:${port}/json/version`);
      if (ver && (ver.Browser || ver.webSocketDebuggerUrl || ver["Protocol-Version"])) return port;
    } catch {
      /* try next */
    }
  }
  return 0;
}

async function listTargets(port) {
  for (const path of ["/json/list", "/json"]) {
    try {
      const rows = await getJson(`http://127.0.0.1:${port}${path}`);
      if (Array.isArray(rows)) return rows;
    } catch {
      /* try next */
    }
  }
  return [];
}

function targetUrl(t) {
  return String(t?.url || "");
}

function isContainTarget(t) {
  return CONTAIN_URL_RE.test(targetUrl(t));
}

function pickContainTab(targets) {
  const rows = Array.isArray(targets) ? targets : [];
  const pages = rows.filter((t) => t && (t.type === "page" || t.type === "iframe" || !t.type));
  return pages.find(isContainTarget) || rows.find(isContainTarget) || null;
}

function textFromRemoteObject(arg) {
  if (arg == null) return "";
  if (typeof arg !== "object") return String(arg);
  if (arg.value != null) return String(arg.value);
  if (arg.description) return String(arg.description);
  if (arg.unserializableValue) return String(arg.unserializableValue);
  if (arg.preview?.description) return String(arg.preview.description);
  try {
    return JSON.stringify(arg);
  } catch {
    return "";
  }
}

function eventBlob(method, params) {
  const parts = [method];
  if (!params || typeof params !== "object") return parts.join(" ");
  if (Array.isArray(params.args)) parts.push(...params.args.map(textFromRemoteObject));
  const entry = params.entry;
  if (entry && typeof entry === "object") {
    if (entry.text) parts.push(String(entry.text));
    if (Array.isArray(entry.args)) parts.push(...entry.args.map(textFromRemoteObject));
    if (entry.message) parts.push(String(entry.message));
  }
  if (params.message && typeof params.message === "object") {
    const m = params.message;
    if (m.text) parts.push(String(m.text));
    if (Array.isArray(m.parameters)) parts.push(...m.parameters.map(textFromRemoteObject));
  }
  if (params.text) parts.push(String(params.text));
  try {
    parts.push(JSON.stringify(params));
  } catch {
    /* ignore */
  }
  return parts.join(" ");
}

function wsUrlFor(tab, port) {
  if (tab?.webSocketDebuggerUrl) return String(tab.webSocketDebuggerUrl);
  const id = tab?.id;
  if (id && port) return `ws://127.0.0.1:${port}/devtools/page/${id}`;
  return "";
}

function listenContextLost(wsUrl) {
  if (!wsUrl || typeof WebSocket === "undefined") {
    return Promise.resolve({ attached: false, contextLostCount: 0 });
  }
  return new Promise((resolve) => {
    let settled = false;
    let id = 0;
    let contextLostCount = 0;
    const seen = new Set();
    const finish = (attached) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ attached, contextLostCount });
    };
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      resolve({ attached: false, contextLostCount: 0 });
      return;
    }
    const note = (method, params) => {
      const blob = eventBlob(method, params);
      if (!CONTEXT_LOST_RE.test(blob)) return;
      const key = blob.slice(0, 400);
      if (seen.has(key)) return;
      seen.add(key);
      contextLostCount += 1;
    };
    const send = (method, params) => {
      id += 1;
      try {
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      } catch {
        /* ignore */
      }
    };
    const timer = setTimeout(() => finish(true), CDP_LISTEN_MS);
    ws.addEventListener("open", () => {
      send("Runtime.enable");
      send("Log.enable");
      send("Console.enable");
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        if (CONTEXT_LOST_RE.test(String(ev.data))) contextLostCount += 1;
        return;
      }
      const method = msg?.method;
      if (method === "Runtime.consoleAPICalled" || method === "Log.entryAdded" || method === "Console.messageAdded") {
        note(method, msg.params);
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      finish(true);
    });
  });
}

export async function probeBayCdp() {
  const cdpPort = await discoverCdpPort();
  if (!(cdpPort > 0)) {
    return {
      cdpPort: 0,
      containTab: false,
      containTabUrl: null,
      contextLostCount: 0,
      attached: false,
    };
  }
  const targets = await listTargets(cdpPort);
  const tab = pickContainTab(targets);
  const containTabUrl = tab ? targetUrl(tab) : null;
  const containTab = Boolean(containTabUrl && CONTAIN_URL_RE.test(containTabUrl));
  if (!containTab) {
    return {
      cdpPort,
      containTab: false,
      containTabUrl: containTabUrl || null,
      contextLostCount: 0,
      attached: false,
    };
  }
  const listened = await listenContextLost(wsUrlFor(tab, cdpPort));
  return {
    cdpPort,
    containTab: true,
    containTabUrl,
    contextLostCount: Number(listened.contextLostCount) || 0,
    attached: listened.attached === true,
  };
}

export function cdpMiss({ cdpPort, containTab, contextLostCount, peekNobj }) {
  if (!(Number(cdpPort) > 0)) return "cdp-no-port";
  if (!containTab) return "cdp-no-contain-tab";
  if (Number(contextLostCount) > 0) return "webgl-context-lost";
  if (!(Number(peekNobj) > 0)) return "nobj-0";
  return null;
}
