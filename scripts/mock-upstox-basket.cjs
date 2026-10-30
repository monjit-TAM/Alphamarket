#!/usr/bin/env node
/**
 * scripts/mock-upstox-basket.cjs
 *
 * A local stand-in for the Upstox Vendor Equity Basket API.
 *
 * WHY: we must prove the whole pipeline — CREATE / REBALANCE / CLOSE, the
 * 409 and 404 reconciliation hops, and that a 410 is treated as terminal and
 * never retried — BEFORE any byte reaches Upstox. Discovering a state-machine
 * bug in their UAT costs credibility; discovering it here costs nothing.
 *
 * It implements the spec's documented behaviour as literally as possible:
 *   - POST /advisory/v2/{vendorName}/equity-baskets
 *   - Bearer token + X-Vendor-Id + X-Request-Id required
 *   - basketStatus drives the operation
 *   - 409 duplicate CREATE, 404 missing basket on MODIFY/REBALANCE/CLOSE
 *   - 410 for weight-sum != 1.0 (tol 0.0001) and for non-BUY legs on CREATE
 *   - 500 for non-numeric / missing minInvestment on CREATE  <-- the nasty one
 *   - version: CREATED=1, REBALANCED=+1, CLOSED=+1, MODIFIED=unchanged
 *
 * State is in-memory. Restart = clean slate.
 *
 * Run:      node scripts/mock-upstox-basket.cjs [port]
 * Default:  http://127.0.0.1:5099
 *
 * Fault injection (for exercising the dispatcher's error paths):
 *   POST /__mock/fail-next  { "status": 500 }   -> next basket call returns that status
 *   POST /__mock/reset                          -> wipe all baskets + faults
 *   GET  /__mock/state                          -> dump current baskets
 *   GET  /__mock/requests                       -> every request received, in order
 *
 * This file is a DEV TOOL. It is never imported by the app and never runs in
 * production. It listens on loopback only.
 */

const http = require("http");

const PORT = Number(process.argv[2] || 5099);
const EXPECTED_TOKEN = process.env.MOCK_EXPECT_TOKEN || null; // null = accept any non-empty

const baskets = new Map(); // id -> { version, status, payload, history: [] }
const requests = [];
let failNext = null;

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) });
  res.end(json);
}

function ok(data) {
  return { success: true, data, error: null };
}

function err(message) {
  return { success: false, data: null, error: { message } };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", c => { buf += c; if (buf.length > 5e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(buf ? JSON.parse(buf) : {}); }
      catch (e) { reject(new Error("Malformed JSON body")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // ── Mock control plane ────────────────────────────────────────
  if (url.pathname === "/__mock/reset" && req.method === "POST") {
    baskets.clear(); requests.length = 0; failNext = null;
    return send(res, 200, { ok: true, message: "Mock reset" });
  }
  if (url.pathname === "/__mock/state") {
    return send(res, 200, {
      baskets: Array.from(baskets.entries()).map(([id, b]) => ({
        id, version: b.version, status: b.status, legs: b.payload?.orders?.length ?? 0,
        history: b.history,
      })),
    });
  }
  if (url.pathname === "/__mock/requests") {
    return send(res, 200, { count: requests.length, requests });
  }
  if (url.pathname === "/__mock/fail-next" && req.method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    failNext = Number(body.status) || 500;
    return send(res, 200, { ok: true, failNext });
  }

  // ── The real endpoint ─────────────────────────────────────────
  const m = url.pathname.match(/^\/advisory\/v2\/([^/]+)\/equity-baskets\/?$/);
  if (!m) return send(res, 404, err(`No route for ${req.method} ${url.pathname}`));
  if (req.method !== "POST") return send(res, 405, err("Method not allowed"));

  const vendorName = m[1];
  const auth = req.headers["authorization"] || "";
  const vendorId = req.headers["x-vendor-id"] || "";
  const requestId = req.headers["x-request-id"] || "";

  let payload;
  try { payload = await readBody(req); }
  catch (e) { return send(res, 400, err(e.message)); }

  const record = {
    at: new Date().toISOString(),
    vendorName, vendorId, requestId,
    hasBearer: /^Bearer\s+\S+/.test(auth),
    basketStatus: payload?.basketStatus,
    id: payload?.id,
    legs: payload?.orders?.length ?? 0,
  };
  requests.push(record);

  // ── Auth (gateway layer per the spec) ─────────────────────────
  if (!/^Bearer\s+\S+/.test(auth)) {
    record.result = 401;
    return send(res, 401, err("Missing or malformed Authorization bearer token"));
  }
  if (EXPECTED_TOKEN && auth !== `Bearer ${EXPECTED_TOKEN}`) {
    record.result = 401;
    return send(res, 401, err("Invalid bearer token"));
  }
  if (!vendorId) {
    record.result = 401;
    return send(res, 401, err("Missing X-Vendor-Id"));
  }
  if (!requestId) {
    // Spec marks X-Request-Id required. Enforce it — if we ever forget to send
    // it, we want to fail here rather than lose our only support handle.
    record.result = 400;
    return send(res, 400, err("Missing X-Request-Id"));
  }

  // ── Injected fault ────────────────────────────────────────────
  if (failNext) {
    const s = failNext; failNext = null;
    record.result = s;
    return send(res, s, err(`Injected fault: HTTP ${s}`));
  }

  const { id, basketStatus, orders } = payload || {};
  if (!id) { record.result = 400; return send(res, 400, err("Missing basket id")); }

  const VALID = ["CREATED", "MODIFIED", "REBALANCED", "CLOSED"];
  if (!VALID.includes(basketStatus)) {
    record.result = 400;
    return send(res, 400, err(`Unsupported basketStatus: ${basketStatus}`));
  }

  const existing = baskets.get(id);

  // ── CLOSED ────────────────────────────────────────────────────
  if (basketStatus === "CLOSED") {
    if (!existing) {
      record.result = 404;
      return send(res, 404, err(`No basket to close for vendorId=${vendorId}, vendorBasketId=${id}`));
    }
    existing.version += 1;
    existing.status = "CLOSED";
    existing.history.push({ at: record.at, op: "CLOSED", version: existing.version });
    record.result = 200;
    return send(res, 200, ok({ vendorBasketId: id, version: existing.version, basketStatus: "CLOSED" }));
  }

  // ── Weight sum (CREATED / MODIFIED / REBALANCED) ──────────────
  // Spec: must equal exactly 1.0, tolerance +/-0.0001 -> HTTP 410.
  const list = Array.isArray(orders) ? orders : [];
  const sum = list.reduce((a, o) => a + Number(o?.weight || 0), 0);
  if (Math.abs(sum - 1.0) > 0.0001) {
    record.result = 410;
    return send(res, 410, err(`Order weights must sum to 1.0, got: ${sum.toFixed(6)}`));
  }

  // ── BUY-only on CREATED ───────────────────────────────────────
  if (basketStatus === "CREATED") {
    const bad = list.find(o => String(o?.direction).toUpperCase() !== "BUY");
    if (bad) {
      record.result = 410;
      return send(res, 410, err(`All orders must be BUY for basket creation, found: ${bad.direction} for symbol ${bad.symbol}`));
    }
  }

  // ── Segment resolution ────────────────────────────────────────
  // Spec: only NSE_EQ resolves. Anything else silently fails to match, which
  // in practice means the instrument can't be found.
  const badSeg = list.find(o => o?.segment !== "NSE_EQ");
  if (badSeg) {
    record.result = 410;
    return send(res, 410, err(`Unresolvable segment "${badSeg.segment}" for symbol ${badSeg.symbol}`));
  }

  const noToken = list.find(o => o?.exchangeToken == null || Number.isNaN(Number(o.exchangeToken)));
  if (noToken) {
    record.result = 410;
    return send(res, 410, err(`Missing or invalid exchangeToken for symbol ${noToken.symbol}`));
  }

  // ── CREATED ───────────────────────────────────────────────────
  if (basketStatus === "CREATED") {
    // minInvestment: spec says a non-numeric or missing value returns HTTP 500
    // rather than a clean validation error. Reproduced deliberately — this is
    // exactly the trap that would make a naive retry worker loop forever.
    const mi = payload.minInvestment;
    if (mi == null || String(mi).trim() === "" || !/^\d+(\.\d+)?$/.test(String(mi))) {
      record.result = 500;
      return send(res, 500, err("Error while processing vendor basket"));
    }
    if (!payload.rationale || !String(payload.rationale).trim()) {
      record.result = 400;
      return send(res, 400, err("rationale is required"));
    }
    if (!payload.raDetails || !payload.raDetails.raId || !payload.raDetails.raName) {
      record.result = 400;
      return send(res, 400, err("raDetails.raId and raDetails.raName are required for CREATED"));
    }

    if (existing) {
      record.result = 409;
      return send(res, 409, err(`Basket already exists for vendorId=${vendorId}, vendorBasketId=${id}`));
    }

    baskets.set(id, {
      version: 1,
      status: "CREATED",
      payload,
      history: [{ at: record.at, op: "CREATED", version: 1 }],
    });
    record.result = 200;
    return send(res, 200, ok({ vendorBasketId: id, version: 1, basketStatus: "CREATED" }));
  }

  // ── MODIFIED / REBALANCED ─────────────────────────────────────
  if (!existing) {
    const verb = basketStatus === "MODIFIED" ? "modify" : "rebalance";
    record.result = 404;
    return send(res, 404, err(`No basket to ${verb} for vendorId=${vendorId}, vendorBasketId=${id}`));
  }

  if (basketStatus === "MODIFIED") {
    existing.payload = payload;            // in-place, version unchanged
    existing.history.push({ at: record.at, op: "MODIFIED", version: existing.version });
    record.result = 200;
    return send(res, 200, ok({ vendorBasketId: id, version: existing.version, basketStatus: "MODIFIED" }));
  }

  // REBALANCED
  existing.version += 1;
  existing.payload = payload;
  existing.status = "REBALANCED";
  existing.history.push({ at: record.at, op: "REBALANCED", version: existing.version });
  record.result = 200;
  return send(res, 200, ok({ vendorBasketId: id, version: existing.version, basketStatus: "REBALANCED" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-upstox-basket] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-upstox-basket] endpoint: POST /advisory/v2/{vendorName}/equity-baskets`);
  console.log(`[mock-upstox-basket] control:  /__mock/state | /__mock/requests | /__mock/reset | /__mock/fail-next`);
});
