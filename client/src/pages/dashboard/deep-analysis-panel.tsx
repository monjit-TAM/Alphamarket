import { useState } from "react";
import {
  Shield, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  BarChart3, PieChart as PieChartIcon, Target, Zap, Scale, Wallet,
  ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";

const SECTOR_COLORS = ["#2563eb","#7c3aed","#0891b2","#d97706","#059669","#dc2626","#6366f1","#f59e0b","#8b5cf6","#64748b"];
const GRADE_COLORS: Record<string, string> = { A: "#059669", B: "#16a34a", C: "#d97706", D: "#dc2626", F: "#991b1b" };

function formatINR(v: number | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  if (Math.abs(n) >= 10000000) return "\u20B9" + (n / 10000000).toFixed(2) + " Cr";
  if (Math.abs(n) >= 100000) return "\u20B9" + (n / 100000).toFixed(2) + " L";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function pnlColor(v: number): string { return v >= 0 ? "text-emerald-600" : "text-red-600"; }

function Section({ title, icon, children, defaultOpen = true }: { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">{icon} {title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

export default function DeepAnalysisPanel({ data }: { data: any }) {
  if (!data) return null;
  const { equity, mutualFunds, combined } = data;
  const hs = equity?.healthScore;

  // Prepare sector data for pie chart
  const sectorData = equity?.sectorAllocation
    ? Object.entries(equity.sectorAllocation).map(([name, pct]: [string, any], i) => ({ name, value: Number(pct), color: SECTOR_COLORS[i % SECTOR_COLORS.length] }))
    : [];

  // Health score components for radar
  const healthComponents = hs?.components
    ? Object.entries(hs.components).map(([key, val]: [string, any]) => ({ subject: key.charAt(0).toUpperCase() + key.slice(1), score: val.score || 0 }))
    : [];

  return (
    <div className="space-y-4">
      {/* Hero: Health Score + Combined Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Health Score Card */}
        {hs && (
          <div className="lg:col-span-1 rounded-xl border-2 p-5 flex flex-col items-center justify-center"
            style={{ borderColor: GRADE_COLORS[hs.grade] || "#d97706", backgroundColor: (GRADE_COLORS[hs.grade] || "#d97706") + "08" }}>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Portfolio Health</div>
            <div className="text-5xl font-bold mb-1" style={{ color: GRADE_COLORS[hs.grade] || "#d97706" }}>{hs.overall}</div>
            <div className="text-lg font-semibold mb-2" style={{ color: GRADE_COLORS[hs.grade] || "#d97706" }}>Grade {hs.grade}</div>
            <p className="text-xs text-slate-500 text-center">{hs.summary}</p>
          </div>
        )}

        {/* Health Components Radar */}
        {healthComponents.length > 0 && (
          <div className="lg:col-span-1 rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-semibold text-slate-600 mb-2">Score Breakdown</div>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={healthComponents}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "#64748b" }} />
                <Radar dataKey="score" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-1 mt-2">
              {healthComponents.map((c) => (
                <div key={c.subject} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">{c.subject}</span>
                  <span className={`font-semibold ${c.score >= 70 ? "text-emerald-600" : c.score >= 40 ? "text-amber-600" : "text-red-600"}`}>{c.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Combined Summary */}
        {combined && (
          <div className="lg:col-span-1 rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-semibold text-slate-600 mb-3">Combined Portfolio</div>
            <div className="space-y-3">
              <div className="flex justify-between"><span className="text-xs text-slate-500">Invested</span><span className="text-sm font-semibold">{formatINR(combined.totalInvested)}</span></div>
              <div className="flex justify-between"><span className="text-xs text-slate-500">Current Value</span><span className="text-sm font-semibold">{formatINR(combined.currentValue)}</span></div>
              <div className="flex justify-between"><span className="text-xs text-slate-500">Total P&L</span><span className={`text-sm font-bold ${pnlColor(combined.totalPnl)}`}>{formatINR(combined.totalPnl)} ({Number(combined.totalPnlPercent).toFixed(1)}%)</span></div>
              <div className="h-px bg-slate-200 my-2" />
              <div className="flex justify-between"><span className="text-xs text-slate-500">Equity</span><span className="text-sm">{formatINR(combined.assetAllocation?.equity?.current)} ({Number(combined.assetAllocation?.equity?.percent || 0).toFixed(0)}%)</span></div>
              <div className="flex justify-between"><span className="text-xs text-slate-500">Mutual Funds</span><span className="text-sm">{formatINR(combined.assetAllocation?.mutualFunds?.current)} ({Number(combined.assetAllocation?.mutualFunds?.percent || 0).toFixed(0)}%)</span></div>
            </div>
          </div>
        )}
      </div>

      {/* Sector Allocation Pie */}
      {sectorData.length > 0 && (
        <Section title="Sector Allocation" icon={<PieChartIcon className="w-4 h-4 text-blue-600" />}>
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
                <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-slate-200">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}: {s.value.toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* Enhanced Recommendations */}
      {equity?.enhancedRecommendations && equity.enhancedRecommendations.length > 0 && (
        <Section title="Stock-by-Stock Analysis" icon={<Zap className="w-4 h-4 text-amber-600" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-2 px-2 font-medium text-slate-600">Stock</th>
                  <th className="py-2 px-2 font-medium text-slate-600">CMP</th>
                  <th className="py-2 px-2 font-medium text-slate-600">Value</th>
                  <th className="py-2 px-2 font-medium text-slate-600">Growth</th>
                  <th className="py-2 px-2 font-medium text-slate-600">Quant</th>
                  <th className="py-2 px-2 font-medium text-slate-600">Action</th>
                  <th className="py-2 px-2 font-medium text-slate-600">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {equity.enhancedRecommendations.map((r: any, i: number) => {
                  const actionColor = (r.overallAction || "").includes("Buy") ? "bg-emerald-100 text-emerald-700" : (r.overallAction || "").includes("Sell") ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
                  return (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-2 font-medium text-slate-900">{r.stockName}</td>
                      <td className="py-2 px-2 text-slate-700 tabular-nums">{formatINR(r.currentPrice)}</td>
                      <td className="py-2 px-2"><SignalBadge signal={r.valueSignal} /></td>
                      <td className="py-2 px-2"><SignalBadge signal={r.growthSignal} /></td>
                      <td className="py-2 px-2"><SignalBadge signal={r.quantSignal} /></td>
                      <td className="py-2 px-2"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${actionColor}`}>{r.overallAction}</span></td>
                      <td className="py-2 px-2"><span className={`text-xs ${r.confidence === "High" ? "text-emerald-600" : r.confidence === "Medium" ? "text-amber-600" : "text-slate-500"}`}>{r.confidence}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Tax Impact */}
      {equity?.taxImpact && (
        <Section title="Tax Impact Analysis" icon={<Scale className="w-4 h-4 text-violet-600" />} defaultOpen={false}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <TaxCard label="LTCG (>1yr)" value={equity.taxImpact.ltcg?.gain} tax={equity.taxImpact.ltcg?.tax} />
            <TaxCard label="STCG (<1yr)" value={equity.taxImpact.stcg?.gain} tax={equity.taxImpact.stcg?.tax} />
            <div className="rounded-lg p-3 bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500">Total Unrealised Tax</div>
              <div className="text-lg font-bold text-red-600">{formatINR(equity.taxImpact.totalTax)}</div>
            </div>
            <div className="rounded-lg p-3 bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500">Tax Harvesting</div>
              <div className="text-sm font-medium text-emerald-600">{equity.taxImpact.harvestingOpportunities?.length || 0} opportunities</div>
            </div>
          </div>
          {equity.taxImpact.harvestingOpportunities?.length > 0 && (
            <div className="mt-3 space-y-1">
              {equity.taxImpact.harvestingOpportunities.map((h: any, i: number) => (
                <div key={i} className="text-xs p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-700">
                  <span className="font-medium">{h.stock}:</span> Sell to harvest {formatINR(h.loss)} loss (offset {formatINR(h.taxSaved)} tax)
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Investment Style */}
      {equity?.investmentStyle && (
        <Section title="Investment Style Profile" icon={<Target className="w-4 h-4 text-blue-600" />} defaultOpen={false}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StyleCard label="Primary Style" value={equity.investmentStyle.primary} />
            <StyleCard label="Risk Level" value={equity.investmentStyle.riskLevel} />
            <StyleCard label="Time Horizon" value={equity.investmentStyle.horizon} />
            <StyleCard label="Concentration" value={equity.investmentStyle.concentration} />
          </div>
          {equity.investmentStyle.insights && (
            <div className="mt-3 space-y-1">
              {(Array.isArray(equity.investmentStyle.insights) ? equity.investmentStyle.insights : []).map((ins: string, i: number) => (
                <p key={i} className="text-xs text-slate-600">• {ins}</p>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Rebalancing */}
      {equity?.rebalancing?.suggestions && equity.rebalancing.suggestions.length > 0 && (
        <Section title="Rebalancing Suggestions" icon={<BarChart3 className="w-4 h-4 text-emerald-600" />} defaultOpen={false}>
          <div className="space-y-2">
            {equity.rebalancing.suggestions.map((s: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                <span className={`shrink-0 mt-0.5 ${s.action === "BUY" || s.action === "ADD" ? "text-emerald-600" : s.action === "SELL" || s.action === "TRIM" ? "text-red-600" : "text-amber-600"}`}>
                  {s.action === "BUY" || s.action === "ADD" ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                </span>
                <div>
                  <div className="text-sm font-medium text-slate-900">{s.stock}: <span className={s.action === "BUY" || s.action === "ADD" ? "text-emerald-600" : "text-red-600"}>{s.action}</span></div>
                  <p className="text-xs text-slate-500">{s.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* MF Suggestions */}
      {mutualFunds?.suggestions && mutualFunds.suggestions.length > 0 && (
        <Section title="Mutual Fund Insights" icon={<Wallet className="w-4 h-4 text-violet-600" />}>
          <div className="space-y-2">
            {mutualFunds.suggestions.map((s: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 ${s.priority === "high" ? "bg-red-100 text-red-700" : s.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{s.priority}</span>
                <p className="text-sm text-slate-600">{s.message}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Scenarios */}
      {equity?.scenarios && equity.scenarios.length > 0 && (
        <Section title="Scenario Analysis" icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {equity.scenarios.map((s: any, i: number) => (
              <div key={i} className={`rounded-lg p-4 border ${s.type === "bull" ? "bg-emerald-50 border-emerald-200" : s.type === "bear" ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"}`}>
                <div className={`text-sm font-semibold mb-1 ${s.type === "bull" ? "text-emerald-700" : s.type === "bear" ? "text-red-700" : "text-blue-700"}`}>{s.name || s.type}</div>
                <div className={`text-xl font-bold ${s.type === "bull" ? "text-emerald-600" : s.type === "bear" ? "text-red-600" : "text-blue-600"}`}>{formatINR(s.portfolioValue)}</div>
                <div className="text-xs text-slate-500 mt-1">{s.description || (s.changePercent ? (s.changePercent > 0 ? "+" : "") + Number(s.changePercent).toFixed(1) + "% from current" : "")}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  if (!signal) return <span className="text-xs text-slate-400">—</span>;
  const color = signal.includes("Strong Buy") ? "bg-emerald-100 text-emerald-700" :
    signal.includes("Buy") ? "bg-emerald-50 text-emerald-600" :
    signal.includes("Sell") ? "bg-red-100 text-red-700" :
    "bg-slate-100 text-slate-600";
  return <span className={`text-xs px-1.5 py-0.5 rounded ${color}`}>{signal}</span>;
}

function TaxCard({ label, value, tax }: { label: string; value?: number; tax?: number }) {
  return (
    <div className="rounded-lg p-3 bg-slate-50 border border-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{formatINR(value)}</div>
      <div className="text-xs text-red-600">Tax: {formatINR(tax)}</div>
    </div>
  );
}

function StyleCard({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg p-3 bg-slate-50 border border-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value || "—"}</div>
    </div>
  );
}
