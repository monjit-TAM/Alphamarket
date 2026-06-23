import { useState, useEffect } from "react";

const C = { bg: "#0D1B2A", panel: "#1B2838", border: "#2A3A4A", text: "#E0E0E0", muted: "#78909C", blue: "#4FC3F7", blueBg: "#0D2137", green: "#4CAF50", greenBg: "#1B3A1B", red: "#EF5350" };

function inp(label: string, value: any, onChange: (v: string) => void, type = "number") {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{label}</div>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid " + C.border, background: C.bg, color: C.text, fontSize: 13 }} />
    </div>
  );
}

export default function AdminToolPricing() {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    fetch("/api/monetization-config").then(r => r.json()).then(d => setConfig(d)).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/admin/monetization-config", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
        credentials: "include",
      });
      if (r.ok) showToast("Saved successfully"); else showToast("Save failed");
    } catch { showToast("Save failed"); }
    setSaving(false);
  };

  const update = (tool: string, field: string, value: any) => {
    setConfig((prev: any) => ({ ...prev, [tool]: { ...(prev[tool] || {}), [field]: typeof value === "string" && !isNaN(Number(value)) ? Number(value) : value } }));
  };

  if (!config) return <div style={{ padding: 40, textAlign: "center", color: C.muted }}>Loading...</div>;

  const tools = [
    { key: "alpha_bot", label: "Alpha Bot", desc: "AI-powered stock screening and call generation" },
    { key: "options_alpha", label: "Options Alpha", desc: "Option signals with risk-reward analysis" },
    { key: "alpha_ideas", label: "Alpha Ideas", desc: "Curated stock ideas based on fundamentals" },
    { key: "algo_trading", label: "Algo Trading", desc: "Algorithmic trading signals and strategies" },
    { key: "dyor_bundle", label: "DYOR Full Bundle", desc: "All DYOR tools combined at a discount" },
    { key: "stockMfBundle", label: "Stock & MF Analyzer", desc: "Portfolio analysis for stocks and mutual funds" },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: C.green, color: "#fff", padding: "10px 20px", borderRadius: 8, fontSize: 13, zIndex: 999 }}>{toast}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>Tool Pricing Management</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Configure pricing for all DYOR tools and analyzers. Changes apply immediately.</div>
        </div>
        <button onClick={save} disabled={saving}
          style={{ padding: "10px 24px", background: C.blue, color: "#0D1B2A", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving..." : "Save All Changes"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {tools.map(t => {
          const tc = config[t.key] || {};
          return (
            <div key={t.key} style={{ background: C.panel, borderRadius: 10, border: "1px solid " + C.border, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{t.desc}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: tc.enabled !== false ? C.green : C.red }}>{tc.enabled !== false ? "Active" : "Disabled"}</span>
                  <input type="checkbox" checked={tc.enabled !== false} onChange={(e) => update(t.key, "enabled", e.target.checked)}
                    style={{ width: 16, height: 16, cursor: "pointer" }} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {inp("Monthly (₹)", tc.monthlyPrice, (v) => update(t.key, "monthlyPrice", v))}
                {inp("Quarterly (₹)", tc.quarterlyPrice, (v) => update(t.key, "quarterlyPrice", v))}
                {inp("Annual (₹)", tc.annualPrice, (v) => update(t.key, "annualPrice", v))}
              </div>

              {t.key === "dyor_bundle" && (
                <div style={{ marginTop: 8, padding: 8, background: C.bg, borderRadius: 6, fontSize: 11, color: C.muted }}>
                  Includes: Alpha Bot + Options Alpha + Alpha Ideas + Algo Trading
                </div>
              )}

              {t.key === "stockMfBundle" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                  {inp("Included Analyses", tc.includedAnalyses, (v) => update(t.key, "includedAnalyses", v))}
                  {inp("Extra Analysis (₹)", tc.additionalAnalysisPrice, (v) => update(t.key, "additionalAnalysisPrice", v))}
                </div>
              )}

              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={tc.freeForApprovedAdvisors !== false} onChange={(e) => update(t.key, "freeForApprovedAdvisors", e.target.checked)}
                  style={{ width: 14, height: 14, cursor: "pointer" }} />
                <span style={{ fontSize: 11, color: C.muted }}>Free for approved advisors</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 24, background: C.panel, borderRadius: 10, border: "1px solid " + C.border, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Onboarding Costs</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
          {inp("eKYC Cost (₹)", config.onboarding?.ekycCost, (v) => { setConfig((p: any) => ({ ...p, onboarding: { ...(p.onboarding || {}), ekycCost: Number(v) } })); })}
          {inp("eSign Cost (₹)", config.onboarding?.esignCost, (v) => { setConfig((p: any) => ({ ...p, onboarding: { ...(p.onboarding || {}), esignCost: Number(v) } })); })}
          {inp("PMLA Cost (₹)", config.onboarding?.pmlaCost, (v) => { setConfig((p: any) => ({ ...p, onboarding: { ...(p.onboarding || {}), pmlaCost: Number(v) } })); })}
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>Strategy</div>
            <select value={config.onboarding?.strategy || "absorb"} onChange={(e) => { setConfig((p: any) => ({ ...p, onboarding: { ...(p.onboarding || {}), strategy: e.target.value } })); }}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid " + C.border, background: C.bg, color: C.text, fontSize: 13 }}>
              <option value="absorb">Absorb (Platform pays)</option>
              <option value="pass_through">Pass through (User pays)</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24, background: C.panel, borderRadius: 10, border: "1px solid " + C.border, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Active Subscriptions</div>
        <SubscriptionTable />
      </div>
    </div>
  );
}

function SubscriptionTable() {
  const [subs, setSubs] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/admin/tool-subscriptions", { credentials: "include" }).then(r => r.ok ? r.json() : []).then(d => setSubs(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  if (subs.length === 0) return <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: 20 }}>No active tool subscriptions yet.</div>;

  return (
    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
      <thead><tr style={{ borderBottom: "2px solid " + C.border, textAlign: "left" as any }}>
        <th style={{ padding: "8px 12px" }}>User</th><th style={{ padding: "8px 12px" }}>Tool</th><th style={{ padding: "8px 12px" }}>Plan</th>
        <th style={{ padding: "8px 12px" }}>Amount</th><th style={{ padding: "8px 12px" }}>Status</th><th style={{ padding: "8px 12px" }}>Expires</th>
      </tr></thead>
      <tbody>{subs.map((s: any, i: number) => (
        <tr key={i} style={{ borderBottom: "1px solid " + C.border }}>
          <td style={{ padding: "8px 12px" }}>{s.email || s.user_id?.slice(0, 8)}</td>
          <td style={{ padding: "8px 12px", fontWeight: 600 }}>{s.tool}</td>
          <td style={{ padding: "8px 12px" }}>{s.plan_type}</td>
          <td style={{ padding: "8px 12px" }}>₹{s.amount}</td>
          <td style={{ padding: "8px 12px", color: s.status === "active" ? C.green : C.muted }}>{s.status}</td>
          <td style={{ padding: "8px 12px", color: C.muted }}>{s.expires_at ? new Date(s.expires_at).toLocaleDateString() : "—"}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}
