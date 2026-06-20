/**
 * server/nextra-simulator.ts
 * 
 * TEST ONLY — Simulates Nextra OAuth + Trade APIs for end-to-end testing.
 * Provides:
 *   /auth/nextra/simulator — Mock broker app with "Login" button
 *   /auth/nextra/mock/GenAcsTok — Returns fake access token
 *   /auth/nextra/mock/UserDetails — Returns fake user details
 *   /auth/nextra/mock/PlaceOrder — Returns fake order number
 *   /auth/nextra/mock/OrderBook — Returns empty order book
 *   /auth/nextra/mock/PositionBook — Returns empty positions
 *   /auth/nextra/mock/Holdings — Returns empty holdings
 *   /auth/nextra/mock/ModifyOrder — Returns success
 *   /auth/nextra/mock/CancelOrder — Returns success
 * 
 * COMPLETELY INDEPENDENT — zero impact on production systems.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import type { Express } from "express";

export function registerNextraSimulator(app: Express) {

  // Store mock tokens
  const mockTokens = new Map<string, { uid: string; code: string }>();
  let mockOrderCounter = 1000;

  // ─── Simulator UI ──────────────────────────────────────────

  app.get("/auth/nextra/simulator", (_req: any, res: any) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nextra Simulator - Test Environment</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,system-ui,sans-serif;background:#0f1923;color:#e0e0e0;min-height:100vh;display:flex;flex-direction:column}
  .header{background:#1a2634;padding:16px 24px;border-bottom:1px solid #2a3a4a;display:flex;align-items:center;gap:12px}
  .header h1{font-size:18px;color:#4fc3f7} .header span{font-size:12px;color:#ff9800;background:#3e2723;padding:2px 8px;border-radius:4px}
  .main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px}
  .card{background:#1a2634;border-radius:12px;padding:32px;width:100%;max-width:480px;border:1px solid #2a3a4a}
  .card h2{font-size:20px;margin-bottom:8px} .card p{color:#90a4ae;font-size:14px;margin-bottom:24px}
  .field{margin-bottom:16px} .field label{display:block;font-size:12px;color:#78909c;margin-bottom:4px}
  .field input,.field select{width:100%;padding:10px 12px;border-radius:6px;border:1px solid #2a3a4a;background:#0f1923;color:#e0e0e0;font-size:14px}
  .btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px}
  .btn-primary{background:#4fc3f7;color:#0f1923} .btn-primary:hover{background:#29b6f6}
  .btn-secondary{background:#2a3a4a;color:#e0e0e0;margin-top:12px} .btn-secondary:hover{background:#37474f}
  .info{background:#0d2137;border:1px solid #1565c0;border-radius:8px;padding:16px;margin-top:24px;font-size:12px;line-height:1.6}
  .info code{background:#1a2634;padding:2px 6px;border-radius:3px;color:#4fc3f7}
  .step{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #2a3a4a}
  .step-num{width:28px;height:28px;border-radius:50%;background:#1565c0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
  .step-text{font-size:13px;line-height:1.5} .step-text strong{color:#4fc3f7}
  .status{margin-top:16px;padding:12px;border-radius:6px;font-size:13px;display:none}
  .status.show{display:block} .status.ok{background:#1b5e20;border:1px solid #4caf50} .status.err{background:#b71c1c;border:1px solid #f44336}
  .embed-frame{width:100%;height:600px;border:2px solid #4fc3f7;border-radius:8px;margin-top:24px;background:#fff}
</style></head><body>
<div class="header"><h1>Nextra Trading Platform</h1><span>SIMULATOR / TEST</span></div>
<div class="main">
  <div class="card" id="loginCard">
    <h2>Broker Login</h2>
    <p>Simulate a broker user logging into Nextra and accessing AlphaMarket advisory.</p>
    <div class="field"><label>User ID</label><input id="uid" value="TESTUSER01" /></div>
    <div class="field"><label>User Name</label><input id="uname" value="Test Investor" /></div>
    <div class="field"><label>Email</label><input id="email" value="test@nextra-sim.com" /></div>
    <div class="field"><label>Broker Name</label><input id="brkname" value="SIMBROKER" /></div>
    <div class="field"><label>Phone</label><input id="phone" value="9876543210" /></div>
    <button class="btn btn-primary" onclick="doLogin()">Login & Connect to AlphaMarket</button>
    <button class="btn btn-secondary" onclick="doDirectEmbed()">Direct Embed (Skip OAuth)</button>
    <div class="status" id="status"></div>
    <div class="info">
      <strong>How this works:</strong>
      <div class="step"><div class="step-num">1</div><div class="step-text">Click <strong>Login</strong> — simulates Nextra OAuth login</div></div>
      <div class="step"><div class="step-num">2</div><div class="step-text">Generates auth code, redirects to <strong>/auth/nextra/callback</strong></div></div>
      <div class="step"><div class="step-num">3</div><div class="step-text">Callback exchanges code via mock <strong>GenAcsTok</strong></div></div>
      <div class="step"><div class="step-num">4</div><div class="step-text">Shadow user created, session started, <strong>dashboard loads</strong></div></div>
      <div class="step" style="border:none"><div class="step-num">5</div><div class="step-text">You can then <strong>execute test trades</strong> from the dashboard</div></div>
    </div>
  </div>
  <div class="card" id="embedCard" style="display:none;max-width:1200px">
    <h2>AlphaMarket Embedded <span style="font-size:12px;color:#ff9800">(inside Nextra WebView)</span></h2>
    <p id="embedInfo"></p>
    <button class="btn btn-secondary" onclick="location.reload()">Back to Login</button>
    <iframe id="embedFrame" class="embed-frame"></iframe>
  </div>
</div>
<script>
async function doLogin() {
  const st = document.getElementById("status");
  st.className = "status show ok"; st.textContent = "Generating auth code...";
  try {
    const r = await fetch("/auth/nextra/mock/generate-code", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ uid: document.getElementById("uid").value, uname: document.getElementById("uname").value, email: document.getElementById("email").value, brkname: document.getElementById("brkname").value, phone: document.getElementById("phone").value })
    });
    const d = await r.json();
    if (d.code) {
      st.textContent = "Code: " + d.code + " — Redirecting to callback...";
      setTimeout(() => { window.location.href = "/auth/nextra/callback?code=" + d.code; }, 1000);
    } else { st.className = "status show err"; st.textContent = "Error: " + (d.message || "Unknown"); }
  } catch(e) { st.className = "status show err"; st.textContent = "Error: " + e.message; }
}
async function doDirectEmbed() {
  const st = document.getElementById("status");
  st.className = "status show ok"; st.textContent = "Creating direct session...";
  try {
    const r = await fetch("/auth/nextra/mock/direct-session", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ uid: document.getElementById("uid").value, uname: document.getElementById("uname").value, email: document.getElementById("email").value, brkname: document.getElementById("brkname").value, phone: document.getElementById("phone").value })
    });
    const d = await r.json();
    if (d.embedUrl) {
      document.getElementById("loginCard").style.display = "none";
      document.getElementById("embedCard").style.display = "block";
      document.getElementById("embedInfo").textContent = "Session: " + d.token.slice(0,20) + "... | User: " + d.uid;
      document.getElementById("embedFrame").src = d.embedUrl;
    } else { st.className = "status show err"; st.textContent = "Error: " + (d.message || "Unknown"); }
  } catch(e) { st.className = "status show err"; st.textContent = "Error: " + e.message; }
}
</script></body></html>`);
  });

  // ─── Mock OAuth Endpoints ──────────────────────────────────

  // Generate a mock auth code (simulates Nextra OAuth redirect)
  app.post("/auth/nextra/mock/generate-code", (req: any, res: any) => {
    const { uid, uname, email, brkname, phone } = req.body;
    const code = randomBytes(16).toString("hex");
    const token = "mock_" + randomBytes(24).toString("hex");
    mockTokens.set(code, { uid: uid || "TESTUSER", code });
    // Also store user details for UserDetails endpoint
    mockTokens.set("user_" + (uid || "TESTUSER"), { uid, code } as any);
    (mockTokens as any).set("details_" + token, { uid, uname, email, brkname, phone });
    (mockTokens as any).set("token_for_" + code, token);
    console.log("[Nextra Sim] Generated code:", code.slice(0,8) + "... for uid:", uid);
    res.json({ code, message: "Redirect to /auth/nextra/callback?code=" + code });
  });

  // Mock GenAcsTok — exchange code for token
  // Need express.text() for text/plain bodies
  app.use("/auth/nextra/mock/GenAcsTok", (req: any, _res: any, next: any) => {
    if (req.headers["content-type"]?.includes("text/plain") && !req.body) {
      let data = ""; req.on("data", (c: any) => data += c); req.on("end", () => { req.body = data; next(); });
    } else { next(); }
  });
  app.post("/auth/nextra/mock/GenAcsTok", (req: any, res: any) => {
    const bodyStr = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    let code = "", checksum = "";
    try {
      const raw = bodyStr.startsWith("jData=") ? bodyStr.slice(6) : bodyStr;
      const parsed = JSON.parse(raw || "{}");
      code = parsed.code || "";
      checksum = parsed.checksum || "";
    } catch { /* ignore parse errors */ }
    console.log("[Nextra Sim] GenAcsTok body:", bodyStr.slice(0, 80));

    const stored = mockTokens.get(code);
    if (!stored) {
      console.log("[Nextra Sim] GenAcsTok: invalid code");
      return res.json({ stat: "Not_Ok", emsg: "Invalid code" });
    }

    const token = (mockTokens as any).get("token_for_" + code) || "mock_" + randomBytes(24).toString("hex");
    console.log("[Nextra Sim] GenAcsTok: success for uid:", stored.uid);
    res.json({
      stat: "Ok",
      susertoken: token,
      uid: stored.uid,
      actid: stored.uid,
      request_time: new Date().toLocaleString(),
    });
  });

  // Mock UserDetails
  app.use("/auth/nextra/mock/UserDetails", (req: any, _res: any, next: any) => {
    if (req.headers["content-type"]?.includes("text/plain") && !req.body) {
      let data = ""; req.on("data", (c: any) => data += c); req.on("end", () => { req.body = data; next(); });
    } else { next(); }
  });
  app.post("/auth/nextra/mock/UserDetails", (req: any, res: any) => {
    const auth = req.headers.authorization || "";
    const token = auth.replace("Bearer ", "");
    const details = (mockTokens as any).get("details_" + token);

    res.json({
      stat: "Ok",
      uid: details?.uid || "TESTUSER",
      uname: details?.uname || "Test User",
      email: details?.email || "test@nextra-sim.com",
      m_num: details?.phone || "9876543210",
      brkname: details?.brkname || "SIMBROKER",
      cname: details?.uname || "Test User",
      access_type: ["IT", "MOB", "WEB", "API"],
      exarr: ["NSE", "NFO", "BSE", "MCX"],
      request_time: new Date().toLocaleString(),
    });
  });

  // Mock PlaceOrder
  app.use("/auth/nextra/mock/PlaceOrder", (req: any, _res: any, next: any) => {
    if (req.headers["content-type"]?.includes("text/plain") && !req.body) {
      let data = ""; req.on("data", (c: any) => data += c); req.on("end", () => { req.body = data; next(); });
    } else { next(); }
  });
  app.post("/auth/nextra/mock/PlaceOrder", (req: any, res: any) => {
    mockOrderCounter++;
    const ordno = "SIM" + String(mockOrderCounter).padStart(10, "0");
    console.log("[Nextra Sim] PlaceOrder:", ordno);
    res.json({ stat: "Ok", norenordno: ordno, request_time: new Date().toLocaleString() });
  });

  // Mock ModifyOrder
  app.post("/auth/nextra/mock/ModifyOrder", (_req: any, res: any) => {
    res.json({ stat: "Ok", result: "success", request_time: new Date().toLocaleString() });
  });

  // Mock CancelOrder
  app.post("/auth/nextra/mock/CancelOrder", (_req: any, res: any) => {
    res.json({ stat: "Ok", result: "success", request_time: new Date().toLocaleString() });
  });

  // Mock OrderBook
  app.post("/auth/nextra/mock/OrderBook", (_req: any, res: any) => {
    res.json([]);
  });

  // Mock PositionBook
  app.post("/auth/nextra/mock/PositionBook", (_req: any, res: any) => {
    res.json([]);
  });

  // Mock Holdings
  app.post("/auth/nextra/mock/Holdings", (_req: any, res: any) => {
    res.json([]);
  });

  // ─── Direct Session (bypass OAuth for quick testing) ───────

  app.post("/auth/nextra/mock/direct-session", async (req: any, res: any) => {
    try {
      const { uid, uname, email, brkname, phone } = req.body;
      // Find NOREN partner
      const pcResult = await db.execute(sql`SELECT id FROM partner_configs WHERE partner_name = 'NOREN' LIMIT 1`);
      const partnerId = (pcResult.rows as any[])[0]?.id;
      if (!partnerId) return res.status(500).json({ message: "NOREN partner not configured" });

      // Create shadow user
      const suResult = await db.execute(sql`
        INSERT INTO partner_shadow_users (id, partner_id, hashed_key, broker_id, uid, email, display_name, phone, broker_name, access_token, last_seen)
        VALUES (gen_random_uuid(), ${partnerId}, ${uid || "test"}, ${brkname || "SIMBROKER"}, ${uid || "test"}, ${email || null}, ${uname || null}, ${phone || null}, ${brkname || null}, ${"mock_direct_" + randomBytes(16).toString("hex")}, NOW())
        ON CONFLICT (hashed_key, broker_id) DO UPDATE SET uid=${uid}, email=COALESCE(${email}, partner_shadow_users.email), display_name=COALESCE(${uname}, partner_shadow_users.display_name), access_token=${"mock_direct_" + randomBytes(16).toString("hex")}, last_seen=NOW()
        RETURNING id
      `);
      const shadowUserId = (suResult.rows as any[])[0].id;

      // Create session
      const token = "nst_" + randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.execute(sql`INSERT INTO partner_sessions (id, token, shadow_user_id, partner_id, product, expires_at) VALUES (gen_random_uuid(), ${token}, ${shadowUserId}, ${partnerId}, 'alphamarket', ${expiresAt})`);

      console.log("[Nextra Sim] Direct session created for:", uid);
      res.json({ status: "success", token, uid, embedUrl: "/embed?token=" + token });
    } catch (err: any) {
      console.error("[Nextra Sim] Direct session error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  console.log("[Nextra Sim] Simulator routes registered: /auth/nextra/simulator");
}
