import { useState, useEffect } from "react";

const C = { brand: "#CC2936", dark: "#1A1A2E", bg: "#F8F9FA", panel: "#FFFFFF", border: "#E2E8F0", text: "#1A202C", muted: "#718096", green: "#38A169", red: "#E53E3E", amber: "#D97706", blue: "#3182CE" };

async function api(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function Stat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{sub}</div>}
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
  const [newCallsData, setNewCallsData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"overview" | "newcalls" | "alladvisors">("overview");

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to, broker, period });
      const [d, p, nc] = await Promise.all([
        api(`/api/admin/broker-reports?${params}`),
        api(`/api/admin/broker-reports/advisor-performance?from=${from}&to=${to}`),
        api(`/api/admin/broker-reports/new-calls?from=${from}&to=${to}`),
        api(`/api/admin/broker-reports/all-advisors?from=${from}&to=${to}`)
      ]);
      setData(d);
      setPerfData(p);
      setNewCallsData(nc);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadReport(); }, [from, to, broker]);

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
  const nc = newCallsData?.summary || {};
  const ncAdvisors = newCallsData?.advisors || [];
  const ncDaily = newCallsData?.daily || [];
  const ncDailyAdvisor = newCallsData?.dailyAdvisor || [];
  const ncBrokerAdvisor = newCallsData?.brokerAdvisor || [];
  const [allAdvisorsData, setAllAdvisorsData] = useState<any>(null);

  const btnStyle = (active: boolean) => ({
    padding: "5px 10px", border: `1px solid ${active ? C.blue : C.border}`, borderRadius: 6, fontSize: 12,
    background: active ? "#EBF8FF" : "#fff", color: active ? C.blue : C.text, cursor: "pointer" as const
  });

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Header + Filters */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Broker Performance Report</h1>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setPreset(0, "daily")} style={btnStyle(period === "daily")}>Today</button>
          <button onClick={() => setPreset(6, "weekly")} style={btnStyle(period === "weekly")}>7 Days</button>
          <button onClick={() => setPreset(29, "monthly")} style={btnStyle(period === "monthly")}>30 Days</button>
          <button onClick={() => { const d = new Date(); setFrom(d.getFullYear() + "-01-01"); setTo(d.toISOString().split("T")[0]); setPeriod("ytd"); }} style={btnStyle(period === "ytd")}>YTD</button>
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

      {/* Downloads + Tab Toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => download("xlsx")} style={{ padding: "6px 14px", background: C.green, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⬇ Download Excel</button>
          <button onClick={() => download("csv")} style={{ padding: "6px 14px", background: C.amber, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⬇ Download CSV</button>
        </div>
        <div style={{ display: "flex", gap: 4, background: C.bg, borderRadius: 8, padding: 3 }}>
          <button onClick={() => setTab("overview")} style={{ ...btnStyle(tab === "overview"), borderRadius: 6 }}>Webhook Overview</button>
          <button onClick={() => setTab("newcalls")} style={{ ...btnStyle(tab === "newcalls"), borderRadius: 6 }}>New Calls (DB)</button>
          <button onClick={() => setTab("alladvisors")} style={{ ...btnStyle(tab === "alladvisors"), borderRadius: 6 }}>All Advisors</button>
        </div>
      </div>

      {loading ? <div style={{ textAlign: "center", padding: 40, color: C.muted }}>Loading report...</div> : data ? (
        tab === "overview" ? (
          <>
            {/* Summary Stats (Webhook) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 24 }}>
              <Stat label="Webhook New Calls" value={s.total_published || 0} sub={`Actual: ${nc.total_new || "?"}`} color={C.blue} />
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
                    {["Broker", "New Calls", "Closed", "Target Hit", "SL Hit", "Webhook OK", "Errors"].map(h => (
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

            {/* Advisor Performance */}
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Advisor Performance</h2>
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", background: C.panel, borderRadius: 8, border: `1px solid ${C.border}`, minWidth: 900 }}>
                <thead><tr style={{ background: C.bg }}>
                  {["Advisor", "New Calls", "Open", "Closed", "Profitable", "Loss", "Win Rate", "Avg Return %", "Abs Return ₹", "YTD Return ₹", "Status"].map(h => (
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
                        <td style={{ padding: "8px", fontSize: 13, color: C.blue, fontWeight: 600 }}>{a.total_calls || 0}</td>
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
                          ) : <span style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>✓ Good</span>}
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
                  {["Date", "New Calls", "Closed", "Target Hit", "SL Hit", "Errors"].map(h => (
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
        ) : (
          /* ═══ NEW CALLS TAB (from DB) ═══ */
          <>
            {/* New Calls Summary */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 24 }}>
              <Stat label="Total New Calls" value={nc.total_new || 0} sub={`E: ${nc.equity_new || 0} | F&O: ${nc.fno_new || 0}`} color={C.blue} />
              <Stat label="Today" value={nc.today_new || 0} color={C.blue} />
              <Stat label="This Week" value={nc.week_new || 0} color={C.blue} />
              <Stat label="Open / Closed" value={`${nc.total_open || 0} / ${nc.total_closed || 0}`} color={C.amber} />
              <Stat label="Win Rate" value={
                (parseInt(nc.total_profitable || 0) + parseInt(nc.total_loss || 0)) > 0
                  ? Math.round((parseInt(nc.total_profitable || 0) / (parseInt(nc.total_profitable || 0) + parseInt(nc.total_loss || 0))) * 100) + "%"
                  : "N/A"
              } sub={`P: ${nc.total_profitable || 0} L: ${nc.total_loss || 0} | Avg: ${nc.avg_return_pct || 0}%`} color={C.green} />
            </div>

            {/* Advisor New Calls */}
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Advisor New Calls (from Database)</h2>
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", background: C.panel, borderRadius: 8, border: `1px solid ${C.border}`, minWidth: 1000 }}>
                <thead><tr style={{ background: C.bg }}>
                  {["Advisor", "Total New", "Equity", "F&O", "Today", "This Week", "Open", "Closed", "Profitable", "Loss", "Win Rate", "Avg Return %", "Sent to Broker"].map(h => (
                    <th key={h} style={{ padding: "10px 6px", fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "left", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {ncAdvisors.map((a: any, i: number) => {
                    const total = parseInt(a.profitable || 0) + parseInt(a.loss || 0);
                    const winRate = total > 0 ? Math.round((parseInt(a.profitable || 0) / total) * 100) : 0;
                    const notSent = parseInt(a.total_new || 0) - parseInt(a.sent_to_broker || 0);
                    return (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "8px 6px", fontSize: 13, fontWeight: 600, maxWidth: 160 }}>{a.advisor_name}</td>
                        <td style={{ padding: "8px 6px", fontSize: 13, color: C.blue, fontWeight: 700 }}>{a.total_new}</td>
                        <td style={{ padding: "8px 6px", fontSize: 13 }}>{a.equity_new}</td>
                        <td style={{ padding: "8px 6px", fontSize: 13 }}>{a.fno_new}</td>
                        <td style={{ padding: "8px 6px", fontSize: 13, color: C.blue, fontWeight: 600 }}>{a.today_new}</td>
                        <td style={{ padding: "8px 6px", fontSize: 13 }}>{a.week_new}</td>
                        <td style={{ padding: "8px 6px", fontSize: 13, color: C.amber, fontWeight: 600 }}>{a.open_count}</td>
                        <td style={{ padding: "8px 6px", fontSize: 13 }}>{a.closed_count}</td>
                        <td style={{ padding: "8px 6px", fontSize: 13, color: C.green, fontWeight: 600 }}>{a.profitable}</td>
                        <td style={{ padding: "8px 6px", fontSize: 13, color: C.red }}>{a.loss}</td>
                        <td style={{ padding: "8px 6px", fontSize: 13, fontWeight: 700, color: winRate >= 50 ? C.green : winRate > 0 ? C.amber : C.muted }}>{winRate}%</td>
                        <td style={{ padding: "8px 6px", fontSize: 13, fontWeight: 600, color: parseFloat(a.avg_return_pct || 0) >= 0 ? C.green : C.red }}>{a.avg_return_pct || 0}%</td>
                        <td style={{ padding: "8px 6px", fontSize: 13 }}>
                          <span style={{ color: C.green }}>{a.sent_to_broker}</span>
                          {notSent > 0 && <span style={{ color: C.red, fontSize: 10, marginLeft: 4 }}>({notSent} unmapped)</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {ncAdvisors.length === 0 && <tr><td colSpan={13} style={{ padding: 30, textAlign: "center", color: C.muted }}>No data for this period</td></tr>}
                </tbody>
              </table>
              </div>
            </div>

            {/* Broker Per-Advisor Breakdown */}
            {ncBrokerAdvisor.length > 0 && (
            <div style={{ background: C.panel, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Broker-Advisor Breakdown</h2>
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: C.bg }}>
                  {["Broker", "Advisor", "Creates", "Closes", "SL Hit", "Target Hit", "OK", "Errors"].map(h => (
                    <th key={h} style={{ padding: "8px 6px", fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {ncBrokerAdvisor.map((r: any, i: number) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px", fontSize: 12, fontWeight: 600 }}>{r.broker_name}</td>
                      <td style={{ padding: "6px", fontSize: 12 }}>{r.advisor}</td>
                      <td style={{ padding: "6px", fontSize: 12, color: C.blue, fontWeight: 600 }}>{r.creates}</td>
                      <td style={{ padding: "6px", fontSize: 12 }}>{r.closes}</td>
                      <td style={{ padding: "6px", fontSize: 12, color: C.red }}>{r.sl_triggered || 0}</td>
                      <td style={{ padding: "6px", fontSize: 12, color: C.green }}>{r.target_hit || 0}</td>
                      <td style={{ padding: "6px", fontSize: 12, color: C.green }}>{r.ok}</td>
                      <td style={{ padding: "6px", fontSize: 12, color: Number(r.errors) > 0 ? C.red : C.muted }}>{r.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            )}

            {/* Daily Per-Advisor Calls */}
            {ncDailyAdvisor.length > 0 && (
            <div style={{ background: C.panel, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Daily Per-Advisor Calls</h2>
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: C.bg }}>
                  {["Date", "Advisor", "Equity", "F&O", "Total", "Open", "Closed", "Profitable", "Mapped"].map(h => (
                    <th key={h} style={{ padding: "8px 6px", fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {ncDailyAdvisor.map((r: any, i: number) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "5px 6px", fontSize: 12 }}>{new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                      <td style={{ padding: "5px 6px", fontSize: 12 }}>{r.advisor}</td>
                      <td style={{ padding: "5px 6px", fontSize: 12 }}>{r.equity}</td>
                      <td style={{ padding: "5px 6px", fontSize: 12 }}>{r.fno}</td>
                      <td style={{ padding: "5px 6px", fontSize: 12, color: C.blue, fontWeight: 600 }}>{r.total}</td>
                      <td style={{ padding: "5px 6px", fontSize: 12, color: C.amber }}>{r.open}</td>
                      <td style={{ padding: "5px 6px", fontSize: 12 }}>{r.closed}</td>
                      <td style={{ padding: "5px 6px", fontSize: 12, color: C.green }}>{r.profitable}</td>
                      <td style={{ padding: "5px 6px", fontSize: 12, color: Number(r.mapped_to_broker) > 0 ? C.green : C.muted }}>{r.mapped_to_broker}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            )}

            {/* Daily New Calls */}
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Daily New Calls</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", background: C.panel, borderRadius: 8, border: `1px solid ${C.border}` }}>
                <thead><tr style={{ background: C.bg }}>
                  {["Date", "New Calls", "Equity", "F&O", "Closed", "Profitable", "Loss", "Avg Return %"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {ncDaily.map((d: any, i: number) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 500 }}>{new Date(d.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: C.blue, fontWeight: 600 }}>{d.new_calls}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13 }}>{d.equity}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13 }}>{d.fno}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13 }}>{d.closed}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: C.green }}>{d.profitable}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: C.red }}>{d.loss}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600, color: parseFloat(d.avg_return || 0) >= 0 ? C.green : C.red }}>{d.avg_return || 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      
      ) : tab === "alladvisors" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <Stat label="Total Advisors" value={(allAdvisorsData?.advisors || []).length} color={C.blue} />
            <Stat label="Total Calls" value={(allAdvisorsData?.advisors || []).reduce((a: number, v: any) => a + Number(v.grand_total || 0), 0)} color={C.blue} />
            <Stat label="Total Wins" value={(allAdvisorsData?.advisors || []).reduce((a: number, v: any) => a + Number(v.total_wins || 0), 0)} color={C.green} />
            <Stat label="Total Losses" value={(allAdvisorsData?.advisors || []).reduce((a: number, v: any) => a + Number(v.total_losses || 0), 0)} color={C.red} />
          </div>

          <div style={{ background: C.panel, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, overflowX: "auto" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>All Advisor Performance</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
              <thead><tr style={{ background: C.bg }}>
                {["Advisor", "SEBI", "Equity", "E-Win", "E-Loss", "E-Hit%", "E-Avg%", "E-P&L", "F&O", "F-Win", "F-Loss", "F-Hit%", "F-Avg%", "Total"].map(h => (
                  <th key={h} style={{ padding: "8px 6px", fontSize: 10, fontWeight: 700, color: C.muted, textAlign: "left", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(allAdvisorsData?.advisors || []).map((a: any, i: number) => {
                  const eqHitRate = (Number(a.eq_wins) + Number(a.eq_losses)) > 0 ? Math.round(Number(a.eq_wins) / (Number(a.eq_wins) + Number(a.eq_losses)) * 100) : 0;
                  const fnoHitRate = (Number(a.fno_wins) + Number(a.fno_losses)) > 0 ? Math.round(Number(a.fno_wins) / (Number(a.fno_wins) + Number(a.fno_losses)) * 100) : 0;
                  return (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px", fontSize: 12, fontWeight: 600, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.advisor}</td>
                    <td style={{ padding: "6px", fontSize: 10, color: C.muted, whiteSpace: "nowrap" }}>{a.sebi || "-"}</td>
                    <td style={{ padding: "6px", fontSize: 12, color: C.blue, fontWeight: 600 }}>{a.equity_calls}</td>
                    <td style={{ padding: "6px", fontSize: 12, color: C.green }}>{a.eq_wins}</td>
                    <td style={{ padding: "6px", fontSize: 12, color: C.red }}>{a.eq_losses}</td>
                    <td style={{ padding: "6px", fontSize: 12, fontWeight: 600, color: eqHitRate >= 50 ? C.green : C.red }}>{eqHitRate || "-"}%</td>
                    <td style={{ padding: "6px", fontSize: 12, color: Number(a.eq_avg_return || 0) >= 0 ? C.green : C.red }}>{a.eq_avg_return || "-"}%</td>
                    <td style={{ padding: "6px", fontSize: 12, fontWeight: 500, color: Number(a.eq_abs_pnl || 0) >= 0 ? C.green : C.red }}>{Number(a.eq_abs_pnl || 0) > 0 ? "+" : ""}{Math.round(Number(a.eq_abs_pnl || 0))}</td>
                    <td style={{ padding: "6px", fontSize: 12, color: C.blue, fontWeight: 600 }}>{a.fno_positions}</td>
                    <td style={{ padding: "6px", fontSize: 12, color: C.green }}>{a.fno_wins}</td>
                    <td style={{ padding: "6px", fontSize: 12, color: C.red }}>{a.fno_losses}</td>
                    <td style={{ padding: "6px", fontSize: 12, fontWeight: 600, color: fnoHitRate >= 50 ? C.green : C.red }}>{a.fno_positions > 0 ? fnoHitRate + "%" : "-"}</td>
                    <td style={{ padding: "6px", fontSize: 12, color: Number(a.fno_avg_return || 0) >= 0 ? C.green : C.red }}>{a.fno_avg_return || "-"}%</td>
                    <td style={{ padding: "6px", fontSize: 13, fontWeight: 700, color: C.blue }}>{a.grand_total}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
