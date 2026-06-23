import { useState, useEffect } from "react";
import { Navbar } from "@/components/navbar";
import { useAuth } from "@/lib/auth";

export default function ToolPricingPage() {
  const { user } = useAuth();
  const [config, setConfig] = useState<any>(null);
  const [selectedPlan, setSelectedPlan] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const [activeSubs, setActiveSubs] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/monetization-config").then(r => r.json()).then(d => setConfig(d)).catch(() => {});
    fetch("/api/my-tool-subscriptions", { credentials: "include" }).then(r => r.ok ? r.json() : []).then(d => setActiveSubs(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const isToolActive = (toolKey: string) => {
    return activeSubs.some(s => s.tool === toolKey && s.status === "active");
  };
  const getActivePlan = (toolKey: string) => {
    const sub = activeSubs.find(s => s.tool === toolKey && s.status === "active");
    return sub ? sub.plan_type : null;
  };
  const getExpiry = (toolKey: string) => {
    const sub = activeSubs.find(s => s.tool === toolKey && s.status === "active");
    return sub?.expires_at ? new Date(sub.expires_at).toLocaleDateString("en-IN") : null;
  };

  const subscribe = async (tool: string) => {
    if (!user) { window.location.href = "/login"; return; }
    setLoading(tool);
    try {
      const r = await fetch("/api/tool-subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, planType: selectedPlan[tool] || "monthly" }),
        credentials: "include",
      });
      const d = await r.json();
      if (d.broker_pays) { alert("Access granted! Your broker covers this subscription."); setLoading(null); return; }
      if (d.paymentSessionId) {
        const cf = (window as any).Cashfree;
        if (cf) { cf({ mode: "production" }).checkout({ paymentSessionId: d.paymentSessionId }); }
        else { window.location.href = "/payment-callback?order_id=" + d.orderId + "&vt=" + d.verifyToken + "&type=tool"; }
      } else { alert(d.error || "Payment error"); }
    } catch (e: any) { alert("Error: " + e.message); }
    setLoading(null);
  };

  if (!config) return <div><Navbar /><div style={{ padding: 60, textAlign: "center", color: "#888" }}>Loading...</div></div>;

  const tools = [
    { key: "alpha_bot", icon: "🤖" },
    { key: "options_alpha", icon: "📊" },
    { key: "alpha_ideas", icon: "💡" },
    { key: "algo_trading", icon: "⚡" },
    { key: "dyor_bundle", icon: "🎯" },
    { key: "stockMfBundle", icon: "📈" },
  ];

  const plans = ["monthly", "quarterly", "annual"];
  const planLabels: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: "#E0E0E0", margin: 0 }}>Research & Analysis Tools</h1>
          <p style={{ fontSize: 16, color: "#78909C", marginTop: 8 }}>Powerful tools to supercharge your investment research</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 20 }}>
          {tools.map(t => {
            const tc = config[t.key];
            if (!tc || tc.enabled === false) return null;
            const plan = selectedPlan[t.key] || "monthly";
            const price = plan === "quarterly" ? tc.quarterlyPrice : plan === "annual" ? tc.annualPrice : tc.monthlyPrice;
            const monthlyEquiv = plan === "quarterly" ? Math.round(tc.quarterlyPrice / 3) : plan === "annual" ? Math.round(tc.annualPrice / 12) : tc.monthlyPrice;
            const saving = plan !== "monthly" ? Math.round((1 - monthlyEquiv / tc.monthlyPrice) * 100) : 0;

            return (
              <div key={t.key} style={{ background: "#1B2838", borderRadius: 12, border: t.key === "dyor_bundle" ? "2px solid #4FC3F7" : "1px solid #2A3A4A", padding: 24, position: "relative", display: "flex", flexDirection: "column" }}>
                {t.key === "dyor_bundle" && (
                  <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "#4FC3F7", color: "#0D1B2A", padding: "4px 16px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>BEST VALUE</div>
                )}

                <div style={{ fontSize: 28, marginBottom: 8 }}>{t.icon}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#E0E0E0", marginBottom: 4 }}>{tc.label}</div>
                <div style={{ fontSize: 13, color: "#78909C", marginBottom: 16, flex: 1 }}>{tc.description}</div>

                {tc.includes && (
                  <div style={{ background: "#0D2137", borderRadius: 6, padding: 10, marginBottom: 16, fontSize: 12, color: "#4FC3F7" }}>
                    Includes: {tc.includes.map((i: string) => config[i]?.label || i).join(" + ")}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                  {plans.map(p => (
                    <button key={p} onClick={() => setSelectedPlan(prev => ({ ...prev, [t.key]: p }))}
                      style={{ flex: 1, padding: "6px 0", borderRadius: 6, border: plan === p ? "1px solid #4FC3F7" : "1px solid #2A3A4A", background: plan === p ? "#0D2137" : "transparent", color: plan === p ? "#4FC3F7" : "#78909C", fontSize: 11, fontWeight: plan === p ? 700 : 400, cursor: "pointer" }}>
                      {planLabels[p]}
                    </button>
                  ))}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <span style={{ fontSize: 32, fontWeight: 700, color: "#E0E0E0" }}>₹{price?.toLocaleString("en-IN")}</span>
                    <span style={{ fontSize: 13, color: "#78909C" }}>/{plan === "annual" ? "year" : plan === "quarterly" ? "quarter" : "month"}</span>
                  </div>
                  {saving > 0 && (
                    <div style={{ fontSize: 12, color: "#4CAF50", marginTop: 4 }}>
                      Save {saving}% — ₹{monthlyEquiv}/month effective
                    </div>
                  )}
                </div>

                {isToolActive(t.key) ? (
                  <div style={{ width: "100%", padding: "12px 0", borderRadius: 8, background: "#1B3A1B", border: "1px solid #4CAF50", textAlign: "center" }}>
                    <div style={{ color: "#4CAF50", fontSize: 14, fontWeight: 600 }}>Active — {getActivePlan(t.key)}</div>
                    <div style={{ color: "#78909C", fontSize: 11, marginTop: 2 }}>Expires: {getExpiry(t.key)}</div>
                  </div>
                ) : (
                  <button onClick={() => subscribe(t.key)} disabled={loading === t.key}
                    style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: t.key === "dyor_bundle" ? "#4FC3F7" : "#2A3A4A", color: t.key === "dyor_bundle" ? "#0D1B2A" : "#E0E0E0", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: loading === t.key ? 0.6 : 1 }}>
                    {loading === t.key ? "Processing..." : user ? "Subscribe Now" : "Login to Subscribe"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {user?.role === "advisor" && user?.isApproved && (
          <div style={{ textAlign: "center", marginTop: 24, padding: 16, background: "#1B3A1B", borderRadius: 8, border: "1px solid #4CAF50" }}>
            <div style={{ color: "#4CAF50", fontSize: 15, fontWeight: 600 }}>You have free access to all tools as an approved advisor</div>
          </div>
        )}
        <div style={{ textAlign: "center", marginTop: 32, color: "#78909C", fontSize: 13 }}>
          <p>All plans include full access to the tool. Approved advisors get free access.</p>
          <p style={{ marginTop: 4 }}>Payments powered by Cashfree. Secure transactions. Cancel anytime.</p>
        </div>
      </div>
    </div>
  );
}
