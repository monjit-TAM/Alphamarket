import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, ArrowUp, ArrowDown, Calendar, Shield, ShieldCheck, AlertTriangle, Zap, BarChart3, Eye, Heart, Bell, X, Fingerprint } from "lucide-react";
import type { Call, Position, Subscription, User, Strategy } from "@shared/schema";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useState } from "react";

interface LivePrice {
  symbol: string;
  exchange: string;
  ltp: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
}

interface EnrichedSubscription extends Subscription {
  strategyName: string;
  strategyType: string;
  strategySegment: string;
  strategyCagr: string;
  strategyHorizon: string;
  strategyRisk: string;
  strategyStatus: string;
  strategyDescription: string;
  advisorName: string;
  advisorSebi: string;
  planName: string;
  planDuration: string;
  planPrice: string;
  requiresRiskProfiling: boolean;
}

interface EnrichedCall extends Call {
  strategyName: string;
  advisorName: string;
  strategyType?: string;
}

interface EnrichedPosition extends Position {
  strategyName: string;
  advisorName: string;
  strategyType?: string;
  action?: string;
  expiryDate?: string | null;
  optionType?: string | null;
  targetPrice?: string | null;
}

interface RecommendationsData {
  calls: EnrichedCall[];
  positions: EnrichedPosition[];
}

function getRiskBadge(risk: string | null | undefined) {
  if (!risk) return null;
  const lower = risk.toLowerCase();
  if (lower.includes("high")) return <Badge variant="destructive" data-testid={`badge-risk-${risk}`}>{risk}</Badge>;
  if (lower.includes("low")) return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" data-testid={`badge-risk-${risk}`}>{risk}</Badge>;
  return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" data-testid={`badge-risk-${risk}`}>{risk}</Badge>;
}

const PERFORMANCE_PERIODS = [
  { key: "1W", label: "1 Week", days: 7 },
  { key: "1M", label: "1 Month", days: 30 },
  { key: "3M", label: "3 Months", days: 90 },
  { key: "6M", label: "6 Months", days: 180 },
  { key: "1Y", label: "1 Year", days: 365 },
  { key: "3Y", label: "3 Years", days: 1095 },
  { key: "Max", label: "Max", days: 99999 },
];

export default function InvestorDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [perfPeriod, setPerfPeriod] = useState("Max");

  if (!user) {
    navigate("/login");
    return null;
  }

  const { data: subscriptions, isLoading: loadingSubs } = useQuery<EnrichedSubscription[]>({
    queryKey: ["/api/investor/subscriptions"],
  });

  const { data: recommendations, isLoading: loadingRecs } = useQuery<RecommendationsData>({
    queryKey: ["/api/investor/recommendations"],
  });

  interface WatchlistItem {
    id: string;
    userId: string;
    itemType: string;
    itemId: string;
    createdAt: string;
    strategy?: Strategy & { advisor?: Partial<User> };
    advisor?: Partial<User>;
    newCalls?: number;
  }

  const { data: watchlistItems } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/investor/watchlist"],
  });

  const activeCalls = (recommendations?.calls || []).filter(c => c.status === "Active");
  const closedCalls = (recommendations?.calls || []).filter(c => c.status === "Closed");
  const activePositions = (recommendations?.positions || []).filter(p => p.status === "Active");
  const closedPositions = (recommendations?.positions || []).filter(p => p.status === "Closed");

  const activeCallSymbols = activeCalls.map(c => ({ symbol: c.stockName, strategyType: c.strategyType || "Equity" }));
  const activePositionSymbols = activePositions.map(p => ({ symbol: p.symbol, strategyType: p.strategyType || "Option" }));
  const allActiveSymbols = [...activeCallSymbols, ...activePositionSymbols];

  const { data: livePrices } = useQuery<Record<string, LivePrice>>({
    queryKey: ["/api/live-prices", "investor-dashboard"],
    queryFn: async () => {
      if (!allActiveSymbols.length) return {};
      const res = await apiRequest("POST", "/api/live-prices/bulk", { symbols: allActiveSymbols });
      return res.json();
    },
    enabled: allActiveSymbols.length > 0,
    refetchInterval: 15000,
  });

  const fnoPositionGroups = activePositions
    .filter(p => p.symbol && p.expiry && p.strikePrice && p.callPut)
    .reduce<Record<string, { symbol: string; expiry: string; exchange: string }>>((acc, p) => {
      const exchange = ["SENSEX", "BANKEX"].includes(p.symbol!.toUpperCase()) ? "BSE" : "NSE";
      const key = `${p.symbol}:${p.expiry}`;
      if (!acc[key]) acc[key] = { symbol: p.symbol!, expiry: p.expiry!, exchange };
      return acc;
    }, {});

  const { data: optionChainData } = useQuery<Record<string, any[]>>({
    queryKey: ["/api/option-chain-premiums", "investor", JSON.stringify(fnoPositionGroups)],
    queryFn: async () => {
      const results: Record<string, any[]> = {};
      const entries = Object.entries(fnoPositionGroups);
      await Promise.all(
        entries.map(async ([key, { symbol, expiry, exchange }]) => {
          try {
            const res = await fetch(`/api/option-chain?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}&expiry=${encodeURIComponent(expiry)}`);
            if (res.ok) results[key] = await res.json();
          } catch {}
        })
      );
      return results;
    },
    enabled: Object.keys(fnoPositionGroups).length > 0,
    refetchInterval: 15000,
  });

  const getOptionPremiumLTP = (pos: EnrichedPosition): number | null => {
    if (!pos.symbol || !pos.expiry || !pos.strikePrice || !optionChainData) return null;
    const key = `${pos.symbol}:${pos.expiry}`;
    const chain = optionChainData[key];
    if (!chain) return null;
    const strike = chain.find((s: any) => String(s.strikePrice) === String(pos.strikePrice));
    if (!strike) return null;
    return pos.callPut === "Put" ? (strike.pe?.ltp ?? null) : (strike.ce?.ltp ?? null);
  };

  const selectedPeriod = PERFORMANCE_PERIODS.find(p => p.key === perfPeriod) || PERFORMANCE_PERIODS[6];
  const periodCutoff = new Date();
  periodCutoff.setDate(periodCutoff.getDate() - selectedPeriod.days);

  const getClosedRecsInPeriod = () => {
    const filteredCalls = closedCalls.filter(c => {
      const exitDate = c.exitDate ? new Date(c.exitDate) : null;
      return exitDate && exitDate >= periodCutoff;
    });
    const filteredPositions = closedPositions.filter(p => {
      const exitDate = p.exitDate ? new Date(p.exitDate) : null;
      return exitDate && exitDate >= periodCutoff;
    });
    return { calls: filteredCalls, positions: filteredPositions };
  };

  const periodRecs = getClosedRecsInPeriod();
  const totalClosedRecs = periodRecs.calls.length + periodRecs.positions.length;
  const profitableRecs = [
    ...periodRecs.calls.filter(c => Number(c.gainPercent || 0) > 0),
    ...periodRecs.positions.filter(p => Number(p.gainPercent || 0) > 0),
  ].length;
  const avgGain = totalClosedRecs > 0
    ? ([...periodRecs.calls, ...periodRecs.positions].reduce((sum, r) => sum + Number(r.gainPercent || 0), 0) / totalClosedRecs).toFixed(2)
    : "0";
  const successRate = totalClosedRecs > 0 ? ((profitableRecs / totalClosedRecs) * 100).toFixed(1) : "0";

  if (loadingSubs) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-4 w-full">
          <Skeleton className="h-8 w-60" />
          <div className="grid md:grid-cols-3 gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6 w-full">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold" data-testid="text-investor-dashboard-title">My Dashboard</h1>
          <Link href="/strategies">
            <Button variant="outline" size="sm" data-testid="button-explore-strategies">
              <Eye className="w-3 h-3 mr-1" /> Explore Strategies
            </Button>
          </Link>
        </div>

        {subscriptions && subscriptions.filter(s => s.status === "active" && s.requiresRiskProfiling && !s.riskProfiling).map(sub => (
          <Card key={`rp-${sub.id}`} className="border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20" data-testid={`banner-risk-profiling-${sub.id}`}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  {!sub.ekycDone ? (
                    <>
                      <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm">Compliance Pending - {sub.strategyName}</h3>
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Complete eKYC and risk profiling to access live recommendations for <strong>{sub.strategyName}</strong>.
                      </p>
                      <div className="pt-2">
                        <Link href={`/ekyc?subscriptionId=${sub.id}`}>
                          <Button size="sm" data-testid={`button-ekyc-then-rp-${sub.id}`}>
                            <Fingerprint className="w-3.5 h-3.5 mr-1" /> Complete eKYC First
                          </Button>
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm">Risk Profiling Incomplete - {sub.strategyName}</h3>
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Your access to live recommendations for <strong>{sub.strategyName}</strong> is restricted until you complete your risk profile.
                      </p>
                      <div className="pt-2">
                        <Link href={`/risk-profiling?subscriptionId=${sub.id}`}>
                          <Button size="sm" data-testid={`button-complete-risk-profiling-${sub.id}`}>
                            <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Complete Risk Profiling Now
                          </Button>
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {(!subscriptions || subscriptions.length === 0) ? (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground/50" />
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">No Active Subscriptions</h3>
                <p className="text-sm text-muted-foreground">Subscribe to strategies to see recommendations and track performance.</p>
              </div>
              <Link href="/strategies">
                <Button data-testid="button-browse-strategies">Browse Strategies</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-4">
              <h2 className="text-lg font-semibold" data-testid="text-subscribed-strategies">My Subscribed Strategies ({subscriptions.length})</h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {subscriptions.map((sub) => (
                  <Card key={sub.id} className="hover-elevate" data-testid={`card-subscription-${sub.id}`}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/strategies/${sub.strategyId}`}>
                            <h3 className="font-semibold text-sm truncate hover:underline cursor-pointer" data-testid={`text-strategy-name-${sub.id}`}>{sub.strategyName}</h3>
                          </Link>
                          <p className="text-xs text-muted-foreground mt-0.5">{sub.advisorName}</p>
                        </div>
                        {getRiskBadge(sub.strategyRisk)}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Type</span>
                          <p className="font-medium">{sub.strategyType || "--"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Horizon</span>
                          <p className="font-medium">{sub.strategyHorizon || "--"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Plan</span>
                          <p className="font-medium">{sub.planName || "--"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">CAGR</span>
                          <p className="font-medium">{Number(sub.strategyCagr) || 0}%</p>
                        </div>
                      </div>
                      {sub.status === "active" && !sub.ekycDone && (
                        <Link href={`/ekyc?subscriptionId=${sub.id}`}>
                          <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/20 cursor-pointer hover-elevate" data-testid={`banner-ekyc-pending-${sub.id}`}>
                            <Fingerprint className="w-4 h-4 text-primary shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">eKYC Pending</p>
                              <p className="text-[10px] text-muted-foreground">Complete Aadhaar & PAN verification</p>
                            </div>
                          </div>
                        </Link>
                      )}
                      {sub.status === "active" && sub.requiresRiskProfiling && !sub.riskProfiling && sub.ekycDone && (
                        <Link href={`/risk-profiling?subscriptionId=${sub.id}`}>
                          <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 cursor-pointer hover-elevate" data-testid={`banner-rp-pending-${sub.id}`}>
                            <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Risk Profiling Pending</p>
                              <p className="text-[10px] text-amber-600 dark:text-amber-500">Access restricted - complete to unlock</p>
                            </div>
                          </div>
                        </Link>
                      )}
                      <div className="flex items-center justify-between text-xs pt-1 border-t">
                        <div className="text-muted-foreground">
                          <Calendar className="w-3 h-3 inline mr-1" />
                          Subscribed: {sub.createdAt ? new Date(sub.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "--"}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {sub.ekycDone && <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">KYC Done</Badge>}
                          <Badge variant="secondary" className="text-[10px]">{sub.status}</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-lg font-semibold" data-testid="text-performance-title">Strategy Performance</h2>
                <div className="flex gap-1 flex-wrap">
                  {PERFORMANCE_PERIODS.map(p => (
                    <Button
                      key={p.key}
                      size="sm"
                      variant={perfPeriod === p.key ? "default" : "outline"}
                      className="text-xs"
                      onClick={() => setPerfPeriod(p.key)}
                      data-testid={`button-period-${p.key}`}
                    >
                      {p.key}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4 text-center space-y-1">
                    <p className="text-xs text-muted-foreground">Closed Recs</p>
                    <p className="text-xl font-bold" data-testid="text-total-closed">{totalClosedRecs}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center space-y-1">
                    <p className="text-xs text-muted-foreground">Profitable</p>
                    <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-profitable">{profitableRecs}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center space-y-1">
                    <p className="text-xs text-muted-foreground">Avg Gain %</p>
                    <p className={`text-xl font-bold ${Number(avgGain) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-avg-gain">{avgGain}%</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center space-y-1">
                    <p className="text-xs text-muted-foreground">Success Rate</p>
                    <p className="text-xl font-bold" data-testid="text-success-rate">{successRate}%</p>
                  </CardContent>
                </Card>
              </div>
            </div>

            <Tabs defaultValue="active" className="space-y-4">
              <TabsList>
                <TabsTrigger value="active" data-testid="tab-active-recs">
                  Active ({activeCalls.length + activePositions.length})
                </TabsTrigger>
                <TabsTrigger value="closed" data-testid="tab-closed-recs">
                  Past / Closed ({closedCalls.length + closedPositions.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="active">
                <Card>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">Active Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {activeCalls.length === 0 && activePositions.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No active recommendations at the moment
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" data-testid="table-active-recommendations">
                          <thead>
                            <tr className="border-b text-xs text-muted-foreground">
                              <th className="text-left py-2 px-3 font-medium">Stock</th>
                              <th className="text-left py-2 px-3 font-medium">Buy Price</th>
                              <th className="text-left py-2 px-3 font-medium">LTP</th>
                              <th className="text-left py-2 px-3 font-medium">P&L %</th>
                              <th className="text-left py-2 px-3 font-medium">Target</th>
                              <th className="text-left py-2 px-3 font-medium">Stop Loss</th>
                              <th className="text-left py-2 px-3 font-medium">Advisor</th>
                              <th className="text-left py-2 px-3 font-medium">Strategy</th>
                              <th className="text-left py-2 px-3 font-medium">Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {activeCalls.map(call => {
                              const lp = livePrices?.[call.stockName];
                              const buyPrice = Number(call.entryPrice || call.buyRangeStart || 0);
                              const currentPrice = lp?.ltp || 0;
                              const isSell = call.action === "Sell";
                              const pnl = buyPrice > 0 && currentPrice > 0
                                ? (isSell ? ((buyPrice - currentPrice) / buyPrice) * 100 : ((currentPrice - buyPrice) / buyPrice) * 100)
                                : null;
                              return (
                                <tr key={`call-${call.id}`} className="border-b last:border-0" data-testid={`row-active-call-${call.id}`}>
                                  <td className="py-2 px-3 font-medium">{call.stockName}</td>
                                  <td className="py-2 px-3">{buyPrice ? `\u20B9${buyPrice}` : "--"}</td>
                                  <td className="py-2 px-3">
                                    {lp ? (
                                      <span className="flex items-center gap-1">
                                        {"\u20B9"}{lp.ltp.toFixed(2)}
                                        {lp.changePercent >= 0
                                          ? <ArrowUp className="w-3 h-3 text-green-500" />
                                          : <ArrowDown className="w-3 h-3 text-red-500" />}
                                      </span>
                                    ) : "--"}
                                  </td>
                                  <td className="py-2 px-3">
                                    {pnl !== null ? (
                                      <span className={pnl >= 0 ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                                      </span>
                                    ) : "--"}
                                  </td>
                                  <td className="py-2 px-3">{call.targetPrice ? `\u20B9${call.targetPrice}` : "--"}</td>
                                  <td className="py-2 px-3">{call.stopLoss ? `\u20B9${call.stopLoss}` : "--"}</td>
                                  <td className="py-2 px-3 text-xs text-muted-foreground">{call.advisorName}</td>
                                  <td className="py-2 px-3 text-xs text-muted-foreground">{call.strategyName}</td>
                                  <td className="py-2 px-3 text-xs">
                                    {call.createdAt ? new Date(call.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "--"}
                                  </td>
                                </tr>
                              );
                            })}
                            {activePositions.map(pos => {
                              const lp = livePrices?.[pos.symbol || ""];
                              const entryPrice = Number(pos.entryPrice || 0);
                              const isFnO = !!(pos.strikePrice && pos.callPut && pos.expiry);
                              const premiumLTP = isFnO ? getOptionPremiumLTP(pos) : null;
                              const currentPrice = isFnO && premiumLTP != null ? premiumLTP : (lp?.ltp || 0);
                              const isSell = pos.buySell === "Sell";
                              const pnl = entryPrice > 0 && currentPrice > 0
                                ? (isSell ? ((entryPrice - currentPrice) / entryPrice) * 100 : ((currentPrice - entryPrice) / entryPrice) * 100)
                                : null;
                              const symbolLabel = `${pos.symbol || ""} ${pos.expiry || ""} ${pos.strikePrice || ""} ${pos.callPut || ""}`.trim();
                              const displayLtp = isFnO && premiumLTP != null ? premiumLTP : (lp?.ltp ?? null);
                              return (
                                <tr key={`pos-${pos.id}`} className="border-b last:border-0" data-testid={`row-active-pos-${pos.id}`}>
                                  <td className="py-2 px-3 font-medium">{symbolLabel}</td>
                                  <td className="py-2 px-3">{entryPrice ? `\u20B9${entryPrice}` : "--"}</td>
                                  <td className="py-2 px-3">
                                    {displayLtp != null ? (
                                      <span className="flex items-center gap-1">
                                        {"\u20B9"}{displayLtp.toFixed(2)}
                                        {isFnO && premiumLTP != null ? (
                                          <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{pos.callPut === "Put" ? "PE" : "CE"} LTP</Badge>
                                        ) : (
                                          lp && (lp.changePercent >= 0
                                            ? <ArrowUp className="w-3 h-3 text-green-500" />
                                            : <ArrowDown className="w-3 h-3 text-red-500" />)
                                        )}
                                      </span>
                                    ) : "--"}
                                  </td>
                                  <td className="py-2 px-3">
                                    {pnl !== null ? (
                                      <span className={pnl >= 0 ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                                      </span>
                                    ) : "--"}
                                  </td>
                                  <td className="py-2 px-3">{pos.target ? `\u20B9${pos.target}` : "--"}</td>
                                  <td className="py-2 px-3">{pos.stopLoss ? `\u20B9${pos.stopLoss}` : "--"}</td>
                                  <td className="py-2 px-3 text-xs text-muted-foreground">{pos.advisorName}</td>
                                  <td className="py-2 px-3 text-xs text-muted-foreground">{pos.strategyName}</td>
                                  <td className="py-2 px-3 text-xs">
                                    {pos.createdAt ? new Date(pos.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "--"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="closed">
                <Card>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">Past / Closed Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {closedCalls.length === 0 && closedPositions.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No past recommendations yet
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" data-testid="table-closed-recommendations">
                          <thead>
                            <tr className="border-b text-xs text-muted-foreground">
                              <th className="text-left py-2 px-3 font-medium">Stock</th>
                              <th className="text-left py-2 px-3 font-medium">Entry Price</th>
                              <th className="text-left py-2 px-3 font-medium">Exit Price</th>
                              <th className="text-left py-2 px-3 font-medium">Gain/Loss</th>
                              <th className="text-left py-2 px-3 font-medium">Advisor</th>
                              <th className="text-left py-2 px-3 font-medium">Strategy</th>
                              <th className="text-left py-2 px-3 font-medium">Entry Date</th>
                              <th className="text-left py-2 px-3 font-medium">Exit Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {closedCalls.map(call => (
                              <tr key={`call-${call.id}`} className="border-b last:border-0" data-testid={`row-closed-call-${call.id}`}>
                                <td className="py-2 px-3 font-medium">{call.stockName}</td>
                                <td className="py-2 px-3">{call.entryPrice ? `\u20B9${call.entryPrice}` : "--"}</td>
                                <td className="py-2 px-3">{call.sellPrice != null ? `\u20B9${call.sellPrice}` : "--"}</td>
                                <td className="py-2 px-3">
                                  {call.gainPercent != null ? (
                                    <span className={Number(call.gainPercent) >= 0 ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                                      {Number(call.gainPercent) >= 0 ? "+" : ""}{call.gainPercent}%
                                    </span>
                                  ) : "--"}
                                </td>
                                <td className="py-2 px-3 text-xs text-muted-foreground">{call.advisorName}</td>
                                <td className="py-2 px-3 text-xs text-muted-foreground">{call.strategyName}</td>
                                <td className="py-2 px-3 text-xs">
                                  {call.createdAt ? new Date(call.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "--"}
                                </td>
                                <td className="py-2 px-3 text-xs">
                                  {call.exitDate ? new Date(call.exitDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "--"}
                                </td>
                              </tr>
                            ))}
                            {closedPositions.map(pos => {
                              const symbolLabel = `${pos.symbol || ""} ${pos.expiry || ""} ${pos.strikePrice || ""} ${pos.callPut || ""}`.trim();
                              return (
                                <tr key={`pos-${pos.id}`} className="border-b last:border-0" data-testid={`row-closed-pos-${pos.id}`}>
                                  <td className="py-2 px-3 font-medium">{symbolLabel}</td>
                                  <td className="py-2 px-3">{pos.entryPrice ? `\u20B9${pos.entryPrice}` : "--"}</td>
                                  <td className="py-2 px-3">{pos.exitPrice != null ? `\u20B9${pos.exitPrice}` : "--"}</td>
                                  <td className="py-2 px-3">
                                    {pos.gainPercent != null ? (
                                      <span className={Number(pos.gainPercent) >= 0 ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                                        {Number(pos.gainPercent) >= 0 ? "+" : ""}{pos.gainPercent}%
                                      </span>
                                    ) : "--"}
                                  </td>
                                  <td className="py-2 px-3 text-xs text-muted-foreground">{pos.advisorName}</td>
                                  <td className="py-2 px-3 text-xs text-muted-foreground">{pos.strategyName}</td>
                                  <td className="py-2 px-3 text-xs">
                                    {pos.createdAt ? new Date(pos.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "--"}
                                  </td>
                                  <td className="py-2 px-3 text-xs">
                                    {pos.exitDate ? new Date(pos.exitDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "--"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}

        <WatchlistSection items={watchlistItems || []} />
      </div>
      <Footer />
    </div>
  );
}

interface WatchlistItemData {
  id: string;
  userId: string;
  itemType: string;
  itemId: string;
  createdAt: string;
  strategy?: Strategy & { advisor?: Partial<User> };
  advisor?: Partial<User>;
  newCalls?: number;
}

function WatchlistSection({ items }: { items: WatchlistItemData[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const removeMutation = useMutation({
    mutationFn: async ({ itemType, itemId }: { itemType: string; itemId: string }) => {
      await apiRequest("DELETE", "/api/investor/watchlist", { itemType, itemId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investor/watchlist/ids"] });
      toast({ title: "Removed from watchlist" });
    },
  });

  const strategyItems = items.filter(i => i.itemType === "strategy" && i.strategy);
  const advisorItems = items.filter(i => i.itemType === "advisor" && i.advisor);

  if (strategyItems.length === 0 && advisorItems.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-watchlist-title">
        <Heart className="w-5 h-5 text-red-500" /> My Watchlist
      </h2>

      {strategyItems.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Strategies</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {strategyItems.map((item) => {
              const s = item.strategy!;
              return (
                <Card key={item.id} className="hover-elevate" data-testid={`card-watchlist-strategy-${item.itemId}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <Link href={`/strategies/${item.itemId}`}>
                          <h4 className="font-semibold text-sm truncate hover:underline cursor-pointer" data-testid={`text-watchlist-strategy-${item.itemId}`}>
                            {s.name}
                          </h4>
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          by {(s.advisor as any)?.companyName || (s.advisor as any)?.username || "Advisor"}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-red-500 flex-shrink-0"
                        onClick={() => removeMutation.mutate({ itemType: "strategy", itemId: item.itemId })}
                        disabled={removeMutation.isPending}
                        data-testid={`button-remove-watchlist-${item.itemId}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Type</span>
                        <p className="font-medium">{s.type || "--"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Risk</span>
                        <p className="font-medium">{s.riskLevel || "--"}</p>
                      </div>
                    </div>
                    {(item.newCalls || 0) > 0 && (
                      <div className="flex items-center gap-1.5 text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 rounded-md px-2 py-1.5" data-testid={`text-watchlist-update-${item.itemId}`}>
                        <Bell className="w-3 h-3" />
                        <span>{item.newCalls} new recommendation(s) added. Subscribe to view details.</span>
                      </div>
                    )}
                    <Link href={`/strategies/${item.itemId}/subscribe`}>
                      <Button size="sm" className="w-full" data-testid={`button-subscribe-watchlist-${item.itemId}`}>
                        Subscribe
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {advisorItems.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Advisors</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {advisorItems.map((item) => {
              const a = item.advisor!;
              return (
                <Card key={item.id} className="hover-elevate" data-testid={`card-watchlist-advisor-${item.itemId}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar className="w-8 h-8 flex-shrink-0">
                          {(a as any).logoUrl && <AvatarImage src={(a as any).logoUrl} />}
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                            {((a as any).companyName || (a as any).username || "A").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <Link href={`/advisors/${item.itemId}`}>
                            <h4 className="font-semibold text-sm truncate hover:underline cursor-pointer" data-testid={`text-watchlist-advisor-${item.itemId}`}>
                              {(a as any).companyName || (a as any).username}
                            </h4>
                          </Link>
                          <p className="text-xs text-muted-foreground">{(a as any).sebiRegNumber || ""}</p>
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-red-500 flex-shrink-0"
                        onClick={() => removeMutation.mutate({ itemType: "advisor", itemId: item.itemId })}
                        disabled={removeMutation.isPending}
                        data-testid={`button-remove-watchlist-advisor-${item.itemId}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <Link href={`/advisors/${item.itemId}`}>
                      <Button variant="outline" size="sm" className="w-full" data-testid={`button-view-advisor-watchlist-${item.itemId}`}>
                        View Details
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
