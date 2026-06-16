import { useState, useEffect } from "react";

const C = { brand: "#CC2936", dark: "#1A1A2E", bg: "#F8F9FA", panel: "#FFFFFF", border: "#E2E8F0", text: "#1A202C", muted: "#718096", green: "#38A169", red: "#E53E3E", amber: "#D97706", blue: "#3182CE" };

async function api(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function AdminBrokerReports() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split("T")[0]; });
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [broker, setBroker] = useState("");
  const [period, setPeriod] = useState("weekly");
  const [data, setData] = useState<any>(null);
  const [perfData, setPerfData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to, broker, period });
      const [d, p] = await Promise.all([
        api(`/api/admin/broker-reports?${params}`),
        api(`/api/admin/broker-reports/advisor-performance?from=${from}&to=${to}`)
      ]);
      setData(d);
      setPerfData(p);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadReport(); }, []);

  const setPreset = (days: number, label: string) => {
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - days);
    setFrom(start.toISOString().split("T")[0]);
    setTo(end.toISOString().split("T")[0]);
    setPeriod(label);
  };

  const download = (format: string) => {
    window.location.href = `/api/admin/broker-reports/download?from=${from}&to=${to}&broker=${broker}&format=${format}`;
  };

  const s = data?.summary || {};
  const advisors = perfData?.advisors || [];
  const ytd = perfData?.ytd || {};

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Broker Performance Report</h1>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setPreset(0, "daily")} style={{ padding: "5px 10px", border: `1px solid ${period === "daily" ? C.blue : C.border}`, borderRadius: 6, fontSize: 12, background: period === "daily" ? "#EBF8FF" : "#fff", color: period === "daily" ? C.blue : C.text, cursor: "pointer" }}>Today</button>
          <button onClick={() => setPreset(6, "weekly")} style={{ padding: "5px 10px", border: `1px solid ${period === "weekly" ? C.blue : C.border}`, borderRadius: 6, fontSize: 12, background: period === "weekly" ? "#EBF8FF" : "#fff", color: period === "weekly" ? C.blue : C.text, cursor: "pointer" }}>7 Days</button>
          <button onClick={() => setPreset(29, "monthly")} style={{ padding: "5px 10px", border: `1px solid ${period === "monthly" ? C.blue : C.border}`, borderRadius: 6, fontSize: 12, background: period === "monthly" ? "#EBF8FF" : "#fff", color: period === "monthly" ? C.blue : C.text, cursor: "pointer" }}>30 Days</button>
          <button onClick={() => { const d = new Date(); setFrom(d.getFullYear() + "-01-01"); setTo(d.toISOString().split("T")[0]); setPeriod("ytd"); }} style={{ padding: "5px 10px", border: `1px solid ${period === "ytd" ? C.blue : C.border}`, borderRadius: 6, fontSize: 12, background: period === "ytd" ? "#EBF8FF" : "#fff", color: period === "ytd" ? C.blue : C.text, cursor: "pointer" }}>YTD</button>
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPeriod("custom"); }} style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
          <span style={{ fontSize: 12, color: C.muted }}>to</span>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPeriod("custom"); }} style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
          <select value={broker} onChange={e => setBroker(e.target.value)} style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }}>
            <option value="">All Brokers</option>
            <option value="Upstox">Upstox</option>
            <option value="Dreamstreet">Dreamstreet</option>
          </select>
          <button onClick={loadReport} style={{ padding: "5px 14px", background: C.blue, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Load</button>
        </div>
      </div>

      {/* Download buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => download("xlsx")} style={{ padding: "6px 14px", background: C.green, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⬇ Download Excel</button>
        <button onClick={() => download("csv")} style={{ padding: "6px 14px", background: C.amber, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⬇ Download CSV</button>
      </div>

      {loading ? <div style={{ textAlign: "center", padding: 40, color: C.muted }}>Loading report...</div> : data ? (
        <>
          {/* Summary Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 24 }}>
            <Stat label="New Calls" value={s.total_published || 0} color={C.blue} />
            <Stat label="Open" value={advisors.reduce((a: number, v: any) => a + (v.total_open || 0), 0)} color={C.amber} />
            <Stat label="Closed" value={s.total_closed || 0} color={C.muted} />
            <Stat label="Target Hit" value={s.total_targets || 0} color={C.green} />
            <Stat label="SL Triggered" value={s.total_stoploss || 0} color={C.red} />
            <Stat label="Active Advisors" value={s.active_advisors || 0} color={C.blue} />
          </div>

          {/* Broker Breakdown */}
          {data.brokers?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Broker Breakdown</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", background: C.panel, borderRadius: 8, border: `1px solid ${C.border}` }}>
                <thead><tr style={{ background: C.bg }}>
                  {["Broker", "Published", "Closed", "Target Hit", "SL Hit", "Webhook OK", "Errors"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.brokers.map((b: any, i: number) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>{b.broker_name}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: C.blue }}>{b.published}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13 }}>{b.closed}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: C.green }}>{b.targets}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: C.red }}>{b.stoploss}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: C.green }}>{b.success}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: parseInt(b.errors) > 0 ? C.red : C.muted }}>{b.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Advisor Performance — Enhanced */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Advisor Performance</h2>
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: C.panel, borderRadius: 8, border: `1px solid ${C.border}`, minWidth: 900 }}>
              <thead><tr style={{ background: C.bg }}>
                {["Advisor", "Published", "Open", "Closed", "Profitable", "Loss", "Win Rate", "Avg Return %", "Abs Return ₹", "YTD Return ₹", "Status"].map(h => (
                  <th key={h} style={{ padding: "10px 8px", fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {advisors.map((a: any, i: number) => {
                  const ytdData = ytd[a.advisor] || {};
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: a.is_weak ? "#FFF5F5" : "transparent" }}>
                      <td style={{ padding: "8px", fontSize: 13, fontWeight: 600, maxWidth: 160 }}>
                        {a.advisor}
                        {a.is_weak && <span style={{ display: "block", fontSize: 9, color: C.red, marginTop: 2 }}>⚠ Weak</span>}
                      </td>
                      <td style={{ padding: "8px", fontSize: 13, color: C.blue, fontWeight: 600 }}>{(a.equity_open + a.equity_closed + a.fno_open + a.fno_closed) || 0}</td>
                      <td style={{ padding: "8px", fontSize: 13, color: C.amber, fontWeight: 600 }}>{a.total_open}</td>
                      <td style={{ padding: "8px", fontSize: 13 }}>{a.total_closed}</td>
                      <td style={{ padding: "8px", fontSize: 13, color: C.green, fontWeight: 600 }}>{a.total_profitable}</td>
                      <td style={{ padding: "8px", fontSize: 13, color: C.red }}>{a.total_loss}</td>
                      <td style={{ padding: "8px", fontSize: 13, fontWeight: 700, color: a.win_rate >= 50 ? C.green : a.win_rate > 0 ? C.amber : C.muted }}>{a.win_rate}%</td>
                      <td style={{ padding: "8px", fontSize: 13, fontWeight: 600, color: a.equity_avg_return >= 0 ? C.green : C.red }}>{a.equity_avg_return || 0}%</td>
                      <td style={{ padding: "8px", fontSize: 13, fontWeight: 600, color: a.equity_total_return >= 0 ? C.green : C.red }}>₹{a.equity_total_return || 0}</td>
                      <td style={{ padding: "8px", fontSize: 13, fontWeight: 600, color: (ytdData.ytd_total_return || 0) >= 0 ? C.green : C.red }}>₹{ytdData.ytd_total_return || 0}</td>
                      <td style={{ padding: "8px", fontSize: 11 }}>
                        {a.is_weak ? (
                          <div style={{ background: "#FFF5F5", border: `1px solid ${C.red}`, borderRadius: 4, padding: "4px 6px" }}>
                            {a.weaknesses.map((w: string, j: number) => <div key={j} style={{ color: C.red, fontSize: 10 }}>• {w}</div>)}
                          </div>
                        ) : (
                          <span style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>✓ Good</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {advisors.length === 0 && <tr><td colSpan={11} style={{ padding: 30, textAlign: "center", color: C.muted }}>No data for this period</td></tr>}
              </tbody>
            </table>
            </div>
          </div>

          {/* Daily Breakdown */}
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Daily Breakdown</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", background: C.panel, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <thead><tr style={{ background: C.bg }}>
                {["Date", "Published", "Closed", "Target Hit", "SL Hit", "Errors"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(data.daily || []).map((d: any, i: number) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 500 }}>{new Date(d.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13, color: C.blue }}>{d.published}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{d.closed}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13, color: C.green }}>{d.targets}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13, color: C.red }}>{d.stoploss}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13, color: parseInt(d.errors) > 0 ? C.red : C.muted }}>{d.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
