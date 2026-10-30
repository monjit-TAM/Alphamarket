// ============================================================================
// Reseller registration page (wrapped in site Navbar + Footer)
// SAVE AS: client/src/pages/reseller-register.tsx
// ============================================================================

import { useState } from "react";
import { useLocation } from "wouter";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

const C = {
  brand: "#e14a14", dark: "#141414", bg: "#f7f7f8", panel: "#ffffff",
  border: "#e2e2e6", text: "#1a1a1a", muted: "#6b6b6b", red: "#e53e3e",
  green: "#2f855a",
};

export default function ResellerRegister() {
  const [, navigate] = useLocation();
  const [form, setForm] = useState({
    firmName: "", username: "", email: "", phone: "", password: "", confirm: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [agree, setAgree] = useState(false);
  const [done, setDone] = useState<{ referralCode: string } | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.username || !form.email || !form.password) {
      setError("Username, email and password are required."); return;
    }
    if (form.password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (form.password !== form.confirm) { setError("Passwords do not match."); return; }
    if (!agree) { setError("Please accept the Reseller Partner Agreement to continue."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/reseller/register", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username, email: form.email, password: form.password,
          phone: form.phone || undefined, firmName: form.firmName || undefined,
          agreementConsent: true,
        }),
      });
      if (!res.ok) { setError(await res.text()); setLoading(false); return; }
      const data = await res.json();
      setDone({ referralCode: data?.reseller?.referralCode || "" });
    } catch (err: any) {
      setError(err.message || "Registration failed");
    }
    setLoading(false);
  }

  const input: React.CSSProperties = {
    width: "100%", padding: "11px 13px", borderRadius: 8, border: `1px solid ${C.border}`,
    fontSize: 14, marginTop: 6, boxSizing: "border-box", outline: "none",
  };
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: C.text };

  if (done) {
    return (
      <>
        <Navbar />
        <div style={{ minHeight: "70vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
          <div style={{ background: C.panel, borderRadius: 14, padding: 40, maxWidth: 460, textAlign: "center", boxShadow: "0 8px 40px rgba(0,0,0,.08)" }}>
            <div style={{ fontSize: 15, color: C.green, fontWeight: 700, marginBottom: 10 }}>Application received</div>
            <h2 style={{ fontSize: 22, margin: "0 0 12px", color: C.dark }}>You're almost set.</h2>
            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, margin: "0 0 18px" }}>
              Your reseller account is created and pending approval. Once approved, you'll start earning on every subscription you bring.
            </p>
            {done.referralCode && (
              <div style={{ background: C.bg, borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: C.muted }}>Your referral code</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.brand, letterSpacing: 2, marginTop: 4 }}>{done.referralCode}</div>
              </div>
            )}
            <button onClick={() => navigate("/reseller/dashboard")} style={{ background: C.brand, color: "#fff", border: "none", borderRadius: 8, padding: "12px 26px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Go to my dashboard →
            </button>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div style={{ minHeight: "70vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ background: C.panel, borderRadius: 14, padding: "36px 40px", maxWidth: 480, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,.08)" }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: C.brand, fontWeight: 700 }}>Reseller Programme</div>
          <h2 style={{ fontSize: 24, margin: "8px 0 4px", color: C.dark }}>Become an AlphaVerse reseller</h2>
          <p style={{ fontSize: 13.5, color: C.muted, margin: "0 0 22px", lineHeight: 1.55 }}>
            Resell our full research &amp; advisory suite to your clients and earn a 50% share on every subscription. Nothing to build.
          </p>

          {error && (
            <div style={{ background: "#fff5f5", color: C.red, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>{error}</div>
          )}

          <form onSubmit={submit}>
            <div style={{ marginBottom: 14 }}>
              <span style={label}>Firm / business name</span>
              <input style={input} value={form.firmName} onChange={(e) => set("firmName", e.target.value)} placeholder="e.g. Sharma Securities" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <span style={label}>Username *</span>
              <input style={input} value={form.username} onChange={(e) => set("username", e.target.value)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <span style={label}>Email *</span>
              <input style={input} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <span style={label}>Phone</span>
              <input style={input} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91" />
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <span style={label}>Password *</span>
                <input style={input} type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <span style={label}>Confirm *</span>
                <input style={input} type="password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} />
              </div>
            </div>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 18, cursor: "pointer" }}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
                I have read and agree to the <a href="/reseller-agreement" target="_blank" rel="noopener noreferrer" style={{ color: C.brand, fontWeight: 600, textDecoration: "none" }}>Reseller Partner Agreement</a> and confirm the information I have provided is accurate.
              </span>
            </label>
            <button type="submit" disabled={loading} style={{ width: "100%", background: C.brand, color: "#fff", border: "none", borderRadius: 8, padding: "13px", fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
              {loading ? "Creating account…" : "Create reseller account"}
            </button>
          </form>

          <p style={{ fontSize: 12.5, color: C.muted, textAlign: "center", marginTop: 18 }}>
            Already a reseller? <a href="/login" style={{ color: C.brand, fontWeight: 600, textDecoration: "none" }}>Log in</a>
          </p>
        </div>
      </div>
      <Footer />
    </>
  );
}
