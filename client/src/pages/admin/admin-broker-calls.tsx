import { useState, useEffect } from "react";

const C = { brand: "#CC2936", dark: "#1A1A2E", bg: "#F8F9FA", panel: "#FFFFFF", border: "#E2E8F0", text: "#1A202C", muted: "#718096", green: "#38A169", red: "#E53E3E", amber: "#D97706", blue: "#3182CE" };

async function api(method: string, path: string, body?: any) {
  const res = await fetch(path, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return <span style={{ background: bg, color, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{label}</span>;
}

export default function AdminBrokerCalls() {
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ type: "", advisor: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState("");
  const [editSL, setEditSL] = useState("");
  const [closing, setClosing] = useState<string | null>(null);
  const [exitPrice, setExitPrice] = useState("");

  const loadCalls = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.type) params.set("type", filter.type);
      if (filter.advisor) params.set("advisor", filter.advisor);
      const data = await api("GET", `/api/admin/broker-calls/active?${params}`);
      setCalls(data.calls || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadCalls(); }, [filter.type]);

  const handleClose = async (id: string, source: string) => {
    if (!confirm("Close this call and push CLOSE event to brokers?")) return;
    try {
      await api("POST", `/api/admin/broker-calls/${id}/close`, { source, exitPrice: exitPrice ? parseFloat(exitPrice) : null });
      setClosing(null); setExitPrice("");
      loadCalls();
    } catch (e: any) { alert("Error: " + e.message); }
  };

  const handleModify = async (id: string, source: string) => {
    try {
      await api("PATCH", `/api/admin/broker-calls/${id}/modify`, { source, targetPrice: parseFloat(editTarget), stopLoss: parseFloat(editSL) });
      setEditId(null);
      loadCalls();
    } catch (e: any) { alert("Error: " + e.message); }
  };

  const equity = calls.filter(c => c.call_type === "equity");
  const fno = calls.filter(c => c.call_type === "fno");

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Active Broker Calls</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })} style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13 }}>
            <option value="">All Types</option>
            <option value="equity">Equity</option>
            <option value="fno">F&O</option>
          </select>
          <input placeholder="Filter by advisor..." value={filter.advisor} onChange={e => setFilter({ ...filter, advisor: e.target.value })} onBlur={loadCalls} style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, width: 200 }} />
          <button onClick={loadCalls} style={{ padding: "6px 14px", background: C.blue, color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Refresh</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.blue }}>{calls.length}</div>
          <div style={{ fontSize: 12, color: C.muted }}>Total Active</div>
        </div>
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.green }}>{equity.length}</div>
          <div style={{ fontSize: 12, color: C.muted }}>Equity Calls</div>
        </div>
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.amber }}>{fno.length}</div>
          <div style={{ fontSize: 12, color: C.muted }}>F&O Positions</div>
        </div>
      </div>

      {loading ? <div style={{ textAlign: "center", padding: 40, color: C.muted }}>Loading...</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", background: C.panel, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {["Rec ID", "Symbol", "Type", "Action", "Entry", "Target", "SL", "Advisor", "Strategy", "Date", "Actions"].map(h => (
                <th key={h} style={{ padding: "10px 8px", fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calls.map((c: any) => (
              <tr key={c.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px", fontSize: 12 }}>{c.webhook_rec_id}</td>
                <td style={{ padding: "8px", fontSize: 12, fontWeight: 600 }}>
                  {c.symbol}
                  {c.strike_price ? <span style={{ fontSize: 10, color: C.muted }}> {c.strike_price} {c.call_put}</span> : null}
                </td>
                <td style={{ padding: "8px", fontSize: 11 }}>
                  {c.call_type === "equity" ? <Badge label="Equity" color={C.green} bg="#F0FFF4" /> : <Badge label="F&O" color={C.amber} bg="#FFFBEB" />}
                </td>
                <td style={{ padding: "8px", fontSize: 12 }}>
                  <Badge label={c.action || "Buy"} color={c.action === "Sell" ? C.red : C.green} bg={c.action === "Sell" ? "#FFF5F5" : "#F0FFF4"} />
                </td>
                <td style={{ padding: "8px", fontSize: 12 }}>{c.entry_price || "—"}</td>
                <td style={{ padding: "8px", fontSize: 12 }}>
                  {editId === c.id ? <input value={editTarget} onChange={e => setEditTarget(e.target.value)} style={{ width: 60, padding: 2, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12 }} /> : (c.target_price || c.target || "—")}
                </td>
                <td style={{ padding: "8px", fontSize: 12 }}>
                  {editId === c.id ? <input value={editSL} onChange={e => setEditSL(e.target.value)} style={{ width: 60, padding: 2, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12 }} /> : (c.stop_loss || "—")}
                </td>
                <td style={{ padding: "8px", fontSize: 11, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{c.advisor_company || c.advisor_name}</td>
                <td style={{ padding: "8px", fontSize: 11, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{c.strategy_name}</td>
                <td style={{ padding: "8px", fontSize: 11, color: C.muted }}>{new Date(c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                <td style={{ padding: "8px", fontSize: 11 }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {editId === c.id ? (
                      <>
                        <button onClick={() => handleModify(c.id, c.source)} style={{ padding: "3px 8px", background: C.green, color: "#fff", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>Save</button>
                        <button onClick={() => setEditId(null)} style={{ padding: "3px 8px", background: C.muted, color: "#fff", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>Cancel</button>
                      </>
                    ) : closing === c.id ? (
                      <>
                        <input placeholder="Exit ₹" value={exitPrice} onChange={e => setExitPrice(e.target.value)} style={{ width: 60, padding: 2, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11 }} />
                        <button onClick={() => handleClose(c.id, c.source)} style={{ padding: "3px 8px", background: C.red, color: "#fff", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>Confirm</button>
                        <button onClick={() => setClosing(null)} style={{ padding: "3px 6px", background: C.muted, color: "#fff", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>X</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setEditId(c.id); setEditTarget(c.target_price || c.target || ""); setEditSL(c.stop_loss || ""); }} style={{ padding: "3px 8px", background: "#EBF8FF", color: C.blue, border: `1px solid ${C.blue}`, borderRadius: 4, fontSize: 10, cursor: "pointer" }}>Modify</button>
                        <button onClick={() => setClosing(c.id)} style={{ padding: "3px 8px", background: "#FFF5F5", color: C.red, border: `1px solid ${C.red}`, borderRadius: 4, fontSize: 10, cursor: "pointer" }}>Close</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {calls.length === 0 && <tr><td colSpan={11} style={{ padding: 30, textAlign: "center", color: C.muted }}>No active broker calls</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
