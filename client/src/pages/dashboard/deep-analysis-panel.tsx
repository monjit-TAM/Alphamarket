import { useState } from "react";
import {
  Shield, TrendingUp, TrendingDown, AlertTriangle,
  BarChart3, PieChart as PieChartIcon, Target, Zap, Scale, Wallet,
  ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, Percent, DollarSign,
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

export default function DeepAnalysisPanel({ data }: { data: any }) {
  if (!data) return null;
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
  const hasMFSugg = mutualFunds?.suggestions?.length > 0;

  return (
    <div className="space-y-4">
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
                      <td className="py-2.5 px-2"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${actionColor}`}>{r.overallAction}</span></td>
                      <td className="py-2.5 px-2"><span className={`text-xs font-medium ${r.confidence === "High" ? "text-emerald-600" : r.confidence === "Medium" ? "text-amber-600" : "text-slate-400"}`}>{r.confidence}</span></td>
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
              {equity.quantamental.filter((q: any) => q.insights?.length > 0).slice(0, 6).map((q: any, i: number) => (
                <div key={i} className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-slate-900">{q.stockName}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${q.overallScore >= 60 ? "bg-emerald-100 text-emerald-700" : q.overallScore >= 40 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>Score: {q.overallScore}/100</span>
                    <span className="text-xs text-slate-400">{q.classification}</span>
                  </div>
                  {q.insights.map((ins: string, j: number) => (
                    <p key={j} className="text-xs text-slate-600 ml-1">&bull; {ins}</p>
                  ))}
                </div>
              ))}
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
              const isIncrease = s.action === "Increase" || s.action === "Buy" || s.action === "Add";
              const isDecrease = s.action === "Decrease" || s.action === "Sell" || s.action === "Trim" || s.action === "Exit";
              return (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${isDecrease ? "bg-red-50 border-red-200" : isIncrease ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
                  <span className="shrink-0 mt-0.5">
                    {isDecrease ? <ArrowDownRight className="w-4 h-4 text-red-600" /> : isIncrease ? <ArrowUpRight className="w-4 h-4 text-emerald-600" /> : <Target className="w-4 h-4 text-slate-400" />}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      {s.stockName}: <span className={isDecrease ? "text-red-600" : isIncrease ? "text-emerald-600" : "text-slate-600"}>{s.action}</span>
                      <span className="text-xs text-slate-400 ml-2">{Number(s.currentWeight).toFixed(1)}% &rarr; {Number(s.targetWeight).toFixed(1)}%</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{s.reason}</p>
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

      {/* ── MF Suggestions ── */}
      {hasMFSugg && (
        <Sec title={"Mutual Fund Insights (" + mutualFunds.suggestions.length + ")"} icon={<Wallet className="w-4 h-4 text-violet-600" />}>
          <div className="space-y-2">
            {mutualFunds.suggestions.map((s: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 ${s.priority === "high" ? "bg-red-100 text-red-700" : s.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{s.priority}</span>
                <div>
                  {s.fund && <div className="text-sm font-medium text-slate-900 mb-0.5">{s.fund}</div>}
                  <p className="text-sm text-slate-600">{s.message}</p>
                </div>
              </div>
            ))}
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
