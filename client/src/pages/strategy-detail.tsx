import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { TrendingUp, Calendar, BarChart3, Star, Lock, Zap, Shield, ShieldCheck, Eye, ArrowUp, ArrowDown, Unlock, Package, FileText, RefreshCw, IndianRupee, CalendarDays, Layers, Fingerprint } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Strategy, Call, User, Position, BasketConstituent, BasketRebalance, BasketRationale } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const DISCLAIMER_TEXT = `I request that the SEBI-registered Investment Advisor/Research Analyst display the performance metrics of the strategies published on the AlphaMarket platform. I understand that, as per SEBI's updated guidelines permitting disclosure of past performance, only verified, unaltered, and accurately computed performance records may be shared, and such disclosures must strictly adhere to SEBI's prescribed methodology and presentation standards.

I acknowledge that the performance data shown is computed from the date the Advisor/Analyst began publishing advisory calls through the AlphaMarket platform and is based on live tracking of each call until it is closed or until its target or stop-loss is triggered. I further understand that the data reflects the Advisor's actual call history as maintained by the platform and has not been modified, optimized, or back-tested.

I am aware that past performance is not a reliable indicator of future returns, and that SEBI permits its disclosure only for transparency\u2014not as a promise, forecast, or assurance of future performance. I also understand that any metrics displayed comply with SEBI's definitions, including the segregation of performance by strategy type and by nature of calls.

I confirm that I will exercise independent judgment, caution, and discretion when reviewing this information. Every investment strategy carries risk, and may not be suitable for all investors. I agree to review the strategy methodology, risk factors, and other relevant documents before subscribing.

Performance Metrics Used on AlphaMarket
AlphaMarket follows SEBI-aligned performance methodologies:

Hit Rate indicates the percentage of advisory calls closed in profit and is applicable to F&O and Intraday strategies.
Absolute Performance reflects overall strategy performance since inception and is applicable to Positional, Basket, and Swing Trading strategies.
All metrics are derived from actual platform-recorded advisory calls and comply with SEBI's requirements for transparency, accuracy, and non-promotional presentation.

By proceeding, I acknowledge that I have requested this performance information for my personal evaluation and that I understand and agree to these terms.`;

function isPerformanceRevealed(strategyId: string): boolean {
  try {
    return localStorage.getItem(`performanceReveal:${strategyId}`) === "true";
  } catch {
    return false;
  }
}

function markPerformanceRevealed(strategyId: string) {
  try {
    localStorage.setItem(`performanceReveal:${strategyId}`, "true");
  } catch {}
}

interface PerformanceData {
  strategyId: string;
  strategyType: string;
  isHitRateStrategy: boolean;
  totals: {
    closedCount: number;
    profitableCount: number;
    lossCount: number;
    hitRate: number;
    absoluteReturn: number;
    avgReturn: number;
  };
}

interface LivePrice {
  symbol: string;
  exchange: string;
  ltp: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
}

function getRiskColor(risk: string | null | undefined) {
  if (!risk) return "text-muted-foreground bg-muted";
  if (risk.toLowerCase().includes("high")) return "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30";
  if (risk.toLowerCase().includes("low")) return "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30";
  return "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30";
}

export default function StrategyDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [revealed, setRevealed] = useState(() => id ? isPerformanceRevealed(id) : false);

  const { data: strategy, isLoading } = useQuery<Strategy & { advisor?: User }>({
    queryKey: ["/api/strategies", id],
  });

  const { data: performanceData } = useQuery<PerformanceData>({
    queryKey: ["/api/strategies", id, "performance"],
    enabled: !!id && revealed && !!user,
  });

  const { data: calls } = useQuery<Call[]>({
    queryKey: ["/api/strategies", id, "calls"],
    enabled: !!id,
  });

  const { data: positions } = useQuery<Position[]>({
    queryKey: ["/api/strategies", id, "positions"],
    enabled: !!id,
  });

  const { data: subStatus } = useQuery<{
    subscribed: boolean;
    subscriptionId?: string;
    ekycDone?: boolean;
    riskProfilingDone?: boolean;
    requiresRiskProfiling?: boolean;
    allComplianceDone?: boolean;
  }>({
    queryKey: ["/api/strategies", id, "subscription-status"],
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${id}/subscription-status`);
      if (!res.ok) return { subscribed: false };
      return res.json();
    },
    enabled: !!id && !!user,
  });

  const isBasket = strategy?.type === "Basket";
  const isSubscribed = subStatus?.subscribed || false;
  const isAdvisor = user?.role === "advisor";
  const isAdmin = user?.role === "admin";
  const compliancePending = isSubscribed && subStatus?.requiresRiskProfiling && !subStatus?.riskProfilingDone;
  const canViewActiveCalls = (isSubscribed && !compliancePending) || isAdvisor || isAdmin;

  const { data: basketConstituents } = useQuery<BasketConstituent[]>({
    queryKey: ["/api/strategies", id, "basket", "constituents"],
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${id}/basket/constituents`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && isBasket && canViewActiveCalls,
  });

  const { data: basketRebalances } = useQuery<BasketRebalance[]>({
    queryKey: ["/api/strategies", id, "basket", "rebalances"],
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${id}/basket/rebalances`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && isBasket,
  });

  const { data: basketRationales } = useQuery<BasketRationale[]>({
    queryKey: ["/api/strategies", id, "basket", "rationales"],
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${id}/basket/rationales`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && isBasket,
  });

  interface PastRecommendation {
    symbol: string;
    exchange: string | null;
    weightPercent: string;
    quantity: number | null;
    priceAtRebalance: string | null;
    action: string | null;
    rebalanceVersion: number | null;
    removedDate: string | null;
    addedDate: string | null;
  }

  const { data: pastRecommendations } = useQuery<PastRecommendation[]>({
    queryKey: ["/api/strategies", id, "basket", "past-recommendations"],
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${id}/basket/past-recommendations`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && isBasket && !!user,
  });

  const activeCallSymbols = (calls || [])
    .filter((c) => c.status === "Active")
    .map((c) => ({ symbol: c.stockName, strategyType: strategy?.type }));
  const activePositionSymbols = (positions || [])
    .filter((p) => p.status === "Active")
    .map((p) => ({ symbol: p.symbol || "", strategyType: strategy?.type }))
    .filter((p) => p.symbol);
  const allActiveSymbols = [...activeCallSymbols, ...activePositionSymbols];

  const { data: livePrices } = useQuery<Record<string, LivePrice>>({
    queryKey: ["/api/live-prices", id, "active"],
    queryFn: async () => {
      if (!allActiveSymbols.length) return {};
      const res = await apiRequest("POST", "/api/live-prices/bulk", { symbols: allActiveSymbols });
      return res.json();
    },
    enabled: canViewActiveCalls && allActiveSymbols.length > 0,
    refetchInterval: ["Future", "Option", "CommodityFuture"].includes(strategy?.type || "") ? 5000 : 15000,
  });

  const handleSubscribe = () => {
    if (!user) {
      toast({ title: "Please sign in to subscribe", variant: "destructive" });
      navigate("/login");
      return;
    }
    navigate(`/strategies/${id}/subscribe`);
  };

  const handlePerformanceClick = useCallback(() => {
    if (revealed) {
      navigate(`/strategies/${id}/performance`);
      return;
    }
    setShowDisclaimer(true);
  }, [revealed, id, navigate]);

  const handleDisclaimerAccept = useCallback(() => {
    setShowDisclaimer(false);
    if (!user) {
      toast({ title: "Please sign in to view performance", description: "You need to be logged in to reveal strategy performance." });
      navigate("/login");
      return;
    }
    if (id) {
      markPerformanceRevealed(id);
      setRevealed(true);
    }
  }, [user, id, navigate, toast]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-4">
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (!strategy) return null;

  const activeCalls = (calls || []).filter((c) => c.status === "Active");
  const closedCalls = (calls || []).filter((c) => c.status === "Closed");
  const activePositions = (positions || []).filter((p) => p.status === "Active");
  const closedPositions = (positions || []).filter((p) => p.status === "Closed");
  const advisorName = strategy.advisor?.companyName || strategy.advisor?.username || "Advisor";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-6 w-full">
        <div className="flex flex-col md:flex-row gap-4 items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              by {advisorName}
              {strategy.advisor?.sebiRegNumber && (
                <span className="ml-2 text-xs">({strategy.advisor.sebiRegNumber})</span>
              )}
            </p>
            <h1 className="text-2xl font-bold" data-testid="text-strategy-title">{strategy.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className={getRiskColor(strategy.riskLevel)}>
                {strategy.riskLevel || "Medium Risk"}
              </Badge>
              <Badge variant="outline" className={strategy.type === "Basket" ? "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800" : ""}>
                {strategy.type === "Basket" && <Package className="w-3 h-3 mr-1" />}
                {strategy.type === "CommodityFuture" ? "Commodity Future" : strategy.type}
              </Badge>
              {strategy.horizon && <Badge variant="outline">{strategy.horizon}</Badge>}
            </div>
          </div>
          <Button onClick={handleSubscribe} data-testid="button-subscribe">
            Subscribe
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm leading-relaxed">
              {strategy.description}
            </p>

            <div className="grid grid-cols-2 gap-4">
              <Card
                className="cursor-pointer hover-elevate"
                onClick={handlePerformanceClick}
                data-testid="card-performance"
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    {revealed ? (
                      <TrendingUp className="w-5 h-5 text-primary" />
                    ) : (
                      <Lock className="w-5 h-5 text-primary" />
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {(["Option", "Future", "CommodityFuture"].includes(strategy.type) ||
                        strategy.horizon === "Intraday")
                        ? "Hit Rate"
                        : "Absolute Performance"}
                    </p>
                    {revealed && performanceData ? (
                      <p className="font-semibold" data-testid="text-performance-value">
                        {performanceData.isHitRateStrategy
                          ? `${performanceData.totals.hitRate}%`
                          : `${performanceData.totals.absoluteReturn >= 0 ? "+" : ""}${performanceData.totals.absoluteReturn}%`}
                      </p>
                    ) : revealed ? (
                      <Skeleton className="h-5 w-12" />
                    ) : (
                      <p className="font-semibold text-muted-foreground flex items-center gap-1" data-testid="text-performance-locked">
                        <Lock className="w-3 h-3" /> Reveal
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-accent/10 flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Recommendations</p>
                    <p className="font-semibold" data-testid="text-total-recs">{strategy.totalRecommendations || 0}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Strategy Live Since</p>
                    <p className="font-semibold text-sm" data-testid="text-live-since">
                      {strategy.createdAt
                        ? new Date(strategy.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                        : "N/A"}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-accent/10 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Live Calls</p>
                    <p className="font-semibold" data-testid="text-live-calls">{activeCalls.length}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Strategy Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-md bg-muted/50 text-center space-y-1">
                  <p className="text-xs text-muted-foreground">Theme</p>
                  <p className="font-medium">{strategy.theme?.join(", ") || strategy.type}</p>
                </div>
                <div className="p-3 rounded-md bg-muted/50 text-center space-y-1">
                  <p className="text-xs text-muted-foreground">Volatility</p>
                  <p className="font-medium">{strategy.volatility || "Medium"}</p>
                </div>
                <div className="p-3 rounded-md bg-muted/50 text-center space-y-1">
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p className="font-medium">{strategy.type === "CommodityFuture" ? "Commodity Future" : strategy.type}</p>
                </div>
                <div className="p-3 rounded-md bg-muted/50 text-center space-y-1">
                  <p className="text-xs text-muted-foreground">Horizon</p>
                  <p className="font-medium">{strategy.horizon || "N/A"}</p>
                </div>
                {strategy.minimumInvestment && Number(strategy.minimumInvestment) > 0 && (
                  <div className="p-3 rounded-md bg-muted/50 text-center space-y-1 col-span-2">
                    <p className="text-xs text-muted-foreground">Minimum Investment</p>
                    <p className="font-medium">{"\u20B9"}{Number(strategy.minimumInvestment).toLocaleString("en-IN", { minimumFractionDigits: 0 })}</p>
                  </div>
                )}
                {isBasket && (strategy as any).rebalanceFrequency && (
                  <div className="p-3 rounded-md bg-indigo-50 dark:bg-indigo-950/30 text-center space-y-1" data-testid="text-rebalance-frequency">
                    <p className="text-xs text-muted-foreground">Rebalance Schedule</p>
                    <p className="font-medium text-indigo-700 dark:text-indigo-300">{(strategy as any).rebalanceFrequency}</p>
                  </div>
                )}
                {isBasket && basketRebalances && basketRebalances.length > 0 && (
                  <div className="p-3 rounded-md bg-indigo-50 dark:bg-indigo-950/30 text-center space-y-1" data-testid="text-last-rebalance">
                    <p className="text-xs text-muted-foreground">Last Rebalance</p>
                    <p className="font-medium text-indigo-700 dark:text-indigo-300 text-xs">
                      {basketRebalances[0].effectiveDate
                        ? new Date(basketRebalances[0].effectiveDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                        : "N/A"}
                    </p>
                  </div>
                )}
                {isBasket && canViewActiveCalls && basketConstituents && (
                  <div className="p-3 rounded-md bg-indigo-50 dark:bg-indigo-950/30 text-center space-y-1" data-testid="text-basket-stocks-count">
                    <p className="text-xs text-muted-foreground">Stocks in Basket</p>
                    <p className="font-medium text-indigo-700 dark:text-indigo-300">{basketConstituents.length}</p>
                  </div>
                )}
                {!isBasket && (
                  <div className="p-3 rounded-md bg-muted/50 text-center space-y-1">
                    <p className="text-xs text-muted-foreground">Stocks in Buy Zone</p>
                    <p className="font-medium">{strategy.stocksInBuyZone || 0}</p>
                  </div>
                )}
                <div className="p-3 rounded-md bg-muted/50 text-center space-y-1">
                  <p className="text-xs text-muted-foreground">{isBasket ? "Last Recommended" : "Last Recommended"}</p>
                  <p className="font-medium text-xs">
                    {strategy.modifiedAt
                      ? new Date(strategy.modifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                      : "N/A"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {isBasket && (
          <Card className="border-indigo-200 dark:border-indigo-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Current Basket Composition {canViewActiveCalls && basketConstituents ? `(${basketConstituents.length} stocks)` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {canViewActiveCalls ? (
                basketConstituents && basketConstituents.length > 0 ? (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-basket-detail-constituents">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="pb-2 font-medium text-indigo-700 dark:text-indigo-300">Stock</th>
                            <th className="pb-2 font-medium text-indigo-700 dark:text-indigo-300">Exchange</th>
                            <th className="pb-2 font-medium text-indigo-700 dark:text-indigo-300 text-right">Weight %</th>
                            <th className="pb-2 font-medium text-indigo-700 dark:text-indigo-300 text-right">Qty</th>
                            <th className="pb-2 font-medium text-indigo-700 dark:text-indigo-300 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {basketConstituents.map((c) => (
                            <tr key={c.id} className="border-b last:border-0" data-testid={`row-basket-constituent-${c.symbol}`}>
                              <td className="py-2 font-medium">{c.symbol}</td>
                              <td className="py-2 text-muted-foreground">{c.exchange}</td>
                              <td className="py-2 text-right font-medium">{Number(c.weightPercent).toFixed(1)}%</td>
                              <td className="py-2 text-right text-muted-foreground">{c.quantity || "-"}</td>
                              <td className="py-2 text-center">
                                <Badge variant={c.action === "Buy" ? "default" : c.action === "Sell" ? "destructive" : "secondary"} className="text-xs">
                                  {c.action}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {basketRebalances && basketRebalances.length > 0 && (
                      <div className="mt-4 pt-3 border-t space-y-2">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" /> Rebalance History
                        </p>
                        {basketRebalances.slice(0, 5).map((r) => (
                          <div key={r.id} className="flex items-center gap-2 text-xs" data-testid={`rebalance-detail-${r.id}`}>
                            <Badge variant="outline" className="text-xs">V{r.version}</Badge>
                            <span className="text-muted-foreground">
                              {r.effectiveDate ? new Date(r.effectiveDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
                            </span>
                            {r.notes && <span className="text-muted-foreground truncate max-w-[300px]">{r.notes}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No stocks in the basket yet.</p>
                )
              ) : (
                <div className="text-center py-8 space-y-3" data-testid="locked-basket-composition">
                  <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center mx-auto">
                    <Lock className="w-8 h-8 text-indigo-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium">Subscribe to view current basket stocks</p>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      The current basket composition with stock weights, quantities, and allocations is available to subscribers only.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Package className="w-3 h-3" /> Multi-stock basket</span>
                    <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> SEBI Registered</span>
                  </div>
                  <Button onClick={handleSubscribe} data-testid="button-subscribe-basket">
                    Subscribe to Unlock
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isBasket && user && pastRecommendations && pastRecommendations.length > 0 && (
          <Card data-testid="card-past-recommendations">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-muted-foreground" />
                Past Recommendations ({pastRecommendations.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground">Stocks that were previously in this basket but have been removed during rebalancing</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-past-recommendations">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium">Stock</th>
                      <th className="pb-2 font-medium">Exchange</th>
                      <th className="pb-2 font-medium text-right">Weight %</th>
                      <th className="pb-2 font-medium text-right">Entry Price</th>
                      <th className="pb-2 font-medium text-center">Action</th>
                      <th className="pb-2 font-medium text-right">Added</th>
                      <th className="pb-2 font-medium text-right">Removed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastRecommendations.map((p) => (
                      <tr key={p.symbol} className="border-b last:border-0" data-testid={`row-past-rec-${p.symbol}`}>
                        <td className="py-2 font-medium">{p.symbol}</td>
                        <td className="py-2 text-muted-foreground">{p.exchange || "NSE"}</td>
                        <td className="py-2 text-right">{Number(p.weightPercent).toFixed(1)}%</td>
                        <td className="py-2 text-right text-muted-foreground">
                          {p.priceAtRebalance ? `₹${Number(p.priceAtRebalance).toLocaleString("en-IN")}` : "-"}
                        </td>
                        <td className="py-2 text-center">
                          <Badge variant={p.action === "Buy" ? "default" : p.action === "Sell" ? "destructive" : "secondary"} className="text-xs">
                            {p.action || "Buy"}
                          </Badge>
                        </td>
                        <td className="py-2 text-right text-xs text-muted-foreground">
                          {p.addedDate ? new Date(p.addedDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-"}
                        </td>
                        <td className="py-2 text-right text-xs text-muted-foreground">
                          {p.removedDate ? new Date(p.removedDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {isBasket && basketRationales && basketRationales.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Advisor Research & Rationale
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {basketRationales.map((r) => (
                <div key={r.id} className="p-3 border rounded-md" data-testid={`rationale-detail-${r.id}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{r.title}</span>
                    <Badge variant="secondary" className="text-xs">{r.category}</Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
                    </span>
                  </div>
                  {r.body && <p className="text-sm text-muted-foreground">{r.body}</p>}
                  {r.attachments && r.attachments.length > 0 && (
                    <div className="flex gap-2 flex-wrap mt-2">
                      {r.attachments.map((url, idx) => (
                        <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
                          Attachment {idx + 1}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Active Recommendations ({activeCalls.length + activePositions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!canViewActiveCalls ? (
              compliancePending ? (
                <div className="text-center py-8 space-y-3" data-testid="locked-compliance-pending">
                  <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
                    <ShieldCheck className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-amber-800 dark:text-amber-300">Complete Risk Profiling to Access Recommendations</p>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      You are subscribed, but your risk profiling is incomplete. Complete it to unlock live recommendations for this strategy.
                    </p>
                  </div>
                  {!subStatus?.ekycDone ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Complete eKYC first, then risk profiling.</p>
                      <Link href={`/ekyc?subscriptionId=${subStatus?.subscriptionId}`}>
                        <Button data-testid="button-compliance-ekyc">
                          <Fingerprint className="w-4 h-4 mr-1" /> Complete eKYC First
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <Link href={`/risk-profiling?subscriptionId=${subStatus?.subscriptionId}`}>
                      <Button data-testid="button-compliance-risk-profiling">
                        <ShieldCheck className="w-4 h-4 mr-1" /> Complete Risk Profiling
                      </Button>
                    </Link>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 space-y-3" data-testid="locked-active-calls">
                  <div className="w-16 h-16 rounded-full bg-muted/80 flex items-center justify-center mx-auto">
                    <Lock className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium">Subscribe to view active recommendations</p>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      Active trades and live calls are only available to subscribers. Subscribe now to get real-time trade alerts.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {activeCalls.length} active call{activeCalls.length !== 1 ? "s" : ""}</span>
                    <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> SEBI Registered</span>
                  </div>
                  <Button onClick={handleSubscribe} data-testid="button-subscribe-unlock">
                    Subscribe to Unlock
                  </Button>
                </div>
              )
            ) : (activeCalls.length === 0 && activePositions.length === 0) ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <p>No active trades at the moment. New calls will appear here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-active-calls">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">Stock Name</th>
                      <th className="pb-2 font-medium text-muted-foreground">Buy Price</th>
                      <th className="pb-2 font-medium text-muted-foreground">LTP</th>
                      <th className="pb-2 font-medium text-muted-foreground">P&L %</th>
                      <th className="pb-2 font-medium text-muted-foreground">Target</th>
                      <th className="pb-2 font-medium text-muted-foreground">Stop Loss</th>
                      <th className="pb-2 font-medium text-muted-foreground">Date & Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCalls.map((call) => {
                      const lp = livePrices?.[call.stockName];
                      const buyPrice = Number(call.entryPrice || call.buyRangeStart || 0);
                      const currentPrice = lp?.ltp || 0;
                      const isSell = call.action === "Sell";
                      const pnl = buyPrice > 0 && currentPrice > 0
                        ? (isSell ? ((buyPrice - currentPrice) / buyPrice) * 100 : ((currentPrice - buyPrice) / buyPrice) * 100)
                        : null;
                      return (
                        <>
                          <tr key={call.id} className="border-b last:border-0" data-testid={`row-call-${call.id}`}>
                            <td className="py-2 font-medium">{call.stockName}</td>
                            <td className="py-2">{"\u20B9"}{call.entryPrice || call.buyRangeStart}</td>
                            <td className="py-2" data-testid={`ltp-${call.id}`}>
                              {lp ? (
                                <span className="flex items-center gap-1">
                                  {"\u20B9"}{lp.ltp.toFixed(2)}
                                  {lp.change >= 0 ? (
                                    <ArrowUp className="w-3 h-3 text-green-600 dark:text-green-400" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-red-600 dark:text-red-400" />
                                  )}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">--</span>
                              )}
                            </td>
                            <td className="py-2" data-testid={`pnl-${call.id}`}>
                              {pnl !== null ? (
                                <span className={pnl >= 0 ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                                  {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                                </span>
                              ) : "--"}
                            </td>
                            <td className="py-2">{call.targetPrice ? `\u20B9${call.targetPrice}` : "--"}</td>
                            <td className="py-2">{call.stopLoss ? `\u20B9${call.stopLoss}` : "--"}</td>
                            <td className="py-2 text-xs">
                              {call.createdAt
                                ? new Date(call.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                                : call.callDate
                                  ? new Date(call.callDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                                  : "--"}
                              {call.createdAt && (
                                <span className="block text-muted-foreground">
                                  {new Date(call.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                            </td>
                          </tr>
                          {call.rationale && (
                            <tr key={`${call.id}-rationale`} className="border-b last:border-0">
                              <td colSpan={7} className="py-1.5 px-2">
                                <p className="text-xs text-muted-foreground italic">{call.rationale}</p>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                    {activePositions.map((pos) => {
                      const symbolLabel = `${pos.symbol || ""}${pos.expiry ? " " + pos.expiry : ""}${pos.strikePrice ? " " + pos.strikePrice : ""}${pos.callPut ? " " + pos.callPut : ""}`;
                      const entryPx = Number(pos.entryPrice || 0);
                      const targetPx = Number(pos.target || 0);
                      const isSell = pos.buySell === "Sell";
                      const pnl = entryPx > 0 && targetPx > 0
                        ? (isSell ? ((entryPx - targetPx) / entryPx) * 100 : ((targetPx - entryPx) / entryPx) * 100)
                        : null;
                      return (
                        <>
                          <tr key={pos.id} className="border-b last:border-0" data-testid={`row-pos-${pos.id}`}>
                            <td className="py-2 font-medium">{symbolLabel.trim()}</td>
                            <td className="py-2">{"\u20B9"}{pos.entryPrice || "--"}</td>
                            <td className="py-2 text-muted-foreground">--</td>
                            <td className="py-2" data-testid={`pnl-pos-${pos.id}`}>
                              {pnl !== null ? (
                                <span className={pnl >= 0 ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                                  {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                                </span>
                              ) : "--"}
                            </td>
                            <td className="py-2">{pos.target ? `\u20B9${pos.target}` : "--"}</td>
                            <td className="py-2">{pos.stopLoss ? `\u20B9${pos.stopLoss}` : "--"}</td>
                            <td className="py-2 text-xs">
                              {pos.createdAt
                                ? new Date(pos.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                                : "--"}
                              {pos.createdAt && (
                                <span className="block text-muted-foreground">
                                  {new Date(pos.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                            </td>
                          </tr>
                          {pos.rationale && (
                            <tr key={`${pos.id}-rationale`} className="border-b last:border-0">
                              <td colSpan={7} className="py-1.5 px-2">
                                <p className="text-xs text-muted-foreground italic">{pos.rationale}</p>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Past / Closed Recommendations ({closedCalls.length + closedPositions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {closedCalls.length === 0 && closedPositions.length === 0 ? (
              <p className="text-center py-6 text-sm text-muted-foreground">No closed recommendations yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-closed-calls">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">Stock Name</th>
                      <th className="pb-2 font-medium text-muted-foreground">Entry Price</th>
                      <th className="pb-2 font-medium text-muted-foreground">Exit Price</th>
                      <th className="pb-2 font-medium text-muted-foreground">Gain/Loss</th>
                      <th className="pb-2 font-medium text-muted-foreground">Created</th>
                      <th className="pb-2 font-medium text-muted-foreground">Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedCalls.map((call) => (
                      <>
                        <tr key={call.id} className="border-b last:border-0" data-testid={`row-closed-call-${call.id}`}>
                          <td className="py-2 font-medium">{call.stockName}</td>
                          <td className="py-2">{"\u20B9"}{call.entryPrice || call.buyRangeStart}</td>
                          <td className="py-2">{call.sellPrice != null ? `\u20B9${call.sellPrice}` : "--"}</td>
                          <td className="py-2">
                            <span className={Number(call.gainPercent) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                              {call.gainPercent != null ? `${call.gainPercent}%` : "--"}
                            </span>
                          </td>
                          <td className="py-2 text-xs">
                            {call.createdAt
                              ? new Date(call.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                              : call.callDate
                                ? new Date(call.callDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                                : "--"}
                            {call.createdAt && (
                              <span className="block text-muted-foreground">
                                {new Date(call.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-xs">
                            {call.exitDate
                              ? new Date(call.exitDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                              : "--"}
                            {call.exitDate && (
                              <span className="block text-muted-foreground">
                                {new Date(call.exitDate).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </td>
                        </tr>
                        {call.rationale && (
                          <tr key={`${call.id}-rationale`} className="border-b last:border-0">
                            <td colSpan={6} className="py-1.5 px-2">
                              <p className="text-xs text-muted-foreground italic">{call.rationale}</p>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                    {closedPositions.map((pos) => {
                      const symbolLabel = `${pos.symbol || ""}${pos.expiry ? " " + pos.expiry : ""}${pos.strikePrice ? " " + pos.strikePrice : ""}${pos.callPut ? " " + pos.callPut : ""}`;
                      return (
                        <>
                          <tr key={pos.id} className="border-b last:border-0" data-testid={`row-closed-pos-${pos.id}`}>
                            <td className="py-2 font-medium">{symbolLabel.trim()}</td>
                            <td className="py-2">{pos.entryPrice ? `\u20B9${pos.entryPrice}` : "--"}</td>
                            <td className="py-2">{pos.exitPrice != null ? `\u20B9${pos.exitPrice}` : "--"}</td>
                            <td className="py-2">
                              <span className={Number(pos.gainPercent) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                                {pos.gainPercent != null ? `${pos.gainPercent}%` : "--"}
                              </span>
                            </td>
                            <td className="py-2 text-xs">
                              {pos.createdAt
                                ? new Date(pos.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                                : "--"}
                              {pos.createdAt && (
                                <span className="block text-muted-foreground">
                                  {new Date(pos.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-xs">
                              {pos.exitDate
                                ? new Date(pos.exitDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                                : "--"}
                              {pos.exitDate && (
                                <span className="block text-muted-foreground">
                                  {new Date(pos.exitDate).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                            </td>
                          </tr>
                          {pos.rationale && (
                            <tr key={`${pos.id}-rationale`} className="border-b last:border-0">
                              <td colSpan={6} className="py-1.5 px-2">
                                <p className="text-xs text-muted-foreground italic">{pos.rationale}</p>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pricing Plans</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Subscribe to access all calls, positions, and live updates from this strategy.
              </p>
              <Button onClick={handleSubscribe} data-testid="button-subscribe-plan">
                Subscribe Now
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-1">
          <p className="text-sm text-muted-foreground mr-1">Investor Rating</p>
          {[1, 2, 3, 4, 5].map((s) => (
            <Star key={s} className="w-4 h-4 text-muted-foreground/30" />
          ))}
        </div>
      </div>
      <Footer />

      <AlertDialog open={showDisclaimer} onOpenChange={setShowDisclaimer}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Performance Disclosure - SEBI Disclaimer
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ScrollArea className="h-[300px] mt-2 pr-4">
                <div className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                  {DISCLAIMER_TEXT}
                </div>
              </ScrollArea>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-disclaimer-cancel">Decline</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisclaimerAccept} data-testid="button-disclaimer-accept">
              I Agree & Reveal Performance
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
