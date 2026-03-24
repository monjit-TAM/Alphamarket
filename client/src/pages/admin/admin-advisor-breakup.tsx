import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, BarChart3, TrendingUp, IndianRupee, PieChart, Activity,
  Briefcase, Target, ArrowUpRight, Building2,
} from "lucide-react";
import { useState } from "react";

function formatCurrency(val: number) {
  if (val >= 10000000) return "\u20b9" + (val / 10000000).toFixed(2) + " Cr";
  if (val >= 100000) return "\u20b9" + (val / 100000).toFixed(2) + " L";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

export default function AdminAdvisorBreakup() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/advisor-breakup"],
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <h1 className="text-xl font-bold">Advisor Breakup Dashboard</h1>
        <div className="space-y-4">
          {[1,2,3].map(i => <Card key={i}><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>)}
        </div>
      </div>
    );
  }

  const advisors = data?.advisors || [];
  const summary = data?.summary || {};

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Advisor Breakup Dashboard</h1>
        <Badge variant="outline">{advisors.length} Advisors</Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <BarChart3 className="w-4 h-4 text-blue-500" />
              <span className="text-[10px]">Total Strategies</span>
            </div>
            <p className="text-xl font-bold">{summary.total_strategies || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Target className="w-4 h-4 text-green-500" />
              <span className="text-[10px]">Total Calls</span>
            </div>
            <p className="text-xl font-bold">{summary.total_calls || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <PieChart className="w-4 h-4 text-purple-500" />
              <span className="text-[10px]">Total AUM</span>
            </div>
            <p className="text-xl font-bold">{formatCurrency(summary.total_aum || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <IndianRupee className="w-4 h-4 text-emerald-500" />
              <span className="text-[10px]">Total Revenue</span>
            </div>
            <p className="text-xl font-bold">{formatCurrency(summary.total_revenue || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="w-4 h-4 text-amber-500" />
              <span className="text-[10px]">Active Subscribers</span>
            </div>
            <p className="text-xl font-bold">{summary.active_subscribers || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-Advisor Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Per-Advisor Performance</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-semibold">Advisor</th>
                  <th className="text-center p-3 font-semibold">Strategies</th>
                  <th className="text-center p-3 font-semibold">Calls</th>
                  <th className="text-center p-3 font-semibold">Hit Rate</th>
                  <th className="text-center p-3 font-semibold">Subscribers</th>
                  <th className="text-right p-3 font-semibold">AUM</th>
                  <th className="text-right p-3 font-semibold">Revenue</th>
                  <th className="text-center p-3 font-semibold">Portfolios</th>
                </tr>
              </thead>
              <tbody>
                {advisors.map((adv: any) => (
                  <>
                    <tr
                      key={adv.advisor_id}
                      className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setExpandedId(expandedId === adv.advisor_id ? null : adv.advisor_id)}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {adv.logo ? (
                            <img src={adv.logo} className="w-8 h-8 rounded-full object-cover" alt="" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <Building2 className="w-4 h-4 text-primary" />
                            </div>
                          )}
                          <div>
                            <div className="font-semibold text-xs">{adv.name}</div>
                            <div className="text-[10px] text-muted-foreground">{adv.company || adv.email}</div>
                            {adv.sebi_reg && <div className="text-[9px] text-blue-500">{adv.sebi_reg}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="text-center p-3">
                        <div className="font-bold">{adv.strategies.total}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {adv.strategies.stock}S / {adv.strategies.fno}F
                        </div>
                      </td>
                      <td className="text-center p-3">
                        <div className="font-bold">{adv.calls.total + adv.positions.total}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {adv.calls.this_month + adv.positions.this_month} this month
                        </div>
                      </td>
                      <td className="text-center p-3">
                        <Badge variant={adv.calls.hit_rate !== "N/A" && Number(adv.calls.hit_rate) >= 60 ? "default" : "secondary"}>
                          {adv.calls.hit_rate}%
                        </Badge>
                      </td>
                      <td className="text-center p-3">
                        <div className="font-bold">{adv.subscribers.active}</div>
                        <div className="text-[10px] text-muted-foreground">{adv.subscribers.total} total</div>
                      </td>
                      <td className="text-right p-3">
                        <div className="font-bold text-green-600">{formatCurrency(adv.portfolios.total_aum)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          S:{formatCurrency(adv.portfolios.stock_aum)} M:{formatCurrency(adv.portfolios.mf_aum)}
                        </div>
                      </td>
                      <td className="text-right p-3">
                        <div className="font-bold">{formatCurrency(adv.revenue.total)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          Cr:{formatCurrency(adv.revenue.credits)}
                        </div>
                      </td>
                      <td className="text-center p-3">
                        <div className="font-bold">{adv.portfolios.total}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {adv.portfolios.stock_count}S / {adv.portfolios.mf_count}MF
                        </div>
                      </td>
                    </tr>
                    {expandedId === adv.advisor_id && (
                      <tr key={adv.advisor_id + "-detail"}>
                        <td colSpan={8} className="p-4 bg-muted/20 border-b">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                            <div>
                              <div className="font-semibold text-muted-foreground mb-2">Strategies</div>
                              {adv.strategies.list.map((s: any) => (
                                <div key={s.id} className="flex items-center justify-between py-1 border-b border-muted/50">
                                  <span>{s.name}</span>
                                  <Badge variant="outline" className="text-[9px]">{s.type}</Badge>
                                </div>
                              ))}
                              {adv.strategies.list.length === 0 && <div className="text-muted-foreground">No strategies</div>}
                            </div>
                            <div>
                              <div className="font-semibold text-muted-foreground mb-2">Calls Breakup</div>
                              <div className="space-y-1">
                                <div className="flex justify-between"><span>Stock Calls:</span><span className="font-bold">{adv.calls.total}</span></div>
                                <div className="flex justify-between"><span>Active:</span><span className="text-green-500">{adv.calls.active}</span></div>
                                <div className="flex justify-between"><span>Closed:</span><span>{adv.calls.closed}</span></div>
                                <div className="flex justify-between"><span>F&O Positions:</span><span className="font-bold">{adv.positions.total}</span></div>
                                <div className="flex justify-between"><span>F&O Active:</span><span className="text-green-500">{adv.positions.active}</span></div>
                              </div>
                            </div>
                            <div>
                              <div className="font-semibold text-muted-foreground mb-2">Revenue & Credits</div>
                              <div className="space-y-1">
                                <div className="flex justify-between"><span>Revenue:</span><span className="font-bold text-green-600">{formatCurrency(adv.revenue.total)}</span></div>
                                <div className="flex justify-between"><span>Credits:</span><span>{formatCurrency(adv.revenue.credits)}</span></div>
                                <div className="flex justify-between"><span>Payouts:</span><span>{formatCurrency(adv.revenue.payouts)}</span></div>
                              </div>
                            </div>
                            <div>
                              <div className="font-semibold text-muted-foreground mb-2">Portfolio AUM</div>
                              <div className="space-y-1">
                                <div className="flex justify-between"><span>Total AUM:</span><span className="font-bold">{formatCurrency(adv.portfolios.total_aum)}</span></div>
                                <div className="flex justify-between"><span>Stock Portfolios:</span><span>{adv.portfolios.stock_count} ({formatCurrency(adv.portfolios.stock_aum)})</span></div>
                                <div className="flex justify-between"><span>MF Portfolios:</span><span>{adv.portfolios.mf_count} ({formatCurrency(adv.portfolios.mf_aum)})</span></div>
                                <div className="flex justify-between"><span>Total Count:</span><span>{adv.portfolios.total}</span></div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {advisors.length === 0 && (
                  <tr><td colSpan={8} className="text-center p-8 text-muted-foreground">No advisors found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
