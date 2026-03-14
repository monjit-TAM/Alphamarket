import { useState } from "react";
import {
  Shield, TrendingUp, TrendingDown, AlertTriangle,
  BarChart3, PieChart as PieChartIcon, Target, Zap, Scale, Wallet,
  ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, Percent, DollarSign, Edit3, Save, X,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";

const SECTOR_COLORS = ["#2563eb","#7c3aed","#0891b2","#d97706","#059669","#dc2626","#6366f1","#f59e0b","#8b5cf6","#64748b"];
const GRADE_COLORS: Record<string, string> = { A: "#059669", B: "#16a34a", C: "#d97706", D: "#dc2626", F: "#991b1b" };

function fmt(v: any): string {
  if (v == null) return "\u2014";
  const n = Number(v);
  if (isNaN(n)) return "\u2014";
  if (Math.abs(n) >= 10000000) return "\u20B9" + (n / 10000000).toFixed(2) + " Cr";
  if (Math.abs(n) >= 100000) return "\u20B9" + (n / 100000).toFixed(2) + " L";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function pct(v: any): string { const n = Number(v); return isNaN(n) ? "\u2014" : (n >= 0 ? "+" : "") + n.toFixed(1) + "%"; }
function pc(v: any): string { return Number(v) >= 0 ? "text-emerald-600" : "text-red-600"; }

function Sec({ title, icon, children, open: defaultOpen = true }: { title: string; icon: React.ReactNode; children: React.ReactNode; open?: boolean }) {
  const [o, setO] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button onClick={() => setO(!o)} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">{icon} {title}</span>
        {o ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {o && <div className="p-4">{children}</div>}
    </div>
  );
}

function Sig({ s }: { s: string }) {
  if (!s) return <span className="text-xs text-slate-400">\u2014</span>;
  const c = s.includes("Strong Buy") ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
    s.includes("Buy") ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
    s.includes("Strong Sell") || s.includes("Reduce") ? "bg-red-100 text-red-700 border-red-200" :
    s.includes("Sell") ? "bg-red-50 text-red-600 border-red-100" :
    "bg-slate-50 text-slate-600 border-slate-200";
  return <span className={`text-xs px-1.5 py-0.5 rounded border ${c}`}>{s}</span>;
}

export default function DeepAnalysisPanel({ data, onUpdate }: { data: any; onUpdate?: (d: any) => void }) {
  if (!data) return null;
  const [editMode, setEditMode] = useState(false);
  const [editedRecs, setEditedRecs] = useState<Record<string, { action: string; notes: string }>>({});
  const [editedMfRecs, setEditedMfRecs] = useState<Record<number, { action: string; reason: string; deleted?: boolean }>>({});
  const [newMfRecs, setNewMfRecs] = useState<Array<{ action: string; reason: string }>>([]);
  const [editedRebalancing, setEditedRebalancing] = useState<Record<string, { action?: string; reason?: string }>>({});
  const [editedValue, setEditedValue] = useState<Record<string, { signal?: string; narrative?: string }>>({});
  const [editedGrowth, setEditedGrowth] = useState<Record<string, { signal?: string; narrative?: string }>>({});
  const [editedQuantamental, setEditedQuantamental] = useState<Record<string, { classification?: string; insights?: string[] }>>({});

  const toggleEdit = () => {
    if (editMode && onUpdate) {
      const updated = JSON.parse(JSON.stringify(data));
      // Stock-by-Stock
      if (updated.equity?.enhancedRecommendations) {
        for (const r of updated.equity.enhancedRecommendations) {
          const e = editedRecs[r.stockName];
          if (e) { r.overallAction = e.action; r.advisorNotes = e.notes; }
        }
      }
      // Rebalancing
      if (updated.equity?.rebalancing?.suggestions && Object.keys(editedRebalancing).length > 0) {
        for (const s of updated.equity.rebalancing.suggestions) {
          const e = editedRebalancing[s.stockName];
          if (e) { if (e.action) s.action = e.action; if (e.reason) s.reason = e.reason; }
        }
      }
      // Value Analysis
      if (updated.equity?.valueAnalysis && Object.keys(editedValue).length > 0) {
        for (const v of updated.equity.valueAnalysis) {
          const e = editedValue[v.stockName];
          if (e) { if (e.signal) v.signal = e.signal; if (e.narrative) v.narrative = e.narrative; }
        }
      }
      // Growth Analysis
      if (updated.equity?.growthAnalysis && Object.keys(editedGrowth).length > 0) {
        for (const g of updated.equity.growthAnalysis) {
          const e = editedGrowth[g.stockName];
          if (e) { if (e.signal) g.signal = e.signal; if (e.narrative) g.narrative = e.narrative; }
        }
      }
      // Quantamental
      if (updated.equity?.quantamental && Object.keys(editedQuantamental).length > 0) {
        for (const q of updated.equity.quantamental) {
          const e = editedQuantamental[q.stockName];
          if (e) { if (e.classification) q.classification = e.classification; if (e.insights) q.insights = e.insights; }
        }
      }
      // MF Recommendations — edit, delete, add new
      if (updated.mutualFunds?.recommendations) {
        updated.mutualFunds.recommendations = updated.mutualFunds.recommendations
          .map((r: any, i: number) => {
            const e = editedMfRecs[i];
            if (e?.deleted) return null;
            return e ? { ...r, action: e.action, reason: e.reason } : r;
          })
          .filter(Boolean);
        if (newMfRecs.length > 0) {
          updated.mutualFunds.recommendations.push(...newMfRecs.map(nr => ({ fund: "Custom", priority: "medium", action: nr.action, reason: nr.reason })));
        }
      }
      onUpdate(updated);
    }
    setEditMode(!editMode);
  };

  const { equity, mutualFunds, combined } = data;
  const hs = equity?.healthScore;
  const am = equity?.advancedMetrics;

  const sectorData = equity?.sectorAllocation
    ? Object.entries(equity.sectorAllocation).map(([name, pct]: [string, any], i) => ({ name, value: Number(pct), color: SECTOR_COLORS[i % SECTOR_COLORS.length] }))
    : [];

  const healthComponents = hs?.components
    ? Object.entries(hs.components).map(([key, val]: [string, any]) => ({ subject: key.charAt(0).toUpperCase() + key.slice(1), score: val.score || 0, label: val.label, detail: val.detail }))
    : [];

  const hasDiv = equity?.dividends?.holdings?.length > 0;
  const hasTax = equity?.taxImpact?.holdings?.length > 0;
  const hasScenarios = equity?.scenarios?.length > 0;
  const hasRebalancing = equity?.rebalancing?.suggestions?.length > 0;
  const hasQuant = equity?.quantamental?.length > 0;
  const hasMFRecs = mutualFunds?.recommendations?.length > 0;

  return (
    <div className="space-y-4">
      {/* Edit Toggle */}
      <div className="flex justify-end">
        <button onClick={toggleEdit} className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${editMode ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}`}>
          {editMode ? <><Save className="w-4 h-4" /> Save Changes</> : <><Edit3 className="w-4 h-4" /> Edit Recommendations</>}
        </button>
      </div>

      {/* ── Hero Row: Health + Radar + Combined ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {hs && (
          <div className="rounded-xl border-2 p-5 flex flex-col items-center justify-center"
            style={{ borderColor: GRADE_COLORS[hs.grade] || "#d97706", backgroundColor: (GRADE_COLORS[hs.grade] || "#d97706") + "08" }}>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Portfolio Health</div>
            <div className="text-5xl font-bold mb-1" style={{ color: GRADE_COLORS[hs.grade] || "#d97706" }}>{hs.overall}</div>
            <div className="text-lg font-semibold" style={{ color: GRADE_COLORS[hs.grade] || "#d97706" }}>Grade {hs.grade}</div>
            <p className="text-xs text-slate-500 text-center mt-2">{hs.summary}</p>
          </div>
        )}
        {healthComponents.length > 0 && (
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-semibold text-slate-600 mb-1">Score Breakdown</div>
            <ResponsiveContainer width="100%" height={180}>
              <RadarChart data={healthComponents}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "#64748b" }} />
                <Radar dataKey="score" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
              {healthComponents.map((c) => (
                <div key={c.subject} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">{c.subject}</span>
                  <span className={`font-semibold ${c.score >= 70 ? "text-emerald-600" : c.score >= 40 ? "text-amber-600" : "text-red-600"}`}>{c.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {combined && (
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-semibold text-slate-600 mb-3">Combined Portfolio</div>
            <div className="space-y-2">
              <Row label="Invested" value={fmt(combined.totalInvested)} />
              <Row label="Current Value" value={fmt(combined.currentValue)} />
              <Row label="Total P&L" value={fmt(combined.totalPnl) + " (" + pct(combined.totalPnlPercent) + ")"} cls={pc(combined.totalPnl)} />
              <div className="h-px bg-slate-200 my-1" />
              <Row label="Equity" value={fmt(combined.assetAllocation?.equity?.current) + " (" + Number(combined.assetAllocation?.equity?.percent || 0).toFixed(0) + "%)"} />
              <Row label="Mutual Funds" value={fmt(combined.assetAllocation?.mutualFunds?.current) + " (" + Number(combined.assetAllocation?.mutualFunds?.percent || 0).toFixed(0) + "%)"} />
              {am && <>
                <div className="h-px bg-slate-200 my-1" />
                <Row label="Sharpe Ratio" value={am.sharpeRatio != null ? Number(am.sharpeRatio).toFixed(2) : "\u2014"} />
                <Row label="Win Rate" value={am.winRate != null ? Number(am.winRate).toFixed(0) + "%" : "\u2014"} />
                <Row label="Max Drawdown" value={am.maxDrawdown != null ? Number(am.maxDrawdown).toFixed(1) + "%" : "\u2014"} />
              </>}
            </div>
          </div>
        )}
      </div>

      {/* ── Sector Allocation ── */}
      {sectorData.length > 0 && (
        <Sec title="Sector Allocation" icon={<PieChartIcon className="w-4 h-4 text-blue-600" />}>
          <div className="flex flex-col lg:flex-row items-center gap-4">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={sectorData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2}>
                  {sectorData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => v.toFixed(1) + "%"} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2">
              {sectorData.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-slate-200 bg-white">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  {s.name}: {s.value.toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        </Sec>
      )}

      {/* ── Stock-by-Stock + Quantamental ── */}
      {equity?.enhancedRecommendations?.length > 0 && (
        <Sec title={"Stock-by-Stock Analysis (" + equity.enhancedRecommendations.length + " stocks)"} icon={<Zap className="w-4 h-4 text-amber-600" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 px-2 font-medium">Stock</th>
                  <th className="py-2 px-2 font-medium">CMP</th>
                  <th className="py-2 px-2 font-medium">P&L</th>
                  <th className="py-2 px-2 font-medium">Value</th>
                  <th className="py-2 px-2 font-medium">Growth</th>
                  <th className="py-2 px-2 font-medium">Quant</th>
                  <th className="py-2 px-2 font-medium">Action</th>
                  <th className="py-2 px-2 font-medium">Confidence</th>
                  {editMode && <th className="py-2 px-2 font-medium">Advisor Notes</th>}
                  {!editMode && Object.keys(editedRecs).some(k => editedRecs[k]?.notes) && <th className="py-2 px-2 font-medium">Notes</th>}
                </tr>
              </thead>
              <tbody>
                {equity.enhancedRecommendations.map((r: any, i: number) => {
                  const q = hasQuant ? equity.quantamental.find((qq: any) => qq.stockName === r.stockName) : null;
                  const h = equity.holdings?.find((hh: any) => hh.stockName === r.stockName || hh.symbol === r.stockName);
                  const actionColor = (r.overallAction || "").includes("Buy") ? "bg-emerald-100 text-emerald-700" : (r.overallAction || "").includes("Sell") || (r.overallAction || "").includes("Reduce") ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
                  return (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2.5 px-2">
                        <div className="font-medium text-slate-900">{r.stockName}</div>
                        {q && <div className="text-[10px] text-slate-400">{q.classification} &middot; PE {q.pe ? Number(q.pe).toFixed(1) : "\u2014"}</div>}
                      </td>
                      <td className="py-2.5 px-2 tabular-nums text-slate-700">{fmt(r.currentPrice)}</td>
                      <td className={`py-2.5 px-2 tabular-nums font-medium ${pc(h?.pnlPercent || h?.totalPnlPercent)}`}>{h ? pct(h.pnlPercent || h.totalPnlPercent) : "\u2014"}</td>
                      <td className="py-2.5 px-2"><Sig s={r.valueSignal} /></td>
                      <td className="py-2.5 px-2"><Sig s={r.growthSignal} /></td>
                      <td className="py-2.5 px-2"><Sig s={r.quantSignal} /></td>
                      {editMode ? (
                      <td className="py-2.5 px-2">
                        <select value={editedRecs[r.stockName]?.action || r.overallAction} onChange={(e) => setEditedRecs(p => ({...p, [r.stockName]: {...(p[r.stockName] || {action: r.overallAction, notes: ""}), action: e.target.value}}))}
                          className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white w-full">
                          {["Strong Buy","Buy","Hold","Sell","Reduce","Neutral","Exit"].map(a => <option key={a}>{a}</option>)}
                        </select>
                      </td>
                    ) : (
                      <td className="py-2.5 px-2"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${actionColor}`}>{r.overallAction}</span></td>
                    )}
                      <td className="py-2.5 px-2"><span className={`text-xs font-medium ${r.confidence === "High" ? "text-emerald-600" : r.confidence === "Medium" ? "text-amber-600" : "text-slate-400"}`}>{r.confidence}</span></td>
                      {editMode && (
                        <td className="py-2.5 px-2">
                          <input value={editedRecs[r.stockName]?.notes || ""} onChange={(e) => setEditedRecs(p => ({...p, [r.stockName]: {...(p[r.stockName] || {action: r.overallAction, notes: ""}), notes: e.target.value}}))}
                            placeholder="Add advisor note..." className="text-xs border border-slate-200 rounded px-2 py-1 bg-white w-full" />
                        </td>
                      )}
                      {!editMode && editedRecs[r.stockName]?.notes && (
                        <td className="py-2.5 px-2 text-xs text-blue-600 italic">{editedRecs[r.stockName].notes}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Quantamental Insights */}
          {hasQuant && (
            <div className="mt-4 space-y-2">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Quantamental Insights</h4>
              {equity.quantamental.filter((q: any) => q.insights?.length > 0).slice(0, 6).map((q: any, i: number) => {
                const eq = editedQuantamental[q.stockName];
                const classification = eq?.classification ?? q.classification;
                const insights = eq?.insights ?? q.insights ?? [];
                return (
                <div key={i} className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-slate-900">{q.stockName}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${q.overallScore >= 60 ? "bg-emerald-100 text-emerald-700" : q.overallScore >= 40 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>Score: {q.overallScore}/100</span>
                    {editMode ? (
                      <select value={classification} onChange={(e) => setEditedQuantamental(p => ({...p, [q.stockName]: {...(p[q.stockName] || {}), classification: e.target.value}}))}
                        className="text-xs border border-slate-200 rounded px-1.5 py-0.5 bg-white">
                        {["Strong Outperformer","Outperformer","Market Performer","Underperformer","Strong Underperformer"].map(a => <option key={a}>{a}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-400">{classification}</span>
                    )}
                  </div>
                  {editMode ? (
                    <div className="space-y-1 mt-1">
                      {insights.map((ins: string, j: number) => (
                        <div key={j} className="flex items-center gap-1">
                          <input value={ins} onChange={(e) => { const ni = [...insights]; ni[j] = e.target.value; setEditedQuantamental(p => ({...p, [q.stockName]: {...(p[q.stockName] || {}), insights: ni}})); }}
                            className="text-xs border border-slate-200 rounded px-2 py-0.5 bg-white flex-1" />
                          <button onClick={() => { const ni = insights.filter((_:any, k:number) => k !== j); setEditedQuantamental(p => ({...p, [q.stockName]: {...(p[q.stockName] || {}), insights: ni}})); }}
                            className="text-red-400 hover:text-red-600 text-xs px-1">&times;</button>
                        </div>
                      ))}
                      <button onClick={() => { const ni = [...insights, ""]; setEditedQuantamental(p => ({...p, [q.stockName]: {...(p[q.stockName] || {}), insights: ni}})); }}
                        className="text-xs text-blue-600 hover:text-blue-800">+ Add insight</button>
                    </div>
                  ) : (
                    insights.map((ins: string, j: number) => (
                      <p key={j} className="text-xs text-slate-600 ml-1">&bull; {ins}</p>
                    ))
                  )}
                </div>
                );
              })}
            </div>
          )}
        </Sec>
      )}

      {/* ── Dividend Yield ── */}
      {hasDiv && (
        <Sec title="Dividend Yield Analysis" icon={<Percent className="w-4 h-4 text-emerald-600" />}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <Card label="Total Annual Income" value={fmt(equity.dividends.holdings.reduce((s: number, h: any) => s + (h.annualIncome || 0), 0))} />
            <Card label="Avg Portfolio Yield" value={(equity.dividends.holdings.reduce((s: number, h: any) => s + (h.estimatedDividendYield || 0), 0) / equity.dividends.holdings.length).toFixed(1) + "%"} />
            <Card label="Stocks with Dividends" value={equity.dividends.holdings.filter((h: any) => h.annualIncome > 0).length + "/" + equity.dividends.holdings.length} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 px-2 font-medium">Stock</th>
                  <th className="py-2 px-2 font-medium">CMP</th>
                  <th className="py-2 px-2 font-medium">Yield</th>
                  <th className="py-2 px-2 font-medium">DPS</th>
                  <th className="py-2 px-2 font-medium">Annual Income</th>
                  <th className="py-2 px-2 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {equity.dividends.holdings.map((d: any, i: number) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 px-2 font-medium text-slate-900">{d.stockName}</td>
                    <td className="py-2 px-2 tabular-nums text-slate-700">{fmt(d.currentPrice)}</td>
                    <td className="py-2 px-2 tabular-nums text-emerald-600 font-medium">{Number(d.estimatedDividendYield).toFixed(1)}%</td>
                    <td className="py-2 px-2 tabular-nums text-slate-700">{"\u20B9"}{Number(d.dividendPerShare).toFixed(2)}</td>
                    <td className="py-2 px-2 tabular-nums font-medium text-emerald-700">{fmt(d.annualIncome)}</td>
                    <td className="py-2 px-2"><span className={`text-xs px-1.5 py-0.5 rounded-full ${d.classification === "High Yield" ? "bg-emerald-100 text-emerald-700" : d.classification === "Moderate Yield" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{d.classification}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sec>
      )}

      {/* ── Tax Impact ── */}
      {hasTax && (
        <Sec title="Tax Impact Analysis" icon={<Scale className="w-4 h-4 text-violet-600" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Card label="STCG (Short Term)" value={fmt(equity.taxImpact.totalSTCG)} sub={"Tax: " + fmt(equity.taxImpact.totalSTCG ? equity.taxImpact.totalSTCG * 0.2 : 0)} />
            <Card label="STCL (Short Term Loss)" value={fmt(equity.taxImpact.totalSTCL)} cls="text-red-600" />
            <Card label="LTCG (Long Term)" value={fmt(equity.taxImpact.totalLTCG)} sub={"Exempt: " + fmt(equity.taxImpact.ltcgExemption)} />
            <Card label="Estimated Total Tax" value={fmt(equity.taxImpact.estimatedTax)} cls="text-red-600 text-lg" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 px-2 font-medium">Stock</th>
                  <th className="py-2 px-2 font-medium">Term</th>
                  <th className="py-2 px-2 font-medium">Gain/Loss</th>
                  <th className="py-2 px-2 font-medium">Status</th>
                  <th className="py-2 px-2 font-medium">Tax</th>
                </tr>
              </thead>
              <tbody>
                {equity.taxImpact.holdings.map((t: any, i: number) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 px-2 font-medium text-slate-900">{t.stockName}</td>
                    <td className="py-2 px-2 text-xs text-slate-500">{t.term}</td>
                    <td className={`py-2 px-2 tabular-nums font-medium ${pc(t.gainLoss)}`}>{fmt(t.gainLoss)}</td>
                    <td className="py-2 px-2"><span className={`text-xs px-1.5 py-0.5 rounded-full ${t.taxStatus === "Loss" ? "bg-red-100 text-red-700" : t.taxStatus === "STCG" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{t.taxStatus}</span></td>
                    <td className="py-2 px-2 tabular-nums text-red-600">{fmt(t.taxAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sec>
      )}

      {/* ── Investment Style ── */}
      {equity?.investmentStyle?.styleLabel && (
        <Sec title="Investment Style Profile" icon={<Target className="w-4 h-4 text-blue-600" />} open={false}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Card label="Style" value={equity.investmentStyle.styleLabel} />
            <Card label="Quality Factor" value={equity.investmentStyle.qualityFactor} />
            <Card label="Volatility" value={equity.investmentStyle.volatilityTilt} />
            <Card label="Momentum" value={equity.investmentStyle.momentumExposure != null ? Number(equity.investmentStyle.momentumExposure).toFixed(1) + "%" : "\u2014"} />
          </div>
          <div className="flex gap-4 mb-3">
            <div className="flex-1">
              <div className="text-xs text-slate-500 mb-1">Value vs Growth Tilt</div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden flex">
                <div className="bg-blue-500 h-full" style={{ width: (equity.investmentStyle.valueTilt || 0) + "%" }} />
                <div className="bg-emerald-500 h-full" style={{ width: (equity.investmentStyle.growthTilt || 0) + "%" }} />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                <span>Value {Number(equity.investmentStyle.valueTilt || 0).toFixed(0)}%</span>
                <span>Growth {Number(equity.investmentStyle.growthTilt || 0).toFixed(0)}%</span>
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-600">{equity.investmentStyle.interpretation}</p>
        </Sec>
      )}

      {/* ── Rebalancing ── */}
      {hasRebalancing && (
        <Sec title="Rebalancing Suggestions" icon={<BarChart3 className="w-4 h-4 text-emerald-600" />} open={false}>
          <div className="space-y-2">
            {equity.rebalancing.suggestions.map((s: any, i: number) => {
              const ea = editedRebalancing[s.stockName];
              const action = ea?.action ?? s.action;
              const reason = ea?.reason ?? s.reason;
              const isIncrease = action === "Increase" || action === "Buy" || action === "Add";
              const isDecrease = action === "Decrease" || action === "Sell" || action === "Trim" || action === "Exit";
              return (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${isDecrease ? "bg-red-50 border-red-200" : isIncrease ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
                  <span className="shrink-0 mt-0.5">
                    {isDecrease ? <ArrowDownRight className="w-4 h-4 text-red-600" /> : isIncrease ? <ArrowUpRight className="w-4 h-4 text-emerald-600" /> : <Target className="w-4 h-4 text-slate-400" />}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      {s.stockName}:{" "}
                      {editMode ? (
                        <select value={action} onChange={(e) => setEditedRebalancing(p => ({...p, [s.stockName]: {...(p[s.stockName] || {}), action: e.target.value}}))}
                          className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white ml-1">
                          {["Hold","Increase","Decrease","Exit","Add","Trim","Buy","Sell"].map(a => <option key={a}>{a}</option>)}
                        </select>
                      ) : (
                        <span className={isDecrease ? "text-red-600" : isIncrease ? "text-emerald-600" : "text-slate-600"}>{action}</span>
                      )}
                      <span className="text-xs text-slate-400 ml-2">{Number(s.currentWeight).toFixed(1)}% &rarr; {Number(s.targetWeight).toFixed(1)}%</span>
                    </div>
                    {editMode ? (
                      <input value={reason} onChange={(e) => setEditedRebalancing(p => ({...p, [s.stockName]: {...(p[s.stockName] || {}), reason: e.target.value}}))}
                        className="text-xs border border-slate-200 rounded px-2 py-1 bg-white w-full mt-1" />
                    ) : (
                      <p className="text-xs text-slate-500 mt-0.5">{reason}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Sec>
      )}

      {/* ── Scenario Analysis ── */}
      {hasScenarios && (
        <Sec title="Scenario Analysis (Stress Test)" icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} open={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {equity.scenarios.map((s: any, i: number) => (
              <div key={i} className="rounded-lg p-4 border border-slate-200 bg-slate-50">
                <div className="text-sm font-semibold text-slate-900 mb-1">{s.scenario}</div>
                <div className="flex items-baseline gap-3">
                  <span className="text-lg font-bold text-red-600">{fmt(s.projectedLoss)}</span>
                  <span className="text-sm text-red-500">{Number(s.portfolioImpact).toFixed(1)}% impact</span>
                </div>
                <div className="text-xs text-slate-400 mt-1">If market drops {Math.abs(s.drop)}%</div>
              </div>
            ))}
          </div>
        </Sec>
      )}

      {/* ── Value Analysis ── */}
      {equity?.valueAnalysis?.length > 0 && (
        <Sec title={"Value Analysis (" + equity.valueAnalysis.length + " stocks)"} icon={<DollarSign className="w-4 h-4 text-blue-600" />} open={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 px-2 font-medium">Stock</th>
                  <th className="py-2 px-2 font-medium">CMP</th>
                  <th className="py-2 px-2 font-medium">PE</th>
                  <th className="py-2 px-2 font-medium">PB</th>
                  <th className="py-2 px-2 font-medium">D/E</th>
                  <th className="py-2 px-2 font-medium">Signal</th>
                  <th className="py-2 px-2 font-medium w-[300px]">Analysis</th>
                </tr>
              </thead>
              <tbody>
                {equity.valueAnalysis.map((v: any, i: number) => {
                  const ev = editedValue[v.stockName];
                  const signal = ev?.signal ?? v.signal;
                  const narrative = ev?.narrative ?? v.narrative;
                  return (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                    <td className="py-2.5 px-2 font-medium text-slate-900">{v.stockName}</td>
                    <td className="py-2.5 px-2 tabular-nums text-slate-700">{fmt(v.currentPrice)}</td>
                    <td className="py-2.5 px-2 tabular-nums text-slate-700">{v.pe ? Number(v.pe).toFixed(1) : "\u2014"}</td>
                    <td className="py-2.5 px-2 tabular-nums text-slate-700">{v.pb ? Number(v.pb).toFixed(1) : "\u2014"}</td>
                    <td className="py-2.5 px-2 tabular-nums text-slate-700">{v.debtEquity ? Number(v.debtEquity).toFixed(1) : "\u2014"}</td>
                    <td className="py-2.5 px-2">
                      {editMode ? (
                        <select value={signal || ""} onChange={(e) => setEditedValue(p => ({...p, [v.stockName]: {...(p[v.stockName] || {}), signal: e.target.value}}))}
                          className="text-xs border border-slate-200 rounded px-1.5 py-0.5 bg-white">
                          {["Strong Buy","Buy","Hold","Sell","Undervalued","Overvalued","Fair Value"].map(a => <option key={a}>{a}</option>)}
                        </select>
                      ) : <Sig s={signal} />}
                    </td>
                    <td className="py-2.5 px-2 max-w-[300px]">
                      {editMode ? (
                        <textarea value={narrative || ""} onChange={(e) => setEditedValue(p => ({...p, [v.stockName]: {...(p[v.stockName] || {}), narrative: e.target.value}}))}
                          rows={2} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white w-full" />
                      ) : <span className="text-xs text-slate-600">{narrative}</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Sec>
      )}

      {/* ── Growth Analysis ── */}
      {equity?.growthAnalysis?.length > 0 && (
        <Sec title={"Growth Analysis (" + equity.growthAnalysis.length + " stocks)"} icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} open={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 px-2 font-medium">Stock</th>
                  <th className="py-2 px-2 font-medium">Rev Growth</th>
                  <th className="py-2 px-2 font-medium">Earnings Growth</th>
                  <th className="py-2 px-2 font-medium">ROE</th>
                  <th className="py-2 px-2 font-medium">52W Momentum</th>
                  <th className="py-2 px-2 font-medium">Signal</th>
                  <th className="py-2 px-2 font-medium w-[300px]">Analysis</th>
                </tr>
              </thead>
              <tbody>
                {equity.growthAnalysis.map((g: any, i: number) => {
                  const eg = editedGrowth[g.stockName];
                  const signal = eg?.signal ?? g.signal;
                  const narrative = eg?.narrative ?? g.narrative;
                  return (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                    <td className="py-2.5 px-2 font-medium text-slate-900">{g.stockName}</td>
                    <td className={`py-2.5 px-2 tabular-nums ${pc(g.revenueGrowth)}`}>{g.revenueGrowth != null ? pct(g.revenueGrowth) : "\u2014"}</td>
                    <td className={`py-2.5 px-2 tabular-nums ${pc(g.earningsGrowth)}`}>{g.earningsGrowth != null ? pct(g.earningsGrowth) : "\u2014"}</td>
                    <td className="py-2.5 px-2 tabular-nums text-slate-700">{g.roe ? Number(g.roe).toFixed(1) + "%" : "\u2014"}</td>
                    <td className={`py-2.5 px-2 tabular-nums font-medium ${pc(g.momentum52w)}`}>{g.momentum52w != null ? pct(g.momentum52w) : "\u2014"}</td>
                    <td className="py-2.5 px-2">
                      {editMode ? (
                        <select value={signal || ""} onChange={(e) => setEditedGrowth(p => ({...p, [g.stockName]: {...(p[g.stockName] || {}), signal: e.target.value}}))}
                          className="text-xs border border-slate-200 rounded px-1.5 py-0.5 bg-white">
                          {["Strong Growth","Moderate Growth","Stable","Declining","High Growth","Turnaround"].map(a => <option key={a}>{a}</option>)}
                        </select>
                      ) : <Sig s={signal} />}
                    </td>
                    <td className="py-2.5 px-2 max-w-[300px]">
                      {editMode ? (
                        <textarea value={narrative || ""} onChange={(e) => setEditedGrowth(p => ({...p, [g.stockName]: {...(p[g.stockName] || {}), narrative: e.target.value}}))}
                          rows={2} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white w-full" />
                      ) : <span className="text-xs text-slate-600">{narrative}</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Sec>
      )}

      {/* ── MF Deep Analysis ── */}
      {mutualFunds?.holdings?.length > 0 && (
        <Sec title={"Mutual Fund Analysis (" + mutualFunds.holdings.length + " funds)"} icon={<Wallet className="w-4 h-4 text-violet-600" />}>
          {/* MF Risk Metrics Summary */}
          {mutualFunds.riskMetrics && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <Card label="Expected Return" value={mutualFunds.riskMetrics.avgExpectedReturn + "% p.a."} />
              <Card label="Volatility" value={mutualFunds.riskMetrics.avgVolatility + "%"} />
              <Card label="Max Drawdown" value={mutualFunds.riskMetrics.avgMaxDrawdown + "%"} cls="text-red-600" />
              <Card label="Portfolio Risk" value={mutualFunds.riskMetrics.portfolioRisk} cls={mutualFunds.riskMetrics.portfolioRisk === "High" ? "text-red-600" : mutualFunds.riskMetrics.portfolioRisk === "Moderate" ? "text-amber-600" : "text-emerald-600"} />
              <Card label="Direct / Regular" value={mutualFunds.riskMetrics.directCount + " / " + mutualFunds.riskMetrics.regularCount} />
            </div>
          )}

          {/* Category Allocation */}
          {mutualFunds.categoryAllocation?.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Category Allocation</h4>
              <div className="flex flex-wrap gap-2">
                {mutualFunds.categoryAllocation.map((c: any, i: number) => (
                  <div key={i} className="rounded-lg px-3 py-2 border border-violet-200 bg-violet-50">
                    <div className="text-xs text-violet-600 font-medium">{c.name}</div>
                    <div className="text-sm font-bold text-violet-900">{fmt(c.value)} <span className="text-xs font-normal text-violet-500">({Number(c.percent).toFixed(0)}%)</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fund-by-Fund Table */}
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 px-2 font-medium">Fund</th>
                  <th className="py-2 px-2 font-medium">Category</th>
                  <th className="py-2 px-2 font-medium">NAV</th>
                  <th className="py-2 px-2 font-medium">Value</th>
                  <th className="py-2 px-2 font-medium">P&L</th>
                  <th className="py-2 px-2 font-medium">vs Benchmark</th>
                  <th className="py-2 px-2 font-medium">Risk</th>
                  <th className="py-2 px-2 font-medium">Plan</th>
                </tr>
              </thead>
              <tbody>
                {mutualFunds.holdings.map((f: any, i: number) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2.5 px-2">
                      <div className="font-medium text-slate-900 max-w-[200px] truncate" title={f.name}>{f.name}</div>
                      <div className="text-[10px] text-slate-400">{f.benchmark}</div>
                    </td>
                    <td className="py-2.5 px-2"><span className="text-xs px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">{f.category}</span></td>
                    <td className="py-2.5 px-2 tabular-nums text-slate-700">{"₹"}{Number(f.nav).toFixed(2)}</td>
                    <td className="py-2.5 px-2 tabular-nums font-medium text-slate-900">{fmt(f.currentValue)}</td>
                    <td className={`py-2.5 px-2 tabular-nums font-medium ${pc(f.gainLossPercent)}`}>{pct(f.gainLossPercent)}</td>
                    <td className="py-2.5 px-2"><span className={`text-xs px-1.5 py-0.5 rounded-full ${f.performanceRating === "Outperformer" ? "bg-emerald-100 text-emerald-700" : f.performanceRating === "Underperformer" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>{f.performanceRating}</span></td>
                    <td className="py-2.5 px-2"><span className={`text-xs ${f.riskLevel === "High" ? "text-red-600" : f.riskLevel === "Moderate" ? "text-amber-600" : "text-emerald-600"}`}>{f.riskLevel}</span></td>
                    <td className="py-2.5 px-2"><span className={`text-xs px-1.5 py-0.5 rounded ${f.isDirect ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{f.isDirect ? "Direct" : "Regular"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MF Recommendations */}
          {mutualFunds.recommendations?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Recommendations ({mutualFunds.recommendations.length})</h4>
              <div className="space-y-2">
                {mutualFunds.recommendations.map((r: any, i: number) => {
                  const em = editedMfRecs[i];
                  if (em?.deleted) return null;
                  const action = em?.action ?? r.action;
                  const reason = em?.reason ?? r.reason;
                  return (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                    <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 ${r.priority === "high" ? "bg-red-100 text-red-700" : r.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{r.priority}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-slate-900">{r.fund}</span>
                        {editMode ? (
                          <select value={action} onChange={(e) => setEditedMfRecs(p => ({...p, [i]: {...(p[i] || {action: r.action, reason: r.reason}), action: e.target.value}}))}
                            className="text-xs border border-slate-200 rounded px-1.5 py-0.5 bg-white">
                            {["Switch to Direct","Review","Diversify","Consolidate","Increase SIP","Reduce Exposure","Hold","Exit"].map(a => <option key={a}>{a}</option>)}
                          </select>
                        ) : (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${action === "Switch to Direct" ? "bg-blue-100 text-blue-700" : action === "Review" ? "bg-red-100 text-red-700" : action === "Diversify" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>{action}</span>
                        )}
                        {r.category && <span className="text-[10px] text-slate-400">{r.category}</span>}
                      </div>
                      {editMode ? (
                        <input value={reason} onChange={(e) => setEditedMfRecs(p => ({...p, [i]: {...(p[i] || {action: r.action, reason: r.reason}), reason: e.target.value}}))}
                          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white w-full mt-0.5" />
                      ) : (
                        <p className="text-xs text-slate-600">{reason}</p>
                      )}
                    </div>
                    {editMode && (
                      <button onClick={() => setEditedMfRecs(p => ({...p, [i]: {...(p[i] || {action: r.action, reason: r.reason}), deleted: true}}))}
                        className="text-red-400 hover:text-red-600 mt-1"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                  );
                })}
                {editMode && (
                  <>
                    {newMfRecs.map((nr, idx) => (
                      <div key={`new-${idx}`} className="flex items-start gap-3 p-3 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50">
                        <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 bg-blue-100 text-blue-700">new</span>
                        <div className="flex-1">
                          <select value={nr.action} onChange={(e) => { const u = [...newMfRecs]; u[idx] = {...u[idx], action: e.target.value}; setNewMfRecs(u); }}
                            className="text-xs border border-slate-200 rounded px-1.5 py-0.5 bg-white mb-1">
                            {["Switch to Direct","Review","Diversify","Consolidate","Increase SIP","Reduce Exposure","Hold","Exit","Custom"].map(a => <option key={a}>{a}</option>)}
                          </select>
                          <input value={nr.reason} onChange={(e) => { const u = [...newMfRecs]; u[idx] = {...u[idx], reason: e.target.value}; setNewMfRecs(u); }}
                            placeholder="Reason..." className="text-xs border border-slate-200 rounded px-2 py-1 bg-white w-full" />
                        </div>
                        <button onClick={() => setNewMfRecs(p => p.filter((_, k) => k !== idx))}
                          className="text-red-400 hover:text-red-600 mt-1"><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                    <button onClick={() => setNewMfRecs(p => [...p, {action: "Custom", reason: ""}])}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Add Recommendation</button>
                  </>
                )}
              </div>
            </div>
          )}
        </Sec>
      )}

      {/* ── Other Assets (Gold, FD, RE, Insurance, etc.) ── */}
      {data.otherAssets?.categories?.length > 0 && (
        <Sec title={"Other Assets (" + data.otherAssets.summary.holdingsCount + " holdings)"} icon={<Wallet className="w-4 h-4 text-amber-600" />}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <Card label="Total Invested" value={fmt(data.otherAssets.summary.totalInvested)} />
            <Card label="Current Value" value={fmt(data.otherAssets.summary.currentValue)} />
            <Card label="P&L" value={fmt(data.otherAssets.summary.currentValue - data.otherAssets.summary.totalInvested)} cls={pc(data.otherAssets.summary.currentValue - data.otherAssets.summary.totalInvested)} />
          </div>
          {data.otherAssets.categories.map((cat: any) => (
            <div key={cat.type} className="mb-4">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">{cat.label} ({cat.count})</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 px-2 font-medium">Name</th>
                    <th className="py-2 px-2 font-medium">Invested</th>
                    <th className="py-2 px-2 font-medium">Current Value</th>
                    {(cat.type === "fd" || cat.type === "ppf" || cat.type === "nps" || cat.type === "epf" || cat.type === "bond") && <th className="py-2 px-2 font-medium">Rate</th>}
                    {(cat.type === "fd" || cat.type === "bond") && <th className="py-2 px-2 font-medium">Maturity</th>}
                    {cat.type === "insurance" && <th className="py-2 px-2 font-medium">Premium</th>}
                    {cat.type === "insurance" && <th className="py-2 px-2 font-medium">Sum Assured</th>}
                    <th className="py-2 px-2 font-medium">P&L</th>
                  </tr></thead>
                  <tbody>
                    {cat.holdings.map((h: any, i: number) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-2 px-2 font-medium text-slate-900">{h.name}{h.provider ? <span className="text-xs text-slate-400 ml-1">({h.provider})</span> : null}</td>
                        <td className="py-2 px-2 tabular-nums text-slate-700">{fmt(h.investedValue)}</td>
                        <td className="py-2 px-2 tabular-nums font-medium text-slate-900">{fmt(h.currentValue)}</td>
                        {(cat.type === "fd" || cat.type === "ppf" || cat.type === "nps" || cat.type === "epf" || cat.type === "bond") && <td className="py-2 px-2 text-emerald-600">{h.interestRate ? h.interestRate + "%" : "—"}</td>}
                        {(cat.type === "fd" || cat.type === "bond") && <td className="py-2 px-2 text-slate-500">{h.maturityDate || "—"}</td>}
                        {cat.type === "insurance" && <td className="py-2 px-2 tabular-nums">{fmt(h.premium)}</td>}
                        {cat.type === "insurance" && <td className="py-2 px-2 tabular-nums">{fmt(h.sumAssured)}</td>}
                        <td className={`py-2 px-2 tabular-nums font-medium ${pc(h.gainLoss)}`}>{fmt(h.gainLoss)} ({pct(h.gainLossPercent)})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {data.otherAssets.recommendations?.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Recommendations</h4>
              <div className="space-y-2">
                {data.otherAssets.recommendations.map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                    <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 ${r.priority === "high" ? "bg-red-100 text-red-700" : r.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{r.priority}</span>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-900">{r.asset} <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 ml-1">{r.action}</span></div>
                      <p className="text-xs text-slate-600 mt-0.5">{r.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Sec>
      )}

      {/* ── P3: Enhanced MF Sections ── */}
      {mutualFunds?.isEnhanced && (
        <>
          {/* MF Forward Projections */}
          {mutualFunds.forwardProjections?.length > 0 && (
            <Sec title="MF Forward Projections" icon={<TrendingUp className="w-4 h-4 text-blue-600" />} open={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 px-2 font-medium">Horizon</th>
                    <th className="py-2 px-2 font-medium">Expected</th>
                    <th className="py-2 px-2 font-medium">Optimistic</th>
                    <th className="py-2 px-2 font-medium">Pessimistic</th>
                    <th className="py-2 px-2 font-medium">CAGR</th>
                    <th className="py-2 px-2 font-medium">Wealth Multiple</th>
                  </tr></thead>
                  <tbody>
                    {mutualFunds.forwardProjections.map((p: any) => (
                      <tr key={p.years} className="border-b border-slate-100">
                        <td className="py-2 px-2 font-medium text-slate-900">{p.years}Y</td>
                        <td className="py-2 px-2 tabular-nums text-emerald-600 font-medium">{fmt(p.expectedValue)}</td>
                        <td className="py-2 px-2 tabular-nums text-emerald-500">{fmt(p.optimisticValue)}</td>
                        <td className="py-2 px-2 tabular-nums text-red-500">{fmt(p.pessimisticValue)}</td>
                        <td className="py-2 px-2 tabular-nums text-slate-700">{p.expectedCAGR}%</td>
                        <td className="py-2 px-2 tabular-nums text-slate-700">{p.wealthMultiple}x</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Sec>
          )}

          {/* MF Stress Tests */}
          {mutualFunds.stressTests?.length > 0 && (
            <Sec title="MF Stress Test" icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} open={false}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {mutualFunds.stressTests.map((s: any, i: number) => (
                  <div key={i} className="rounded-lg p-4 border border-slate-200 bg-slate-50">
                    <div className="text-sm font-semibold text-slate-900 mb-1">{s.scenario}</div>
                    <div className="text-xs text-slate-500 mb-2">{s.description}</div>
                    <div className="flex items-baseline gap-3">
                      <span className="text-lg font-bold text-red-600">{fmt(s.projectedLoss)}</span>
                      <span className="text-sm text-red-500">{s.portfolioImpact}%</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${s.severity === "High" ? "bg-red-100 text-red-700" : s.severity === "Medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{s.severity}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Sec>
          )}

          {/* MF Health Check */}
          {mutualFunds.healthCheck && (
            <Sec title="MF Health Check" icon={<Shield className="w-4 h-4 text-emerald-600" />} open={false}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(mutualFunds.healthCheck).map(([key, val]: [string, any]) => (
                  <div key={key} className="rounded-lg p-3 border border-slate-200 bg-slate-50">
                    <div className="text-xs text-slate-500 capitalize mb-1">{key.replace(/([A-Z])/g, " $1").trim()}</div>
                    <div className={`text-sm font-bold ${val.status === "Good" || val.score > 70 ? "text-emerald-600" : val.status === "Fair" || val.score > 40 ? "text-amber-600" : "text-red-600"}`}>
                      {val.status} ({val.score}/100)
                    </div>
                    <div className="text-xs text-slate-400 mt-1">{val.message}</div>
                  </div>
                ))}
              </div>
            </Sec>
          )}

          {/* MF Overlap */}
          {mutualFunds.overlapAnalysis?.overlaps?.length > 0 && (
            <Sec title={"MF Overlap Analysis (Level: " + mutualFunds.overlapAnalysis.overallLevel + ")"} icon={<PieChartIcon className="w-4 h-4 text-violet-600" />} open={false}>
              <div className="space-y-2">
                {mutualFunds.overlapAnalysis.overlaps.map((o: any, i: number) => (
                  <div key={i} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-slate-900">{o.category}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${o.severity === "High" ? "bg-red-100 text-red-700" : o.severity === "Medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{o.overlapPct}% overlap</span>
                    </div>
                    <div className="text-xs text-slate-500">{o.funds.join(" • ")}</div>
                  </div>
                ))}
              </div>
            </Sec>
          )}
        </>
      )}

      {/* ── P4: Stock-MF Overlap ── */}
      {data.stockOverlap?.length > 0 && (
        <Sec title={"Stock-MF Overlap (" + data.stockOverlap.length + " stocks)"} icon={<BarChart3 className="w-4 h-4 text-blue-600" />} open={false}>
          <p className="text-xs text-slate-500 mb-3">Stocks you hold directly AND through your mutual funds. High overlap = concentrated risk.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 px-2 font-medium">Stock</th>
                <th className="py-2 px-2 font-medium">Direct %</th>
                <th className="py-2 px-2 font-medium">Via MFs %</th>
                <th className="py-2 px-2 font-medium">Total %</th>
                <th className="py-2 px-2 font-medium">Risk</th>
                <th className="py-2 px-2 font-medium">MF Sources</th>
              </tr></thead>
              <tbody>
                {data.stockOverlap.map((o: any, i: number) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-2 font-medium text-slate-900">{o.stockName}</td>
                    <td className="py-2 px-2 tabular-nums">{o.directExposure}%</td>
                    <td className="py-2 px-2 tabular-nums text-blue-600">{o.mfExposure}%</td>
                    <td className="py-2 px-2 tabular-nums font-semibold">{o.totalExposure}%</td>
                    <td className="py-2 px-2"><span className={`text-xs px-1.5 py-0.5 rounded-full ${o.concentrationRisk === "Critical" ? "bg-red-100 text-red-700" : o.concentrationRisk === "High" ? "bg-red-50 text-red-600" : o.concentrationRisk === "Medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{o.concentrationRisk}</span></td>
                    <td className="py-2 px-2 text-xs text-slate-500 max-w-[200px]">{o.mfSources?.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sec>
      )}
    </div>
  );
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return <div className="flex justify-between"><span className="text-xs text-slate-500">{label}</span><span className={`text-sm font-semibold ${cls || "text-slate-900"}`}>{value}</span></div>;
}

function Card({ label, value, sub, cls }: { label: string; value: any; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg p-3 bg-slate-50 border border-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-sm font-bold ${cls || "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
