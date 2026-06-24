/**
 * server/nextra-trade.ts
 * Nextra/Kambala Trade Execution Engine.
 * MANUAL execution only. COMPLETELY INDEPENDENT of webhooks/Upstox/Dreamstreet/XTS.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";
import type { Express } from "express";

async function nextraPost(apiUrl: string, endpoint: string, accessToken: string, jData: any): Promise<any> {
  const url = apiUrl + "/" + endpoint;
  const body = "jData=" + JSON.stringify(jData);
  console.log("[Nextra Trade] POST", endpoint, "uid:", jData.uid || "?");
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain", "Authorization": "Bearer " + accessToken }, body });
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { stat: "Not_Ok", emsg: "Invalid response" }; }
}

async function validateSession(token: string): Promise<any> {
  const result = await db.execute(sql`SELECT ps.shadow_user_id, ps.partner_id, psu.uid, psu.access_token, pc.sso_api_url FROM partner_sessions ps JOIN partner_shadow_users psu ON psu.id = ps.shadow_user_id JOIN partner_configs pc ON pc.id = ps.partner_id WHERE ps.token = ${token} AND ps.expires_at > NOW() LIMIT 1`);
  return (result.rows as any[])[0] || null;
}

async function logOrder(p: any): Promise<string> {
  const result = await db.execute(sql`INSERT INTO nextra_orders (shadow_user_id, partner_id, norenordno, exch, tsym, symbol, qty, prc, trgprc, prd, trantype, prctyp, ret, call_id, position_id, strategy_id, status, order_response, error_message, remarks, executed_at) VALUES (${p.shadowUserId}, ${p.partnerId}, ${p.norenordno||null}, ${p.exch}, ${p.tsym}, ${p.symbol||null}, ${p.qty}, ${p.prc||null}, ${p.trgprc||null}, ${p.prd}, ${p.trantype}, ${p.prctyp}, ${p.ret}, ${p.callId||null}, ${p.positionId||null}, ${p.strategyId||null}, ${p.status}, ${JSON.stringify(p.orderResponse||{})}::jsonb, ${p.errorMessage||null}, ${p.remarks||null}, ${p.status==="EXECUTED"?new Date():null}) RETURNING id`);
  return (result.rows as any[])[0].id;
}

export function registerNextraTrade(app: Express) {
  app.post("/api/nextra/place-order", async (req: any, res: any) => {
    try {
      const { token, exch, tsym, qty, prc, trgprc, prd, trantype, prctyp, ret, callId, positionId, strategyId, symbol, remarks } = req.body;
      if (typeof token !== "string" || token.length < 2) return res.status(401).json({ status: "error", message: "Session token required" });
      if (typeof exch !== "string" || typeof tsym !== "string" || typeof qty === "undefined" || typeof trantype !== "string" || typeof prctyp !== "string") return res.status(400).json({ status: "error", message: "Missing: exch, tsym, qty, trantype, prctyp" });
      if (prctyp === "LMT" && (prc === undefined || prc === null)) return res.status(400).json({ status: "error", message: "Price required for LMT" });
      if (prctyp === "SL-LMT" && (prc === undefined || trgprc === undefined)) return res.status(400).json({ status: "error", message: "Price and trigger price required for SL-LMT" });
      const session = await validateSession(token);
      if (session === null || session === undefined) return res.status(401).json({ status: "error", message: "Invalid or expired session" });
      if (typeof session.access_token !== "string" || session.access_token.length < 2) return res.status(401).json({ status: "error", message: "No trade access token. Re-login required." });
      const orderData: any = { uid: session.uid, actid: session.uid, exch, tsym, qty: String(qty), prc: String(prc||0), prd: prd||"I", trantype, prctyp: prctyp||"LMT", ret: ret||"DAY", ordersource: "API", remarks: remarks||"AlphaMarket" };
      if (trgprc && prctyp === "SL-LMT") orderData.trgprc = String(trgprc);
      const response = await nextraPost(session.sso_api_url, "PlaceOrder", session.access_token, orderData);
      const isOk = response.stat === "Ok" && response.norenordno;
      const orderId = await logOrder({ shadowUserId: session.shadow_user_id, partnerId: session.partner_id, norenordno: response.norenordno||null, exch, tsym, symbol, qty: Number(qty), prc: prc?Number(prc):undefined, trgprc: trgprc?Number(trgprc):undefined, prd: prd||"I", trantype, prctyp: prctyp||"LMT", ret: ret||"DAY", callId, positionId, strategyId, status: isOk?"EXECUTED":"FAILED", orderResponse: response, errorMessage: isOk?undefined:(response.emsg||"Failed"), remarks });
      if (isOk) { console.log("[Nextra Trade] Order placed:", response.norenordno); res.json({ status: "success", orderId, norenordno: response.norenordno, message: "Order placed" }); }
      else { res.status(400).json({ status: "error", orderId, message: response.emsg||"Order failed" }); }
    } catch (err: any) { console.error("[Nextra Trade] PlaceOrder error:", err.message); res.status(500).json({ status: "error", message: "Internal error" }); }
  });

  app.post("/api/nextra/modify-order", async (req: any, res: any) => {
    try {
      const { token, norenordno, exch, prctyp, prc, qty, trgprc } = req.body;
      if (typeof token !== "string" || token.length < 2) return res.status(401).json({ status: "error", message: "Token required" });
      if (typeof norenordno !== "string" || typeof exch !== "string") return res.status(400).json({ status: "error", message: "norenordno and exch required" });
      const session = await validateSession(token);
      if (session === null || session === undefined) return res.status(401).json({ status: "error", message: "Invalid session" });
      const modData: any = { uid: session.uid, norenordno, exch };
      if (prctyp) modData.prctyp = prctyp; if (prc) modData.prc = String(prc); if (qty) modData.qty = String(qty); if (trgprc) modData.trgprc = String(trgprc);
      const response = await nextraPost(session.sso_api_url, "ModifyOrder", session.access_token, modData);
      if (response.stat === "Ok") { await db.execute(sql`UPDATE nextra_orders SET status='MODIFIED', order_response=${JSON.stringify(response)}::jsonb, updated_at=NOW() WHERE norenordno=${norenordno} AND shadow_user_id=${session.shadow_user_id}`); res.json({ status: "success", message: "Order modified" }); }
      else { res.status(400).json({ status: "error", message: response.emsg||"Modify failed" }); }
    } catch (err: any) { res.status(500).json({ status: "error", message: "Internal error" }); }
  });

  app.post("/api/nextra/cancel-order", async (req: any, res: any) => {
    try {
      const { token, norenordno } = req.body;
      if (typeof token !== "string" || token.length < 2) return res.status(401).json({ status: "error", message: "Token required" });
      if (typeof norenordno !== "string") return res.status(400).json({ status: "error", message: "norenordno required" });
      const session = await validateSession(token);
      if (session === null || session === undefined) return res.status(401).json({ status: "error", message: "Invalid session" });
      const response = await nextraPost(session.sso_api_url, "CancelOrder", session.access_token, { uid: session.uid, norenordno });
      if (response.stat === "Ok") { await db.execute(sql`UPDATE nextra_orders SET status='CANCELLED', order_response=${JSON.stringify(response)}::jsonb, updated_at=NOW() WHERE norenordno=${norenordno} AND shadow_user_id=${session.shadow_user_id}`); res.json({ status: "success", message: "Order cancelled" }); }
      else { res.status(400).json({ status: "error", message: response.emsg||"Cancel failed" }); }
    } catch (err: any) { res.status(500).json({ status: "error", message: "Internal error" }); }
  });

  app.get("/api/nextra/order-book", async (req: any, res: any) => {
    try {
      const token = req.query.token as string;
      const session = await validateSession(token);
      if (session === null || session === undefined) return res.status(401).json({ status: "error", message: "Invalid session" });
      const response = await nextraPost(session.sso_api_url, "OrderBook", session.access_token, { uid: session.uid });
      res.json({ status: "success", orders: Array.isArray(response)?response:[] });
    } catch (err: any) { res.status(500).json({ status: "error", message: "Internal error" }); }
  });

  app.get("/api/nextra/positions", async (req: any, res: any) => {
    try {
      const token = req.query.token as string;
      const session = await validateSession(token);
      if (session === null || session === undefined) return res.status(401).json({ status: "error", message: "Invalid session" });
      const response = await nextraPost(session.sso_api_url, "PositionBook", session.access_token, { uid: session.uid, actid: session.uid });
      res.json({ status: "success", positions: Array.isArray(response)?response:[] });
    } catch (err: any) { res.status(500).json({ status: "error", message: "Internal error" }); }
  });

  app.get("/api/nextra/holdings", async (req: any, res: any) => {
    try {
      const token = req.query.token as string;
      const session = await validateSession(token);
      if (session === null || session === undefined) return res.status(401).json({ status: "error", message: "Invalid session" });
      const response = await nextraPost(session.sso_api_url, "Holdings", session.access_token, { uid: session.uid, actid: session.uid, prd: "C" });
      res.json({ status: "success", holdings: Array.isArray(response)?response:[] });
    } catch (err: any) { res.status(500).json({ status: "error", message: "Internal error" }); }
  });

  app.get("/api/admin/nextra/orders", async (req: any, res: any) => {
    try {
      const limit = Math.min(Number(req.query.limit)||100,500);
      const result = await db.execute(sql`SELECT no.*, psu.uid, psu.email, psu.display_name, psu.broker_name FROM nextra_orders no JOIN partner_shadow_users psu ON psu.id = no.shadow_user_id ORDER BY no.created_at DESC LIMIT ${limit}`);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/nextra/orders/stats", async (_req: any, res: any) => {
    try {
      const result = await db.execute(sql`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='EXECUTED') as executed, COUNT(*) FILTER (WHERE status='FAILED') as failed, COUNT(*) FILTER (WHERE status='CANCELLED') as cancelled, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as orders_24h, COUNT(DISTINCT shadow_user_id) as unique_users FROM nextra_orders`);
      res.json((result.rows as any[])[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });


  /**
   * POST /api/nextra/execute-call
   * Cookie-auth version — user clicks "Execute" on a call card.
   * Body: { callId, exch, tsym, qty, prc, prd, trantype, prctyp, trgprc? }
   */
  app.post("/api/nextra/execute-call", async (req: any, res: any) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ status: "error", message: "Not authenticated" });
      const { callId, exch, tsym, qty, prc, prd, trantype, prctyp, trgprc, strategyId, symbol } = req.body;
      if (typeof exch !== "string" || typeof tsym !== "string" || typeof qty === "undefined" || typeof trantype !== "string") {
        return res.status(400).json({ status: "error", message: "Missing: exch, tsym, qty, trantype" });
      }
      // Find shadow user by appUserId
      const suResult = await db.execute(sql`SELECT psu.id, psu.uid, psu.access_token, pc.sso_api_url, psu.partner_id FROM partner_shadow_users psu JOIN partner_configs pc ON pc.id = psu.partner_id WHERE psu.user_data->>'appUserId' = ${req.session.userId} AND psu.access_token IS NOT NULL ORDER BY psu.last_seen DESC LIMIT 1`);
      const shadow = (suResult.rows as any[])[0];
      if (!shadow || !shadow.access_token) return res.status(400).json({ status: "error", message: "No linked broker account. Please login via your broker app." });

      const orderData: any = { uid: shadow.uid, actid: shadow.uid, exch, tsym, qty: String(qty), prc: String(prc || 0), prd: prd || "I", trantype: trantype || "B", prctyp: prctyp || "LMT", ret: "DAY", ordersource: "API", remarks: "AlphaMarket" };
      if (trgprc && prctyp === "SL-LMT") orderData.trgprc = String(trgprc);

      const url = shadow.sso_api_url + "/PlaceOrder";
      const body = "jData=" + JSON.stringify(orderData);
      console.log("[Nextra Trade] Execute call:", tsym, trantype, qty, "@", prc);
      console.log("[Nextra Trade] DEBUG url:", url);
      console.log("[Nextra Trade] DEBUG token (first 20):", shadow.access_token?.substring(0,20), "len:", shadow.access_token?.length);
      console.log("[Nextra Trade] DEBUG body (first 200):", body.substring(0,200));
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain", "Authorization": "Bearer " + shadow.access_token }, body });
      const text = await response.text();
      let result: any;
      try { result = JSON.parse(text); } catch { result = { stat: "Not_Ok", emsg: "Invalid response" }; }

      const isOk = result.stat === "Ok" && result.norenordno;
      // Log order
      await db.execute(sql`INSERT INTO nextra_orders (shadow_user_id, partner_id, norenordno, exch, tsym, symbol, qty, prc, trgprc, prd, trantype, prctyp, ret, call_id, strategy_id, status, order_response, error_message, executed_at) VALUES (${shadow.id}, ${shadow.partner_id}, ${result.norenordno||null}, ${exch}, ${tsym}, ${symbol||null}, ${Number(qty)}, ${prc?Number(prc):null}, ${trgprc?Number(trgprc):null}, ${prd||"I"}, ${trantype}, ${prctyp||"LMT"}, 'DAY', ${callId||null}, ${strategyId||null}, ${isOk?"EXECUTED":"FAILED"}, ${JSON.stringify(result)}::jsonb, ${isOk?null:(result.emsg||"Failed")}, ${isOk?new Date():null})`);

      if (isOk) {
        console.log("[Nextra Trade] Order placed:", result.norenordno);
        res.json({ status: "success", norenordno: result.norenordno, message: "Order placed successfully" });
      } else {
        console.error("[Nextra Trade] Order failed:", result.emsg);
        res.status(400).json({ status: "error", message: result.emsg || "Order failed" });
      }
    } catch (err: any) {
      console.error("[Nextra Trade] Execute error:", err.message);
      res.status(500).json({ status: "error", message: "Internal error" });
    }
  });

  console.log("[Nextra Trade] Routes registered");
}
