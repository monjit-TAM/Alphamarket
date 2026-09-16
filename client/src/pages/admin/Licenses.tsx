import { useState, useEffect, useCallback } from "react";

async function api(method: string, path: string, body?: any) {
  const res = await fetch(path, {
    method, credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const C = { brand:"#CC2936", dark:"#1A1A2E", bg:"#F8F9FA", panel:"#FFFFFF", border:"#E2E8F0",
  text:"#1A202C", muted:"#718096", green:"#38A169", red:"#E53E3E", amber:"#D97706",
  greenBg:"#F0FFF4", redBg:"#FFF5F5", amberBg:"#FFFBEB" };

interface License {
  broker_slug: string; license_key: string; valid_from: string;
  valid_until: string; status: string; days_left: number;
}

export default function Licenses() {
  const [rows, setRows] = useState<License[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const flash = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(() => {
    setLoading(true);
    api("GET", "/api/admin/licenses")
      .then(setRows).catch(e => flash(e.message, false)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const grant = async (slug: string) => {
    if (!slug) return;
    setBusy(true);
    try { await api("POST", "/api/admin/licenses/grant", { broker_slug: slug, days: 90 });
      flash(`New 90-day key issued for ${slug}`, true); setNewSlug(""); load();
    } catch (e: any) { flash(e.message, false); } finally { setBusy(false); }
  };

  const revoke = async (slug: string) => {
    if (!window.confirm(`Revoke the active licence for ${slug}? The engine will stop within a day.`)) return;
    setBusy(true);
    try { await api("POST", "/api/admin/licenses/revoke", { broker_slug: slug });
      flash(`Licence revoked for ${slug}`, true); load();
    } catch (e: any) { flash(e.message, false); } finally { setBusy(false); }
  };

  const statusBadge = (r: License) => {
    if (r.status === "revoked") return { label: "REVOKED", color: C.red, bg: C.redBg };
    if (r.days_left <= 7) return { label: `${r.days_left}d LEFT`, color: C.amber, bg: C.amberBg };
    return { label: `${r.days_left}d LEFT`, color: C.green, bg: C.greenBg };
  };

  return (
    <div style={{ padding: 24, background: C.bg, minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: C.text, marginBottom: 4 }}>Engine Licences</h1>
      <p style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
        Issue a new 90-day key before the current one expires. If a broker's key lapses, their engine stops after a 7-day grace period.
      </p>

      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 20, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={newSlug} onChange={e => setNewSlug(e.target.value.trim())}
          placeholder="broker slug, e.g. anandrathi"
          style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, minWidth: 240 }} />
        <button onClick={() => grant(newSlug)} disabled={busy || !newSlug}
          style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: C.green, color: "#fff", fontSize: 13, fontWeight: 600, cursor: busy || !newSlug ? "default" : "pointer", opacity: busy || !newSlug ? 0.5 : 1 }}>
          Issue new 90-day key
        </button>
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.bg, textAlign: "left" }}>
              {["Broker", "Status", "Valid until", "Key", ""].map((h, i) =>
                <th key={i} style={{ padding: "10px 14px", fontSize: 11, textTransform: "uppercase", color: C.muted, fontWeight: 600 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: C.muted }}>{loading ? "Loading..." : "No licences yet."}</td></tr>}
            {rows.map(r => {
              const b = statusBadge(r);
              return (
                <tr key={r.broker_slug} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: C.text }}>{r.broker_slug}</td>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{ background: b.bg, color: b.color, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{b.label}</span>
                  </td>
                  <td style={{ padding: "12px 14px", color: C.muted }}>{new Date(r.valid_until).toLocaleDateString()}</td>
                  <td style={{ padding: "12px 14px", color: C.muted, fontFamily: "monospace", fontSize: 12 }}>{r.license_key ? r.license_key.slice(0, 10) + "…" : "—"}</td>
                  <td style={{ padding: "12px 14px", textAlign: "right" }}>
                    <button onClick={() => grant(r.broker_slug)} disabled={busy}
                      style={{ padding: "5px 10px", marginRight: 6, borderRadius: 5, border: `1px solid ${C.green}`, background: "#fff", color: C.green, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Renew</button>
                    {r.status === "active" &&
                      <button onClick={() => revoke(r.broker_slug)} disabled={busy}
                        style={{ padding: "5px 10px", borderRadius: 5, border: `1px solid ${C.red}`, background: "#fff", color: C.red, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Revoke</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: toast.ok ? C.green : C.red, color: "#fff", padding: "12px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>{toast.msg}</div>}
    </div>
  );
}
