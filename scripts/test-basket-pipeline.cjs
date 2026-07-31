#!/usr/bin/env node
/**
 * scripts/test-basket-pipeline.cjs
 *
 * End-to-end test of the basket publishing pipeline against the LOCAL MOCK.
 *
 * Exercises the paths that are expensive to discover in a broker's UAT:
 *   1.  CREATE succeeds, state -> created, broker version 1
 *   2.  No-op when already in sync
 *   3.  REBALANCE after a new version, broker version 2
 *   4.  409 on CREATE  -> reconcile to 'created', re-dispatch as REBALANCED
 *   5.  404 on REBALANCE -> reconcile to 'never_sent', re-dispatch as CREATED
 *   6.  410 is TERMINAL — logged as terminal, never retried
 *   7.  CLOSE succeeds, state -> closed
 *   8.  Dispatch is skipped cleanly when no Bearer token is set
 *
 * SAFETY
 *   - Points broker_connections at 127.0.0.1 for the duration, then RESTORES
 *     the original row on exit (including on failure, via try/finally).
 *   - Touches only broker_basket_state / broker_basket_publish_log and the one
 *     UPSTOX_BASKET connection row. Never writes to positions, calls,
 *     broker_webhook_logs, strategies, or basket_*.
 *   - Creates temporary rebalance versions for the drift tests and deletes
 *     them afterwards.
 *
 * Run (mock must already be running):
 *     node scripts/mock-upstox-basket.cjs &
 *     node scripts/test-basket-pipeline.cjs <STRATEGY_ID>
 */

const { Pool } = require("pg");

const CONN = process.env.DATABASE_URL
  || "postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db";
const MOCK = process.env.MOCK_URL || "http://127.0.0.1:5099";
const BROKER = "UPSTOX_BASKET";
const STRATEGY_ID = process.argv[2];

if (!STRATEGY_ID) {
  console.error("Usage: node scripts/test-basket-pipeline.cjs <STRATEGY_ID>");
  process.exit(1);
}

const pool = new Pool({ connectionString: CONN });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}${detail ? `\n      ${detail}` : ""}`); }
}
function section(t) { console.log(`\n\u2501\u2501 ${t} ${"\u2501".repeat(Math.max(0, 60 - t.length))}`); }

// The dispatcher lives in the built bundle; drive it over HTTP instead so we
// test the REAL route, middleware and all. Requires an admin session cookie.
async function adminCookie() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set in env");
  const crypto = require("crypto");
  const r = await pool.query(`
    SELECT sid FROM sessions
    WHERE (sess::jsonb->>'userId') IN (SELECT id FROM users WHERE role='admin')
      AND expire > NOW()
    ORDER BY expire DESC LIMIT 1`);
  if (!r.rows[0]) throw new Error("No live admin session found. Log into /admin in a browser first.");
  const sid = r.rows[0].sid;
  const sig = crypto.createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return `connect.sid=s%3A${sid}.${encodeURIComponent(sig)}`;
}

async function api(method, path, body, cookie) {
  const res = await fetch(`http://localhost:5001${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body: json ?? text };
}

async function mock(path, method = "GET", body) {
  const res = await fetch(`${MOCK}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function getState() {
  const r = await pool.query(
    `SELECT sync_state, broker_version, last_synced_version, is_enabled, last_error
     FROM broker_basket_state WHERE strategy_id=$1 AND broker_type=$2`,
    [STRATEGY_ID, BROKER]
  );
  return r.rows[0] || null;
}

async function lastLog() {
  const r = await pool.query(
    `SELECT basket_status, status, http_status, error_message, x_request_id
     FROM broker_basket_publish_log
     WHERE strategy_id=$1 AND broker_type=$2
     ORDER BY published_at DESC LIMIT 1`,
    [STRATEGY_ID, BROKER]
  );
  return r.rows[0] || null;
}

async function bumpVersion() {
  // Clone the latest rebalance into a new version so the dispatcher sees drift.
  const cur = await pool.query(
    `SELECT id, version FROM basket_rebalances WHERE strategy_id=$1 ORDER BY version DESC LIMIT 1`,
    [STRATEGY_ID]
  );
  const src = cur.rows[0];
  const ins = await pool.query(
    `INSERT INTO basket_rebalances (strategy_id, version, effective_date, notes)
     VALUES ($1,$2,now(),'[pipeline-test] temporary version') RETURNING id`,
    [STRATEGY_ID, src.version + 1]
  );
  const newId = ins.rows[0].id;
  await pool.query(
    `INSERT INTO basket_constituents
       (strategy_id, rebalance_id, symbol, exchange, weight_percent, quantity, price_at_rebalance, action)
     SELECT strategy_id, $2, symbol, exchange, weight_percent, quantity, price_at_rebalance, action
     FROM basket_constituents WHERE rebalance_id = $1`,
    [src.id, newId]
  );
  return newId;
}

async function dropVersion(id) {
  await pool.query(`DELETE FROM basket_constituents WHERE rebalance_id=$1`, [id]);
  await pool.query(`DELETE FROM basket_rebalances WHERE id=$1`, [id]);
}

(async () => {
  let original = null;
  const tempVersions = [];

  try {
    // ── Redirect the connection at the mock ─────────────────────
    const cur = await pool.query(
      `SELECT id, base_url, vendor_code, vendor_key, token, is_enabled
       FROM broker_connections WHERE broker_type=$1 LIMIT 1`, [BROKER]
    );
    if (!cur.rows[0]) throw new Error(`No broker_connections row for ${BROKER}`);
    original = cur.rows[0];

    console.log(`Redirecting ${BROKER} -> ${MOCK} (original will be restored)`);
    await pool.query(
      `UPDATE broker_connections
       SET base_url=$1, token=$2, vendor_code=$3, vendor_key=$4, is_enabled=true
       WHERE id=$5`,
      [MOCK, "mock-test-token", "ALPMKT", "alphamarket", original.id]
    );

    const cookie = await adminCookie();
    await mock("/__mock/reset", "POST");
    await pool.query(
      `DELETE FROM broker_basket_state WHERE strategy_id=$1 AND broker_type=$2`,
      [STRATEGY_ID, BROKER]
    );

    // Enable the basket
    await api("POST", `/api/admin/baskets/${STRATEGY_ID}/enable`, { broker: BROKER, enabled: true }, cookie);

    // ── 1. CREATE ───────────────────────────────────────────────
    section("1. CREATE");
    let r = await api("POST", `/api/admin/baskets/${STRATEGY_ID}/publish`, { broker: BROKER }, cookie);
    check("dispatch succeeded", r.body?.outcome?.status === "success", JSON.stringify(r.body?.reason));
    check("lifecycle was CREATE", r.body?.lifecycle === "CREATE", `got ${r.body?.lifecycle}`);
    let st = await getState();
    check("sync_state = created", st?.sync_state === "created", `got ${st?.sync_state}`);
    check("broker_version = 1", Number(st?.broker_version) === 1, `got ${st?.broker_version}`);
    let lg = await lastLog();
    check("logged as success", lg?.status === "success", `got ${lg?.status}`);
    check("X-Request-Id recorded", !!lg?.x_request_id);

    // ── 2. No-op ────────────────────────────────────────────────
    section("2. Already in sync -> NOOP");
    r = await api("POST", `/api/admin/baskets/${STRATEGY_ID}/publish`, { broker: BROKER }, cookie);
    check("lifecycle NOOP", r.body?.lifecycle === "NOOP", `got ${r.body?.lifecycle}`);
    check("nothing sent", r.body?.outcome === null);

    // ── 3. REBALANCE ────────────────────────────────────────────
    section("3. New version -> REBALANCE");
    const v2 = await bumpVersion(); tempVersions.push(v2);
    r = await api("POST", `/api/admin/baskets/${STRATEGY_ID}/publish`, { broker: BROKER }, cookie);
    check("dispatch succeeded", r.body?.outcome?.status === "success", JSON.stringify(r.body?.reason));
    check("lifecycle was REBALANCE", r.body?.lifecycle === "REBALANCE", `got ${r.body?.lifecycle}`);
    st = await getState();
    check("broker_version = 2", Number(st?.broker_version) === 2, `got ${st?.broker_version}`);

    // ── 4. 409 reconciliation ───────────────────────────────────
    section("4. 409 on CREATE -> reconcile -> REBALANCED");
    // Force our state backwards: we think it was never sent, broker has it.
    await pool.query(
      `UPDATE broker_basket_state SET sync_state='never_sent', last_synced_version=NULL
       WHERE strategy_id=$1 AND broker_type=$2`, [STRATEGY_ID, BROKER]
    );
    r = await api("POST", `/api/admin/baskets/${STRATEGY_ID}/publish`, { broker: BROKER }, cookie);
    check("reconciled flag set", r.body?.reconciled === true, JSON.stringify(r.body?.reason));
    check("ended in success", r.body?.outcome?.status === "success", JSON.stringify(r.body?.reason));
    st = await getState();
    check("sync_state back to created", st?.sync_state === "created", `got ${st?.sync_state}`);

    // ── 5. 404 reconciliation ───────────────────────────────────
    section("5. 404 on REBALANCE -> reconcile -> CREATED");
    await mock("/__mock/reset", "POST");                    // broker forgets everything
    const v3 = await bumpVersion(); tempVersions.push(v3);  // we think we're ahead
    r = await api("POST", `/api/admin/baskets/${STRATEGY_ID}/publish`, { broker: BROKER }, cookie);
    check("reconciled flag set", r.body?.reconciled === true, JSON.stringify(r.body?.reason));
    check("ended in success", r.body?.outcome?.status === "success", JSON.stringify(r.body?.reason));
    const ms = await mock("/__mock/state");
    check("broker has basket at v1", ms.baskets?.[0]?.version === 1, JSON.stringify(ms.baskets));

    // ── 6. 410 is terminal ──────────────────────────────────────
    section("6. 410 -> TERMINAL, never retried");
    await mock("/__mock/fail-next", "POST", { status: 410 });
    const v4 = await bumpVersion(); tempVersions.push(v4);
    r = await api("POST", `/api/admin/baskets/${STRATEGY_ID}/publish`, { broker: BROKER }, cookie);
    check("outcome is terminal", r.body?.outcome?.status === "terminal", `got ${r.body?.outcome?.status}`);
    lg = await lastLog();
    check("logged status = terminal", lg?.status === "terminal", `got ${lg?.status}`);
    check("logged http 410", Number(lg?.http_status) === 410, `got ${lg?.http_status}`);
    check("NOT logged as retryable", lg?.status !== "retryable");

    // ── 7. CLOSE ────────────────────────────────────────────────
    section("7. CLOSE");
    r = await api("POST", `/api/admin/baskets/${STRATEGY_ID}/publish`,
      { broker: BROKER, force: "CLOSE", ignoreEnabled: true }, cookie);
    check("dispatch succeeded", r.body?.outcome?.status === "success", JSON.stringify(r.body?.reason));
    st = await getState();
    check("sync_state = closed", st?.sync_state === "closed", `got ${st?.sync_state}`);

    // ── 8. No token -> skipped ──────────────────────────────────
    section("8. No Bearer token -> skipped cleanly");
    await pool.query(`UPDATE broker_connections SET token=NULL WHERE id=$1`, [original.id]);
    await pool.query(
      `UPDATE broker_basket_state SET sync_state='never_sent' WHERE strategy_id=$1 AND broker_type=$2`,
      [STRATEGY_ID, BROKER]
    );
    r = await api("POST", `/api/admin/baskets/${STRATEGY_ID}/publish`, { broker: BROKER }, cookie);
    check("outcome is skipped", r.body?.outcome?.status === "skipped", `got ${r.body?.outcome?.status}`);
    check("reason mentions token", /token/i.test(r.body?.outcome?.reason || ""), r.body?.outcome?.reason);

    // ── Request trace ───────────────────────────────────────────
    section("Mock request trace");
    const rq = await mock("/__mock/requests");
    for (const q of rq.requests) {
      console.log(`  ${String(q.result).padEnd(3)} ${String(q.basketStatus || "-").padEnd(11)} legs=${String(q.legs).padEnd(3)} ${q.requestId}`);
    }
    check("every request carried X-Request-Id", rq.requests.every(q => !!q.requestId));
    check("every request carried Bearer", rq.requests.every(q => q.hasBearer));
    check("every request carried X-Vendor-Id", rq.requests.every(q => !!q.vendorId));

  } catch (e) {
    fail++;
    console.error("\nFATAL:", e.message);
  } finally {
    // ── Restore ─────────────────────────────────────────────────
    section("Cleanup");
    for (const id of tempVersions.reverse()) {
      try { await dropVersion(id); } catch (e) { console.error("  temp version cleanup failed:", e.message); }
    }
    console.log(`  removed ${tempVersions.length} temporary rebalance version(s)`);

    if (original) {
      await pool.query(
        `UPDATE broker_connections
         SET base_url=$1, token=$2, vendor_code=$3, vendor_key=$4, is_enabled=$5
         WHERE id=$6`,
        [original.base_url, original.token, original.vendor_code, original.vendor_key,
         original.is_enabled, original.id]
      );
      console.log(`  restored broker_connections -> ${original.base_url} (token ${original.token ? "present" : "NULL"})`);
    }
    await pool.query(
      `DELETE FROM broker_basket_state WHERE strategy_id=$1 AND broker_type=$2`,
      [STRATEGY_ID, BROKER]
    );
    console.log("  cleared test sync state");
    console.log("\n  NOTE: broker_basket_publish_log rows are append-only by design and remain.");
    console.log("        They are tagged with the mock's X-Request-Ids.");

    console.log(`\n${"=".repeat(64)}`);
    console.log(`  PASS: ${pass}   FAIL: ${fail}`);
    console.log(`${"=".repeat(64)}\n`);

    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  }
})();
