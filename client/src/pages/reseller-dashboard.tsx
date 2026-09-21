// ============================================================================
// STAGE C — Reseller dashboard (the logged-in reseller's own view)
// SAVE AS: client/src/pages/reseller-dashboard.tsx
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

const C = {
  brand: "#e14a14", dark: "#141414", bg: "#F8F9FA", panel: "#FFFFFF",
  border: "#E2E8F0", text: "#1A202C", muted: "#718096",
  green: "#2F855A", greenBg: "#F0FFF4", amber: "#B7791F", amberBg: "#FFFBEB",
};

interface Me {
  firmName: string | null; referralCode: string; commissionRate: string; status: string;
  totalCustomers: number; activeCustomers: number; productsSold: number;
  grossRevenue: number; shareTotal: number; sharePending: number; sharePaid: number;
}
interface Customer { id: string; username: string; email: string; status: string; enrolledAt: string; }
interface Ledger { id: string; grossAmount: string; commissionRate: string; shareAmount: string; status: string; createdAt: string; customerName: string | null; }

async function getJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
function inr(n: number) {
  if (n >= 10000000) return "₹" + (n / 10000000).toFixed(2) + " Cr";
  if (n >= 100000) return "₹" + (n / 100000).toFixed(2) + " L";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export default function ResellerDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"customers" | "earnings">("customers");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [m, c, l] = await Promise.all([
        getJson("/api/reseller/me"),
        getJson("/api/reseller/me/customers"),
        getJson("/api/reseller/me/ledger"),
      ]);
      setMe(m); setCustomers(c); setLedger(l);
    } catch (e: any) { setErr(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const refLink = me ? `${window.location.origin}/register?ref=${me.referralCode}` : "";
  function copyLink() {
    navigator.clipboard?.writeText(refLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }

  const wrap: React.CSSProperties = { maxWidth: 1000, margin: "0 auto", padding: "0 20px" };
  const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${C.border}` };
  const td: React.CSSProperties = { padding: "12px", fontSize: 13, color: C.text, borderBottom: `1px solid ${C.border}` };

  if (err) {
    return (
      <div style={{ background: "#fff" }}>
        <Navbar />
        <div style={{ ...wrap, padding: "60px 20px", textAlign: "center" }}>
          <h2 style={{ fontSize: 22, color: C.dark }}>Reseller dashboard</h2>
          <p style={{ color: C.muted, marginTop: 10 }}>{err === "Not a reseller account" ? "This area is for reseller accounts. " : err}</p>
          <a href="/reseller/register" style={{ color: C.brand, fontWeight: 600 }}>Become a reseller →</a>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh" }}>
      <Navbar />
      <div style={{ ...wrap, paddingTop: 32, paddingBottom: 56 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.dark, margin: 0 }}>{me?.firmName || "Reseller"} dashboard</h1>
            <p style={{ fontSize: 13, color: C.muted, margin: "4px 0 0" }}>
              Status: <strong style={{ color: me?.status === "approved" ? C.green : C.amber, textTransform: "capitalize" }}>{me?.status}</strong>
              {me && ` · Your share: ${me.commissionRate}%`}
            </p>
          </div>
        </div>

        {me?.status === "pending" && (
          <div style={{ background: C.amberBg, color: C.amber, borderRadius: 8, padding: "10px 14px", marginTop: 14, fontSize: 13 }}>
            Your account is pending approval. You can share your referral link now — earnings start accruing once approved.
          </div>
        )}

        {/* referral link */}
        <div style={{ background: C.dark, borderRadius: 12, padding: "20px 22px", marginTop: 18, color: "#fff" }}>
          <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: 1, color: "#9a9a9a" }}>Your referral link</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <code style={{ background: "#0f0f0f", padding: "10px 14px", borderRadius: 8, fontSize: 13, flex: 1, minWidth: 220, overflow: "auto", color: "#fff" }}>{refLink}</code>
            <button onClick={copyLink} style={{ background: C.brand, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{copied ? "Copied ✓" : "Copy link"}</button>
          </div>
          <div style={{ fontSize: 12, color: "#9a9a9a", marginTop: 8 }}>Referral code: <strong style={{ color: C.brand }}>{me?.referralCode}</strong> — anyone who signs up through this link is attributed to you.</div>
        </div>

        {/* KPI tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 18 }}>
          {[
            ["Active customers", String(me?.activeCustomers ?? 0)],
            ["Total introduced", String(me?.totalCustomers ?? 0)],
            ["Products sold", String(me?.productsSold ?? 0)],
            ["Your earnings", inr(me?.shareTotal ?? 0)],
            ["Pending payout", inr(me?.sharePending ?? 0)],
          ].map(([l, v]) => (
            <div key={l} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.dark }}>{v}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 8, marginTop: 24, borderBottom: `1px solid ${C.border}` }}>
          {(["customers", "earnings"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", padding: "10px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer", color: tab === t ? C.brand : C.muted, borderBottom: tab === t ? `2px solid ${C.brand}` : "2px solid transparent", textTransform: "capitalize" }}>{t}</button>
          ))}
        </div>

        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "auto" }}>
          {loading ? (
            <div style={{ padding: 20, color: C.muted }}>Loading…</div>
          ) : tab === "customers" ? (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
              <thead><tr><th style={th}>Customer</th><th style={th}>Email</th><th style={th}>Status</th><th style={th}>Enrolled</th></tr></thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr><td style={td} colSpan={4}>No customers yet. Share your referral link to start.</td></tr>
                ) : customers.map((c) => (
                  <tr key={c.id}>
                    <td style={td}>{c.username}</td>
                    <td style={td}>{c.email}</td>
                    <td style={td}><span style={{ textTransform: "capitalize" }}>{c.status}</span></td>
                    <td style={td}>{new Date(c.enrolledAt).toLocaleDateString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
              <thead><tr><th style={th}>Customer</th><th style={th}>Subscription</th><th style={th}>Rate</th><th style={th}>Your share</th><th style={th}>Status</th><th style={th}>Date</th></tr></thead>
              <tbody>
                {ledger.length === 0 ? (
                  <tr><td style={td} colSpan={6}>No earnings yet. These appear as your customers subscribe.</td></tr>
                ) : ledger.map((l) => (
                  <tr key={l.id}>
                    <td style={td}>{l.customerName || "—"}</td>
                    <td style={td}>{inr(Number(l.grossAmount))}</td>
                    <td style={td}>{l.commissionRate}%</td>
                    <td style={td}><strong>{inr(Number(l.shareAmount))}</strong></td>
                    <td style={td}><span style={{ color: l.status === "paid" ? C.green : C.amber, textTransform: "capitalize", fontWeight: 600 }}>{l.status}</span></td>
                    <td style={td}>{new Date(l.createdAt).toLocaleDateString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
