import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import {
  TrendingUp, TrendingDown, ArrowLeft, Lock, Shield, BarChart3,
  Target, AlertTriangle, CheckCircle, XCircle, Activity
} from "lucide-react";
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
import type { Strategy, User } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

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

interface PeriodData {
  label: string;
  closedCount: number;
  profitableCount: number;
  hitRate: number;
  absoluteReturn: number;
  avgReturn: number;
}

interface MaxEntry {
  type: "call" | "position";
  id: string;
  label: string;
  gainPercent: number;
  exitDate: string | null;
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
  periods: PeriodData[];
  maxProfit: MaxEntry | null;
  maxDrawdown: MaxEntry | null;
}

const NIFTY_BENCHMARKS: Record<string, number> = {
  "1W": 0.5,
  "1M": 1.2,
  "3M": 3.5,
  "6M": 6.8,
  "1Y": 12.5,
  "3Y": 38.0,
  "Max": 45.0,
};

export default function StrategyPerformance() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [revealed, setRevealed] = useState(() => id ? isPerformanceRevealed(id) : false);

  const { data: strategy, isLoading: strategyLoading } = useQuery<Strategy & { advisor?: User }>({
    queryKey: ["/api/strategies", id],
  });

  const { data: performanceData, isLoading: perfLoading } = useQuery<PerformanceData>({
    queryKey: ["/api/strategies", id, "performance"],
    enabled: !!id && revealed && !!user,
  });

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

  const handleRevealClick = useCallback(() => {
    setShowDisclaimer(true);
  }, []);

  if (strategyLoading) {
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

  const metricLabel = (["Option", "Future", "CommodityFuture"].includes(strategy.type) ||
    strategy.horizon === "Intraday")
    ? "Hit Rate"
    : "Absolute Performance";

  if (!revealed) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-5xl mx-auto px-4 md:px-6 py-6 w-full">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/strategies/${id}`)} className="mb-4" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Strategy
          </Button>

          <Card>
            <CardContent className="py-16 text-center space-y-4">
              <div className="w-20 h-20 rounded-full bg-muted/80 flex items-center justify-center mx-auto">
                <Lock className="w-10 h-10 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold">Performance Locked</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                To view the detailed performance analysis of "{strategy.name}", you must first read and agree to the SEBI-mandated performance disclosure disclaimer.
              </p>
              <Button onClick={handleRevealClick} data-testid="button-reveal-performance">
                <Shield className="w-4 h-4 mr-2" />
                Read Disclaimer & Reveal
              </Button>
            </CardContent>
          </Card>
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

  if (perfLoading || !performanceData) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-4">
          <Skeleton className="h-8 w-60" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <Skeleton className="h-60 w-full" />
        </div>
      </div>
    );
  }

  const { totals, periods, maxProfit, maxDrawdown, isHitRateStrategy } = performanceData;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-6 w-full">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/strategies/${id}`)} className="mb-1" data-testid="button-back">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to Strategy
            </Button>
            <h1 className="text-xl font-bold" data-testid="text-performance-title">
              {strategy.name} - Performance Analysis
            </h1>
            <p className="text-sm text-muted-foreground">
              {strategy.advisor?.companyName || strategy.advisor?.username || "Advisor"}
              {strategy.advisor?.sebiRegNumber && (
                <span className="ml-2 text-xs">({strategy.advisor.sebiRegNumber})</span>
              )}
            </p>
          </div>
          <Badge variant="outline">{metricLabel} Strategy</Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 text-center space-y-1">
              <p className="text-xs text-muted-foreground">{isHitRateStrategy ? "Hit Rate" : "Absolute Return"}</p>
              <p className={`text-2xl font-bold ${isHitRateStrategy
                  ? (totals.hitRate >= 50 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")
                  : (totals.absoluteReturn >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")
                }`}
                data-testid="stat-primary-metric"
              >
                {isHitRateStrategy
                  ? `${totals.hitRate}%`
                  : `${totals.absoluteReturn >= 0 ? "+" : ""}${totals.absoluteReturn}%`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center space-y-1">
              <p className="text-xs text-muted-foreground">Total Closed</p>
              <p className="text-2xl font-bold" data-testid="stat-total-closed">{totals.closedCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center space-y-1">
              <p className="text-xs text-muted-foreground">Profitable</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="stat-profitable">
                {totals.profitableCount}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center space-y-1">
              <p className="text-xs text-muted-foreground">Loss Making</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="stat-loss">
                {totals.lossCount}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Period-wise Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-period-performance">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium text-muted-foreground">Period</th>
                    <th className="pb-2 font-medium text-muted-foreground text-center">Closed Calls</th>
                    <th className="pb-2 font-medium text-muted-foreground text-center">Profitable</th>
                    <th className="pb-2 font-medium text-muted-foreground text-center">Hit Rate</th>
                    <th className="pb-2 font-medium text-muted-foreground text-center">Abs. Return</th>
                    <th className="pb-2 font-medium text-muted-foreground text-center">Avg. Return</th>
                    <th className="pb-2 font-medium text-muted-foreground text-center">NIFTY (Approx.)</th>
                    <th className="pb-2 font-medium text-muted-foreground text-center">Alpha</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => {
                    const nifty = NIFTY_BENCHMARKS[p.label] || 0;
                    const alpha = p.closedCount > 0 ? Math.round((p.absoluteReturn - nifty) * 100) / 100 : 0;
                    return (
                      <tr key={p.label} className="border-b last:border-0" data-testid={`row-period-${p.label}`}>
                        <td className="py-3 font-medium">{p.label}</td>
                        <td className="py-3 text-center">{p.closedCount}</td>
                        <td className="py-3 text-center">{p.profitableCount}</td>
                        <td className="py-3 text-center">
                          <span className={p.hitRate >= 50 ? "text-green-600 dark:text-green-400" : p.closedCount > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                            {p.closedCount > 0 ? `${p.hitRate}%` : "--"}
                          </span>
                        </td>
                        <td className="py-3 text-center">
                          <span className={p.absoluteReturn >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                            {p.closedCount > 0 ? `${p.absoluteReturn >= 0 ? "+" : ""}${p.absoluteReturn}%` : "--"}
                          </span>
                        </td>
                        <td className="py-3 text-center">
                          {p.closedCount > 0 ? `${p.avgReturn >= 0 ? "+" : ""}${p.avgReturn}%` : "--"}
                        </td>
                        <td className="py-3 text-center text-muted-foreground">
                          {nifty > 0 ? `+${nifty}%` : "--"}
                        </td>
                        <td className="py-3 text-center">
                          {p.closedCount > 0 ? (
                            <span className={alpha >= 0 ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                              {alpha >= 0 ? "+" : ""}{alpha}%
                            </span>
                          ) : "--"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              NIFTY returns are approximate benchmarks for reference. Alpha = Strategy Return - NIFTY Return.
            </p>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                Max Profitable Call
              </CardTitle>
            </CardHeader>
            <CardContent>
              {maxProfit ? (
                <div className="space-y-2" data-testid="card-max-profit">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{maxProfit.label}</p>
                    <Badge variant="secondary" className="text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      {maxProfit.type === "call" ? "Call" : "Position"}
                    </Badge>
                  </div>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    +{maxProfit.gainPercent}%
                  </p>
                  {maxProfit.exitDate && (
                    <p className="text-xs text-muted-foreground">
                      Closed: {new Date(maxProfit.exitDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No profitable calls yet</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                Max Drawdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              {maxDrawdown && maxDrawdown.gainPercent < 0 ? (
                <div className="space-y-2" data-testid="card-max-drawdown">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{maxDrawdown.label}</p>
                    <Badge variant="secondary" className="text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30">
                      <XCircle className="w-3 h-3 mr-1" />
                      {maxDrawdown.type === "call" ? "Call" : "Position"}
                    </Badge>
                  </div>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {maxDrawdown.gainPercent}%
                  </p>
                  {maxDrawdown.exitDate && (
                    <p className="text-xs text-muted-foreground">
                      Closed: {new Date(maxDrawdown.exitDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No loss-making calls recorded</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Win / Loss Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center space-y-1 p-3 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Win Rate</p>
                <p className="font-semibold" data-testid="stat-win-rate">{totals.hitRate}%</p>
              </div>
              <div className="text-center space-y-1 p-3 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Avg. Return / Call</p>
                <p className="font-semibold" data-testid="stat-avg-return">
                  {totals.avgReturn >= 0 ? "+" : ""}{totals.avgReturn}%
                </p>
              </div>
              <div className="text-center space-y-1 p-3 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Total Return</p>
                <p className={`font-semibold ${totals.absoluteReturn >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  data-testid="stat-total-return"
                >
                  {totals.absoluteReturn >= 0 ? "+" : ""}{totals.absoluteReturn}%
                </p>
              </div>
              <div className="text-center space-y-1 p-3 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">Calls Analyzed</p>
                <p className="font-semibold" data-testid="stat-calls-analyzed">{totals.closedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Past performance is not indicative of future results. All performance data is calculated from actual platform-recorded advisory calls 
                since the strategy was published on AlphaMarket. NIFTY benchmark figures are approximate and provided for reference only. 
                Investment in securities is subject to market risk. Please read all related documents carefully before investing.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
