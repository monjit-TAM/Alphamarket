// ============================================================================
// STAGE D — Admin reseller management page
// SAVE AS: client/src/pages/admin/admin-resellers.tsx
// ============================================================================

import { useState, useEffect, useCallback } from "react";

interface Reseller {
  id: string; userId: string; firmName: string | null; referralCode: string;
  commissionRate: string; status: string; createdAt: string;
  username: string; email: string; phone: string | null;
  totalCustomers: number; activeCustomers: number; productsSold: number;
  grossRevenue: number; shareTotal: number; sharePending: number;
}

async function api(method: string, path: string, body?: any) {
  const res = await fetch(path, {
    method, credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const C = {
  brand: "#e14a14", dark: "#141414", bg: "#F8F9FA", panel: "#FFFFFF",
  border: "#E2E8F0", text: "#1A202C", muted: "#718096",
  green: "#2F855A", greenBg: "#F0FFF4", red: "#C53030", redBg: "#FFF5F5",
  amber: "#B7791F", amberBg: "#FFFBEB",
};

function inr(n: number) {
  if (n >= 10000000) return "₹" + (n / 10000000).toFixed(2) + " Cr";
  if (n >= 100000) return "₹" + (n / 100000).toFixed(2) + " L";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function StatusBadge({ s }: { s: string }) {
  const map: Record<string, [string, string]> = {
    approved: [C.green, C.greenBg], pending: [C.amber, C.amberBg], suspended: [C.red, C.redBg],
  };
  const [color, bg] = map[s] || [C.muted, "#EDF2F7"];
  return <span style={{ background: bg, color, padding: "2px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>{s}</span>;
}

export default function AdminResellers() {
  const [rows, setRows] = useState<Reseller[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { setRows(await api("GET", "/api/admin/resellers")); }
    catch (e: any) { setErr(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: string) {
    try { await api("PATCH", `/api/admin/resellers/${id}/status`, { status }); load(); }
    catch (e: any) { alert(e.message); }
  }
  async function saveRate(id: string) {
    try { await api("PATCH", `/api/admin/resellers/${id}/commission`, { commissionRate: Number(rateInput) }); setEditing(null); load(); }
    catch (e: any) { alert(e.message); }
  }

  const totals = rows.reduce((a, r) => ({
    resellers: a.resellers + 1,
    customers: a.customers + r.activeCustomers,
    revenue: a.revenue + r.grossRevenue,
    share: a.share + r.shareTotal,
  }), { resellers: 0, customers: 0, revenue: 0, share: 0 });

  const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "12px", fontSize: 13, color: C.text, borderBottom: `1px solid ${C.border}`, verticalAlign: "middle" };
  const btn = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff", border: "none", borderRadius: 5, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 6 });

  return (
    <div style={{ padding: "24px 28px", background: C.bg, minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.dark, margin: 0 }}>Resellers</h1>
          <p style={{ fontSize: 13, color: C.muted, margin: "4px 0 0" }}>All registered resellers, their status and activity.</p>
        </div>
        <button onClick={load} style={{ ...btn(C.dark), marginRight: 0 }}>Refresh</button>
      </div>

      {/* summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          ["Resellers", String(totals.resellers)],
          ["Active customers", String(totals.customers)],
          ["Gross revenue", inr(totals.revenue)],
          ["Reseller share", inr(totals.share)],
        ].map(([l, v]) => (
          <div key={l} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.dark }}>{v}</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>

      {err && <div style={{ background: C.redBg, color: C.red, padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{err}</div>}

      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={th}>Reseller</th>
              <th style={th}>Code</th>
              <th style={th}>Status</th>
              <th style={th}>Commission</th>
              <th style={th}>Customers</th>
              <th style={th}>Products</th>
              <th style={th}>Revenue</th>
              <th style={th}>Their share</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={td} colSpan={9}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td style={td} colSpan={9}>No resellers registered yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{r.firmName || r.username}</div>
                  <div style={{ fontSize: 11.5, color: C.muted }}>{r.email}{r.phone ? ` · ${r.phone}` : ""}</div>
                </td>
                <td style={td}><span style={{ fontFamily: "monospace", fontWeight: 700, color: C.brand }}>{r.referralCode}</span></td>
                <td style={td}><StatusBadge s={r.status} /></td>
                <td style={td}>
                  {editing === r.id ? (
                    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input value={rateInput} onChange={(e) => setRateInput(e.target.value)} style={{ width: 52, padding: "4px 6px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12 }} />%
                      <button onClick={() => saveRate(r.id)} style={btn(C.green)}>Save</button>
                      <button onClick={() => setEditing(null)} style={{ ...btn("#A0AEC0"), marginRight: 0 }}>×</button>
                    </span>
                  ) : (
                    <span style={{ cursor: "pointer" }} onClick={() => { setEditing(r.id); setRateInput(r.commissionRate); }}>
                      <strong>{r.commissionRate}%</strong> <span style={{ color: C.brand, fontSize: 11 }}>edit</span>
                    </span>
                  )}
                </td>
                <td style={td}>{r.activeCustomers} <span style={{ color: C.muted, fontSize: 11 }}>/ {r.totalCustomers}</span></td>
                <td style={td}>{r.productsSold}</td>
                <td style={td}>{inr(r.grossRevenue)}</td>
                <td style={td}><strong>{inr(r.shareTotal)}</strong><div style={{ fontSize: 11, color: C.amber }}>{inr(r.sharePending)} pending</div></td>
                <td style={td}>
                  {r.status !== "approved" && <button onClick={() => setStatus(r.id, "approved")} style={btn(C.green)}>Approve</button>}
                  {r.status !== "suspended" && <button onClick={() => setStatus(r.id, "suspended")} style={btn(C.red)}>Suspend</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
