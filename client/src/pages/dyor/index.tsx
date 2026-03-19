import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { dyorApi } from "@/lib/dyor-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search, Star, TrendingUp, TrendingDown, BarChart3, FlaskConical,
  X, Loader2, Activity, LineChart, Target, Zap, Eye, Bell,
  Briefcase, Play, ChevronRight, ArrowUpDown, Layers, GitBranch
} from "lucide-react";

const SCREENER_STRATEGIES = [
  "momentum", "breakout", "relative_strength", "golden_cross",
  "oversold", "minervini", "mean_reversion", "volume_breakout",
  "rsi_divergence", "macd_crossover", "bollinger_squeeze",
  "ema_stack", "52w_high", "52w_low", "sector_momentum"
];

const CAP_FILTERS = ["All Caps", "Large Cap", "Mid Cap", "Small Cap", "Micro Cap"];

export default function DyorPage() {
  const [activeTab, setActiveTab] = useState("screener");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [screenerStrategy, setScreenerStrategy] = useState("momentum");
  const [screenerSector, setScreenerSector] = useState("All Sectors");
  const [btSymbol, setBtSymbol] = useState("RELIANCE");
  const [btStrategy, setBtStrategy] = useState("sma_crossover");
  const [btFrom, setBtFrom] = useState("2024-01-01");
  const [btTo, setBtTo] = useState("2025-12-31");
  const [optSymbol, setOptSymbol] = useState("RELIANCE");
  const [fwdStrategy, setFwdStrategy] = useState("momentum");
  const [fwdSymbols, setFwdSymbols] = useState("RELIANCE,TCS,INFY");
  const [alertSymbol, setAlertSymbol] = useState("");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertCondition, setAlertCondition] = useState("above");
  const qc = useQueryClient();
  const [patternSymbol, setPatternSymbol] = useState("RELIANCE");
  const [dcfSymbol, setDcfSymbol] = useState("TCS");

  // ── Search ──
  const { data: searchResults } = useQuery({
    queryKey: ["dyor", "search", searchQuery],
    queryFn: () => dyorApi.searchSymbols(searchQuery),
    enabled: searchQuery.length >= 2,
  });

  // ── Stock detail ──
  const { data: stockData, isLoading: loadingStock } = useQuery({
    queryKey: ["dyor", "fundamentals", selectedSymbol],
    queryFn: () => dyorApi.stockFundamentals(selectedSymbol),
    enabled: !!selectedSymbol,
  });
  const { data: priceData } = useQuery({
    queryKey: ["dyor", "price", selectedSymbol],
    queryFn: () => dyorApi.stockPrice(selectedSymbol),
    enabled: !!selectedSymbol,
    refetchInterval: 30000,
  });

  // ── Screener ──
  const { data: screenerData, isLoading: loadingScreener, refetch: refetchScreener } = useQuery({
    queryKey: ["dyor", "screener", screenerStrategy],
    queryFn: () => dyorApi.screener(screenerStrategy),
    enabled: false,
  });

  // ── Sectors ──
  const { data: sectorsData } = useQuery({
    queryKey: ["dyor", "sectors"],
    queryFn: () => dyorApi.sectors(),
  });

  // ── Sector RRG ──
  const { data: rrgData } = useQuery({
    queryKey: ["dyor", "rrg"],
    queryFn: () => dyorApi.sectorRrg(),
    enabled: activeTab === "sectors",
  });

  // ── Watchlist ──
  const { data: watchlist } = useQuery({
    queryKey: ["dyor", "watchlist"],
    queryFn: () => dyorApi.watchlist(),
  });
  const { data: watchlistPrices } = useQuery({
    queryKey: ["dyor", "watchlist-prices"],
    queryFn: () => dyorApi.watchlistPrices(),
    enabled: activeTab === "watchlist" && (watchlist?.symbols?.length > 0),
    refetchInterval: 30000,
  });
  const addWatch = useMutation({
    mutationFn: (s: string) => dyorApi.addToWatchlist(s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dyor", "watchlist"] }),
  });
  const removeWatch = useMutation({
    mutationFn: (s: string) => dyorApi.removeFromWatchlist(s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dyor", "watchlist"] }),
  });

  // ── Backtests ──
  const { data: backtests } = useQuery({
    queryKey: ["dyor", "backtests"],
    queryFn: () => dyorApi.backtests(),
  });
  const runBt = useMutation({
    mutationFn: () => dyorApi.runBacktest({ symbol: btSymbol, strategy: btStrategy, from_date: btFrom, to_date: btTo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dyor", "backtests"] }),
  });

  // ── Paper Trades ──
  const { data: paperTrades } = useQuery({
    queryKey: ["dyor", "paper-trades"],
    queryFn: () => dyorApi.paperTrades(),
  });

  // ── Forward Tests ──
  const { data: forwardTests } = useQuery({
    queryKey: ["dyor", "forward-tests"],
    queryFn: () => dyorApi.forwardTests(),
    enabled: activeTab === "forward",
  });
  const createFwd = useMutation({
    mutationFn: () => dyorApi.createForwardTest({ strategy: fwdStrategy, symbols: fwdSymbols.split(",").map(s => s.trim()) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dyor", "forward-tests"] }),
  });

  // ── Model Portfolios ──
  const { data: modelPortfolios } = useQuery({
    queryKey: ["dyor", "model-portfolios"],
    queryFn: () => dyorApi.modelPortfolios(),
    enabled: activeTab === "portfolio",
  });
  const { data: mpTemplates } = useQuery({
    queryKey: ["dyor", "mp-templates"],
    queryFn: () => dyorApi.modelPortfolioTemplates(),
    enabled: activeTab === "portfolio",
  });

  // ── Options ──
  const { data: optionsChain, isLoading: loadingOptions, refetch: refetchOptions } = useQuery({
    queryKey: ["dyor", "options", optSymbol],
    queryFn: () => dyorApi.optionsChain(optSymbol),
    enabled: false,
  });

  // ── Alerts ──
  const { data: alerts } = useQuery({
    queryKey: ["dyor", "alerts"],
    queryFn: () => dyorApi.alerts(),
    enabled: activeTab === "alerts",
  });
  const { data: morningData, isLoading: loadingMorning } = useQuery({
    queryKey: ["dyor", "morning-brief"],
    queryFn: () => dyorApi.morningBrief(),
    enabled: activeTab === "morning",
  });
  const { data: patternData, isLoading: loadingPatterns } = useQuery({
    queryKey: ["dyor", "patterns", patternSymbol],
    queryFn: () => dyorApi.patterns(patternSymbol),
    enabled: activeTab === "patterns" && !!patternSymbol,
  });
  const { data: heatmapData, isLoading: loadingHeatmap } = useQuery({
    queryKey: ["dyor", "heatmap"],
    queryFn: () => dyorApi.sectorHeatmap(),
    enabled: activeTab === "heatmap",
  });
  const { data: dcfData, isLoading: loadingDcf } = useQuery({
    queryKey: ["dyor", "dcf", dcfSymbol],
    queryFn: () => dyorApi.dcf(dcfSymbol),
    enabled: activeTab === "dcf" && !!dcfSymbol,
  });
  const { data: dividendData, isLoading: loadingDividends } = useQuery({
    queryKey: ["dyor", "dividends"],
    queryFn: () => dyorApi.dividends(),
    enabled: activeTab === "dividends",
  });
  const createAlert = useMutation({
    mutationFn: () => dyorApi.createAlert({ symbol: alertSymbol, target_price: parseFloat(alertPrice), condition: alertCondition }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dyor", "alerts"] }); setAlertSymbol(""); setAlertPrice(""); },
  });

  // ── Chart ──
  const { data: chartData } = useQuery({
    queryKey: ["dyor", "chart", selectedSymbol],
    queryFn: () => dyorApi.stockChart(selectedSymbol),
    enabled: !!selectedSymbol && activeTab === "charts",
  });

  const selectStock = (sym: string) => { setSelectedSymbol(sym); setSearchQuery(sym); };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      {/* Hero + Search */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-3">
            <Activity className="h-7 w-7 text-emerald-400" />
            <div>
              <h1 className="text-xl font-bold">DYOR Research Lab</h1>
              <p className="text-slate-400 text-xs">923 NSE stocks · 34+ screeners · Backtesting · Options · Paper Trading</p>
            </div>
          </div>
          <div className="relative max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search stocks — RELIANCE, TCS, INFY..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400"
            />
            {searchQuery.length >= 2 && searchResults?.results?.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border max-h-60 overflow-y-auto z-50">
                {searchResults.results.slice(0, 10).map((item: any) => (
                  <button key={item.symbol} onClick={() => selectStock(item.symbol)}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex justify-between text-gray-900 text-sm">
                    <span><span className="font-mono font-semibold">{item.symbol}</span>
                    <span className="text-gray-500 ml-2">{item.sector}</span></span>
                    <span className="text-xs text-gray-400">{item.industry}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Stock Detail Panel */}
        {selectedSymbol && (
          <Card className="mb-4">
            <CardContent className="pt-4">
              {loadingStock ? (
                <div className="flex items-center gap-2 py-6 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Loading {selectedSymbol}...</div>
              ) : stockData?.fundamentals ? (
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold">{selectedSymbol}</h2>
                      <Badge variant="outline">{stockData.fundamentals.sector}</Badge>
                      <Button size="sm" variant="outline" onClick={() => addWatch.mutate(selectedSymbol)}><Star className="h-3 w-3 mr-1" />Watch</Button>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedSymbol("")}><X className="h-3 w-3" /></Button>
                    </div>
                    <div className="text-right">
                      {priceData && <p className="text-2xl font-bold">₹{Number(priceData.price || priceData.ltp || stockData.fundamentals.current_price || 0).toLocaleString("en-IN")}</p>}
                      {priceData?.change_pct != null && (
                        <p className={`text-sm font-medium ${priceData.change_pct >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {priceData.change_pct >= 0 ? "+" : ""}{priceData.change_pct.toFixed(2)}%
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">{stockData.fundamentals.name}</p>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {[
                      ["Market Cap", stockData.fundamentals.market_cap ? `₹${(stockData.fundamentals.market_cap / 1e10).toFixed(0)}K Cr` : "—"],
                      ["P/E", stockData.fundamentals.pe_ratio?.toFixed(1) || "—"],
                      ["P/B", stockData.fundamentals.pb_ratio?.toFixed(2) || "—"],
                      ["EPS", `₹${stockData.fundamentals.eps?.toFixed(1) || "—"}`],
                      ["D/E", stockData.fundamentals.debt_to_equity?.toFixed(1) || "—"],
                      ["Div Yield", stockData.fundamentals.dividend_yield ? `${stockData.fundamentals.dividend_yield.toFixed(1)}%` : "—"],
                      ["52W High", stockData.fundamentals["52_week_high"] ? `₹${stockData.fundamentals["52_week_high"].toLocaleString("en-IN")}` : "—"],
                      ["52W Low", stockData.fundamentals["52_week_low"] ? `₹${stockData.fundamentals["52_week_low"].toLocaleString("en-IN")}` : "—"],
                      ["Revenue", stockData.fundamentals.revenue ? `₹${(stockData.fundamentals.revenue / 1e10).toFixed(0)}K Cr` : "—"],
                      ["Profit", stockData.fundamentals.net_income ? `₹${(stockData.fundamentals.net_income / 1e10).toFixed(0)}K Cr` : "—"],
                      ["Fwd P/E", stockData.fundamentals.forward_pe?.toFixed(1) || "—"],
                      ["Beta", stockData.fundamentals.beta?.toFixed(2) || "—"],
                    ].map(([label, val]) => (
                      <div key={label as string} className="p-2 bg-gray-50 rounded text-center">
                        <p className="text-[10px] text-gray-500 uppercase">{label}</p>
                        <p className="text-sm font-semibold">{val}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="text-gray-500 text-center py-4">No data for {selectedSymbol}</p>}
            </CardContent>
          </Card>
        )}

        {/* Main Tabs — matches testalpha.in sections */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto mb-4">
            <TabsList className="inline-flex min-w-max">
              <TabsTrigger value="screener"><Zap className="h-3.5 w-3.5 mr-1" />Screener</TabsTrigger>
              <TabsTrigger value="backtest"><FlaskConical className="h-3.5 w-3.5 mr-1" />Backtest</TabsTrigger>
              <TabsTrigger value="charts"><LineChart className="h-3.5 w-3.5 mr-1" />Charts</TabsTrigger>
              <TabsTrigger value="options"><Layers className="h-3.5 w-3.5 mr-1" />Options</TabsTrigger>
              <TabsTrigger value="paper"><Target className="h-3.5 w-3.5 mr-1" />Paper Trades</TabsTrigger>
              <TabsTrigger value="forward"><GitBranch className="h-3.5 w-3.5 mr-1" />Forward Test</TabsTrigger>
              <TabsTrigger value="portfolio"><Briefcase className="h-3.5 w-3.5 mr-1" />Model Port.</TabsTrigger>
              <TabsTrigger value="watchlist"><Star className="h-3.5 w-3.5 mr-1" />Watchlist</TabsTrigger>
              <TabsTrigger value="sectors"><BarChart3 className="h-3.5 w-3.5 mr-1" />Sectors</TabsTrigger>
              <TabsTrigger value="alerts"><Bell className="h-3.5 w-3.5 mr-1" />Alerts</TabsTrigger>
              <TabsTrigger value="morning"><Activity className="h-3.5 w-3.5 mr-1" />Morning Brief</TabsTrigger>
              <TabsTrigger value="patterns"><Eye className="h-3.5 w-3.5 mr-1" />Patterns</TabsTrigger>
              <TabsTrigger value="heatmap"><BarChart3 className="h-3.5 w-3.5 mr-1" />Heatmap</TabsTrigger>
              <TabsTrigger value="dcf"><TrendingUp className="h-3.5 w-3.5 mr-1" />DCF Calc</TabsTrigger>
              <TabsTrigger value="dividends"><ArrowUpDown className="h-3.5 w-3.5 mr-1" />Dividends</TabsTrigger>
            </TabsList>
          </div>

          {/* ═══ SCREENER ═══ */}
          <TabsContent value="screener">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Stock Screener</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  <Select value={screenerStrategy} onValueChange={setScreenerStrategy}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SCREENER_STRATEGIES.map(s => (
                        <SelectItem key={s} value={s}>{s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sectorsData?.sectors && (
                    <Select value={screenerSector} onValueChange={setScreenerSector}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All Sectors">All Sectors</SelectItem>
                        {sectorsData.sectors.map((s: any) => (
                          <SelectItem key={s.name || s} value={s.name || s}>{s.name || s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button onClick={() => refetchScreener()} disabled={loadingScreener}>
                    {loadingScreener ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                    Scan Market
                  </Button>
                </div>
                {screenerData?.results ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-gray-500 text-left">
                        <th className="py-2 px-2">Symbol</th><th className="py-2 px-2">Sector</th>
                        <th className="py-2 px-2 text-right">Price</th><th className="py-2 px-2 text-right">Change</th>
                        <th className="py-2 px-2 text-right">Score</th><th className="py-2 px-2"></th>
                      </tr></thead>
                      <tbody className="divide-y">
                        {(screenerData.results || []).slice(0, 50).map((r: any) => (
                          <tr key={r.symbol} className="hover:bg-gray-50">
                            <td className="py-2 px-2"><button onClick={() => selectStock(r.symbol)} className="font-mono font-medium text-blue-600 hover:underline">{r.symbol}</button></td>
                            <td className="py-2 px-2 text-gray-500 text-xs">{r.sector}</td>
                            <td className="py-2 px-2 text-right">₹{r.price?.toLocaleString("en-IN") || "—"}</td>
                            <td className={`py-2 px-2 text-right ${(r.change_pct || 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {r.change_pct != null ? `${r.change_pct >= 0 ? "+" : ""}${r.change_pct.toFixed(2)}%` : "—"}
                            </td>
                            <td className="py-2 px-2 text-right font-medium">{r.score?.toFixed(1) || r.rank || "—"}</td>
                            <td className="py-2 px-2"><Button size="sm" variant="ghost" onClick={() => addWatch.mutate(r.symbol)}><Star className="h-3 w-3" /></Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : !loadingScreener ? (
                  <p className="text-gray-500 text-center py-8">Click <strong>Scan Market</strong> to begin</p>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ BACKTEST ═══ */}
          <TabsContent value="backtest">
            <Card className="mb-4">
              <CardHeader className="pb-3"><CardTitle className="text-base">Run Backtest</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div><Label className="text-xs">Symbol</Label><Input value={btSymbol} onChange={e => setBtSymbol(e.target.value)} placeholder="RELIANCE" /></div>
                  <div><Label className="text-xs">Strategy</Label>
                    <Select value={btStrategy} onValueChange={setBtStrategy}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["sma_crossover","ema_crossover","rsi_oversold","macd_signal","bollinger_bounce","breakout","mean_reversion","momentum","supertrend","donchian"].map(s => (
                          <SelectItem key={s} value={s}>{s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">From</Label><Input type="date" value={btFrom} onChange={e => setBtFrom(e.target.value)} /></div>
                  <div><Label className="text-xs">To</Label><Input type="date" value={btTo} onChange={e => setBtTo(e.target.value)} /></div>
                  <div className="flex items-end">
                    <Button onClick={() => runBt.mutate()} disabled={runBt.isPending} className="w-full">
                      {runBt.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />} Run
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Backtest Results</CardTitle></CardHeader>
              <CardContent>
                {backtests && Array.isArray(backtests) && backtests.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-gray-500"><th className="py-2 px-2 text-left">Symbol</th><th className="py-2 px-2 text-left">Strategy</th><th className="py-2 px-2 text-right">Return</th><th className="py-2 px-2 text-right">Trades</th><th className="py-2 px-2 text-right">Win Rate</th><th className="py-2 px-2 text-right">Sharpe</th></tr></thead>
                      <tbody className="divide-y">
                        {backtests.map((bt: any) => (
                          <tr key={bt.id} className="hover:bg-gray-50">
                            <td className="py-2 px-2 font-mono font-medium">{bt.symbol}</td>
                            <td className="py-2 px-2 text-gray-500">{bt.strategy}</td>
                            <td className={`py-2 px-2 text-right font-medium ${(bt.total_return || 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{bt.total_return != null ? `${bt.total_return >= 0 ? "+" : ""}${bt.total_return.toFixed(2)}%` : "—"}</td>
                            <td className="py-2 px-2 text-right">{bt.total_trades || "—"}</td>
                            <td className="py-2 px-2 text-right">{bt.win_rate != null ? `${bt.win_rate.toFixed(1)}%` : "—"}</td>
                            <td className="py-2 px-2 text-right">{bt.sharpe_ratio?.toFixed(2) || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-gray-500 text-center py-8">No backtests yet. Configure and run one above.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ CHARTS ═══ */}
          <TabsContent value="charts">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Price Chart</CardTitle></CardHeader>
              <CardContent>
                {selectedSymbol ? (
                  chartData ? (
                    <div>
                      <p className="text-sm text-gray-600 mb-3">Showing chart data for <strong>{selectedSymbol}</strong></p>
                      <div className="overflow-x-auto max-h-96">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b text-gray-500"><th className="py-1 px-2 text-left">Date</th><th className="py-1 px-2 text-right">Open</th><th className="py-1 px-2 text-right">High</th><th className="py-1 px-2 text-right">Low</th><th className="py-1 px-2 text-right">Close</th><th className="py-1 px-2 text-right">Volume</th></tr></thead>
                          <tbody className="divide-y">
                            {(chartData.candles || chartData.data || chartData || []).slice(-30).reverse().map((c: any, i: number) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="py-1 px-2">{c.date || c.timestamp || ""}</td>
                                <td className="py-1 px-2 text-right">₹{c.open?.toFixed(2)}</td>
                                <td className="py-1 px-2 text-right">₹{c.high?.toFixed(2)}</td>
                                <td className="py-1 px-2 text-right">₹{c.low?.toFixed(2)}</td>
                                <td className="py-1 px-2 text-right font-medium">₹{c.close?.toFixed(2)}</td>
                                <td className="py-1 px-2 text-right text-gray-500">{c.volume?.toLocaleString("en-IN")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : <p className="text-gray-500 text-center py-8">Search and select a stock to view chart data</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ OPTIONS ═══ */}
          <TabsContent value="options">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Options Chain</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <Input value={optSymbol} onChange={e => setOptSymbol(e.target.value.toUpperCase())} placeholder="RELIANCE" className="w-40" />
                  <Button onClick={() => refetchOptions()} disabled={loadingOptions}>
                    {loadingOptions ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Search className="h-4 w-4 mr-1" />} Load Chain
                  </Button>
                </div>
                {optionsChain ? (
                  <div className="overflow-x-auto max-h-96">
                    {optionsChain.calls && (
                      <div>
                        <h4 className="font-semibold mb-2 text-green-700">Calls</h4>
                        <table className="w-full text-xs mb-4">
                          <thead><tr className="border-b text-gray-500"><th className="py-1 px-2">Strike</th><th className="py-1 px-2 text-right">LTP</th><th className="py-1 px-2 text-right">OI</th><th className="py-1 px-2 text-right">Volume</th><th className="py-1 px-2 text-right">IV</th></tr></thead>
                          <tbody className="divide-y">
                            {(optionsChain.calls || []).slice(0, 20).map((c: any, i: number) => (
                              <tr key={i} className="hover:bg-green-50"><td className="py-1 px-2 font-medium">{c.strike}</td><td className="py-1 px-2 text-right">₹{c.ltp?.toFixed(2)}</td><td className="py-1 px-2 text-right">{c.oi?.toLocaleString()}</td><td className="py-1 px-2 text-right">{c.volume?.toLocaleString()}</td><td className="py-1 px-2 text-right">{c.iv?.toFixed(1)}%</td></tr>
                            ))}
                          </tbody>
                        </table>
                        <h4 className="font-semibold mb-2 text-red-700">Puts</h4>
                        <table className="w-full text-xs">
                          <thead><tr className="border-b text-gray-500"><th className="py-1 px-2">Strike</th><th className="py-1 px-2 text-right">LTP</th><th className="py-1 px-2 text-right">OI</th><th className="py-1 px-2 text-right">Volume</th><th className="py-1 px-2 text-right">IV</th></tr></thead>
                          <tbody className="divide-y">
                            {(optionsChain.puts || []).slice(0, 20).map((p: any, i: number) => (
                              <tr key={i} className="hover:bg-red-50"><td className="py-1 px-2 font-medium">{p.strike}</td><td className="py-1 px-2 text-right">₹{p.ltp?.toFixed(2)}</td><td className="py-1 px-2 text-right">{p.oi?.toLocaleString()}</td><td className="py-1 px-2 text-right">{p.volume?.toLocaleString()}</td><td className="py-1 px-2 text-right">{p.iv?.toFixed(1)}%</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : !loadingOptions ? <p className="text-gray-500 text-center py-8">Enter a symbol and click <strong>Load Chain</strong></p> : null}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ PAPER TRADES ═══ */}
          <TabsContent value="paper">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Paper Trades</CardTitle></CardHeader>
              <CardContent>
                {paperTrades && Array.isArray(paperTrades) && paperTrades.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-gray-500"><th className="py-2 px-2 text-left">Symbol</th><th className="py-2 px-2">Direction</th><th className="py-2 px-2 text-right">Entry</th><th className="py-2 px-2 text-right">Exit</th><th className="py-2 px-2 text-right">P&L</th><th className="py-2 px-2">Status</th></tr></thead>
                    <tbody className="divide-y">{paperTrades.map((pt: any) => (
                      <tr key={pt.id} className="hover:bg-gray-50">
                        <td className="py-2 px-2 font-mono font-medium">{pt.symbol}</td>
                        <td className="py-2 px-2 text-center"><Badge variant="outline">{pt.direction || "LONG"}</Badge></td>
                        <td className="py-2 px-2 text-right">₹{pt.entry_price?.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right">{pt.exit_price ? `₹${pt.exit_price.toFixed(2)}` : "—"}</td>
                        <td className={`py-2 px-2 text-right font-medium ${(pt.pnl || 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{pt.pnl != null ? `${pt.pnl >= 0 ? "+" : ""}₹${pt.pnl.toFixed(2)}` : "—"}</td>
                        <td className="py-2 px-2"><Badge className={pt.status === "open" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}>{pt.status}</Badge></td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : <p className="text-gray-500 text-center py-8">No paper trades. Open one from the API or screener results.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ FORWARD TEST ═══ */}
          <TabsContent value="forward">
            <Card className="mb-4">
              <CardHeader className="pb-3"><CardTitle className="text-base">Create Forward Test</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label className="text-xs">Strategy</Label>
                    <Select value={fwdStrategy} onValueChange={setFwdStrategy}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SCREENER_STRATEGIES.slice(0, 10).map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">Symbols (comma-separated)</Label><Input value={fwdSymbols} onChange={e => setFwdSymbols(e.target.value)} /></div>
                  <div className="flex items-end"><Button onClick={() => createFwd.mutate()} disabled={createFwd.isPending} className="w-full">
                    {createFwd.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />} Start Forward Test
                  </Button></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Active Forward Tests</CardTitle></CardHeader>
              <CardContent>
                {forwardTests && Array.isArray(forwardTests) && forwardTests.length > 0 ? (
                  <div className="space-y-3">{forwardTests.map((ft: any) => (
                    <div key={ft.id} className="p-3 border rounded-lg flex justify-between items-center">
                      <div><p className="font-medium">{ft.strategy}</p><p className="text-xs text-gray-500">{ft.symbols?.join(", ") || "—"} · {ft.status}</p></div>
                      <Badge className={ft.status === "running" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"}>{ft.status}</Badge>
                    </div>
                  ))}</div>
                ) : <p className="text-gray-500 text-center py-8">No forward tests. Create one above.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ MODEL PORTFOLIOS ═══ */}
          <TabsContent value="portfolio">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Your Model Portfolios</CardTitle></CardHeader>
                <CardContent>
                  {modelPortfolios && Array.isArray(modelPortfolios) && modelPortfolios.length > 0 ? (
                    <div className="space-y-3">{modelPortfolios.map((mp: any) => (
                      <div key={mp.id} className="p-3 border rounded-lg"><p className="font-medium">{mp.name}</p><p className="text-xs text-gray-500">{mp.holdings?.length || 0} holdings · {mp.strategy || "Custom"}</p></div>
                    ))}</div>
                  ) : <p className="text-gray-500 text-center py-6">No model portfolios yet.</p>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Templates</CardTitle></CardHeader>
                <CardContent>
                  {mpTemplates && Array.isArray(mpTemplates) && mpTemplates.length > 0 ? (
                    <div className="space-y-2">{mpTemplates.map((t: any) => (
                      <div key={t.id || t.name} className="p-3 border rounded-lg flex justify-between items-center">
                        <div><p className="font-medium text-sm">{t.name}</p><p className="text-xs text-gray-500">{t.description || t.category || ""}</p></div>
                        <Button size="sm" variant="outline">Use</Button>
                      </div>
                    ))}</div>
                  ) : <p className="text-gray-500 text-center py-6">No templates available.</p>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ═══ WATCHLIST ═══ */}
          <TabsContent value="watchlist">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Watchlist</CardTitle></CardHeader>
              <CardContent>
                {watchlist?.symbols?.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-gray-500"><th className="py-2 px-2 text-left">Symbol</th><th className="py-2 px-2 text-right">Price</th><th className="py-2 px-2 text-right">Change</th><th className="py-2 px-2"></th></tr></thead>
                    <tbody className="divide-y">{watchlist.symbols.map((sym: string) => {
                      const wp = watchlistPrices?.prices?.find((p: any) => p.symbol === sym);
                      return (
                        <tr key={sym} className="hover:bg-gray-50">
                          <td className="py-2 px-2"><button onClick={() => selectStock(sym)} className="font-mono font-medium text-blue-600 hover:underline">{sym}</button></td>
                          <td className="py-2 px-2 text-right">{wp?.price ? `₹${wp.price.toLocaleString("en-IN")}` : "—"}</td>
                          <td className={`py-2 px-2 text-right ${(wp?.change_pct || 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{wp?.change_pct != null ? `${wp.change_pct >= 0 ? "+" : ""}${wp.change_pct.toFixed(2)}%` : "—"}</td>
                          <td className="py-2 px-2 text-right"><Button size="sm" variant="ghost" onClick={() => removeWatch.mutate(sym)}><X className="h-3 w-3" /></Button></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                ) : <p className="text-gray-500 text-center py-8">Watchlist empty. Search a stock and click ⭐ Watch.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ SECTORS ═══ */}
          <TabsContent value="sectors">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Sector Performance</CardTitle></CardHeader>
                <CardContent>
                  {sectorsData?.sectors ? (
                    <div className="space-y-2">{(Array.isArray(sectorsData.sectors) ? sectorsData.sectors : Object.entries(sectorsData.sectors).map(([name, data]: any) => ({name, ...data}))).slice(0, 20).map((s: any) => (
                      <div key={s.name} className="flex justify-between items-center p-2 rounded hover:bg-gray-50">
                        <span className="text-sm font-medium">{s.name}</span>
                        <span className={`text-sm font-medium ${(s.change_pct || s.avg_change || 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {(s.change_pct || s.avg_change) != null ? `${(s.change_pct || s.avg_change) >= 0 ? "+" : ""}${(s.change_pct || s.avg_change).toFixed(2)}%` : `${s.count || s.stock_count || 0} stocks`}
                        </span>
                      </div>
                    ))}</div>
                  ) : <Loader2 className="h-5 w-5 animate-spin mx-auto" />}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Sector Rotation (RRG)</CardTitle></CardHeader>
                <CardContent>
                  {rrgData ? (
                    <div className="overflow-x-auto max-h-80">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b text-gray-500"><th className="py-1 px-2 text-left">Sector</th><th className="py-1 px-2 text-right">RS-Ratio</th><th className="py-1 px-2 text-right">RS-Momentum</th><th className="py-1 px-2">Quadrant</th></tr></thead>
                        <tbody className="divide-y">
                          {(rrgData.sectors || rrgData.data || rrgData || []).slice(0, 20).map((s: any) => (
                            <tr key={s.sector || s.name} className="hover:bg-gray-50">
                              <td className="py-1 px-2 font-medium">{s.sector || s.name}</td>
                              <td className="py-1 px-2 text-right">{s.rs_ratio?.toFixed(2) || "—"}</td>
                              <td className="py-1 px-2 text-right">{s.rs_momentum?.toFixed(2) || "—"}</td>
                              <td className="py-1 px-2"><Badge variant="outline" className="text-[10px]">{s.quadrant || "—"}</Badge></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="text-gray-500 text-center py-6">Loading RRG data...</p>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ═══ ALERTS ═══ */}
          <TabsContent value="alerts">
            <Card className="mb-4">
              <CardHeader className="pb-3"><CardTitle className="text-base">Create Alert</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Input value={alertSymbol} onChange={e => setAlertSymbol(e.target.value.toUpperCase())} placeholder="Symbol" className="w-32" />
                  <Select value={alertCondition} onValueChange={setAlertCondition}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="above">Price Above</SelectItem><SelectItem value="below">Price Below</SelectItem></SelectContent>
                  </Select>
                  <Input value={alertPrice} onChange={e => setAlertPrice(e.target.value)} placeholder="Price" type="number" className="w-28" />
                  <Button onClick={() => createAlert.mutate()} disabled={createAlert.isPending || !alertSymbol || !alertPrice}>
                    {createAlert.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Bell className="h-4 w-4 mr-1" />} Create
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Your Alerts</CardTitle></CardHeader>
              <CardContent>
                {alerts && Array.isArray(alerts) && alerts.length > 0 ? (
                  <div className="space-y-2">{alerts.map((a: any) => (
                    <div key={a.id} className="p-3 border rounded-lg flex justify-between items-center">
                      <div><span className="font-mono font-medium">{a.symbol}</span><span className="text-gray-500 text-sm ml-2">{a.condition} ₹{a.target_price}</span></div>
                      <Badge className={a.triggered ? "bg-green-100 text-green-700" : a.is_active ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}>{a.triggered ? "Triggered" : a.is_active ? "Active" : "Inactive"}</Badge>
                    </div>
                  ))}</div>
                ) : <p className="text-gray-500 text-center py-8">No alerts set. Create one above.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ MORNING BRIEF ═══ */}
          <TabsContent value="morning">
            <Card>
              <CardHeader><CardTitle>Morning Brief</CardTitle><CardDescription>Pre-market analysis with global cues, India indices, sector pulse & sentiment</CardDescription></CardHeader>
              <CardContent>
                {loadingMorning ? <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div> : morningData ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {Object.entries(morningData.global_cues || {}).map(([k, v]: any) => (
                        <div key={k} className="p-3 rounded-lg border bg-card">
                          <div className="text-xs text-muted-foreground">{v.name}</div>
                          <div className="text-lg font-bold">{typeof v.price === 'number' ? v.price.toLocaleString() : v.price}</div>
                          <Badge variant={v.change_pct >= 0 ? "default" : "destructive"} className="text-xs">{v.change_pct >= 0 ? "+" : ""}{v.change_pct}%</Badge>
                        </div>
                      ))}
                    </div>
                    {morningData.india && <div className="grid grid-cols-2 gap-3">
                      {Object.entries(morningData.india).map(([k, v]: any) => (
                        <div key={k} className="p-3 rounded-lg border bg-card">
                          <div className="text-xs text-muted-foreground">{v.name}</div>
                          <div className="text-lg font-bold">{v.close?.toLocaleString()}</div>
                          <div className="text-xs">H: {v.high?.toLocaleString()} L: {v.low?.toLocaleString()}</div>
                          <Badge variant={v.change_pct >= 0 ? "default" : "destructive"} className="text-xs">{v.change_pct >= 0 ? "+" : ""}{v.change_pct}%</Badge>
                        </div>
                      ))}
                    </div>}
                    {morningData.sentiment && (
                      <div className="p-4 rounded-lg border bg-card">
                        <div className="text-sm font-semibold mb-2">Market Sentiment: <Badge variant={morningData.sentiment.mood?.includes("BULL") ? "default" : morningData.sentiment.mood?.includes("BEAR") ? "destructive" : "secondary"}>{morningData.sentiment.mood}</Badge> (Score: {morningData.sentiment.score})</div>
                        <div className="text-xs text-muted-foreground">{morningData.sentiment.signals?.join(" • ")}</div>
                      </div>
                    )}
                    {morningData.sector_pulse && <div className="grid grid-cols-2 gap-3">
                      <div><div className="text-sm font-semibold text-green-500 mb-2">Top Gaining Sectors</div>{morningData.sector_pulse.gainers?.map((s: any) => <div key={s.sector} className="flex justify-between text-sm py-1"><span>{s.sector}</span><Badge variant="default">+{s.change_pct}%</Badge></div>)}</div>
                      <div><div className="text-sm font-semibold text-red-500 mb-2">Top Losing Sectors</div>{morningData.sector_pulse.losers?.map((s: any) => <div key={s.sector} className="flex justify-between text-sm py-1"><span>{s.sector}</span><Badge variant="destructive">{s.change_pct}%</Badge></div>)}</div>
                    </div>}
                  </div>
                ) : <p className="text-gray-500 text-center py-8">No data available</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ PATTERNS ═══ */}
          <TabsContent value="patterns">
            <Card>
              <CardHeader><CardTitle>Pattern Scanner</CardTitle><CardDescription>Technical indicators, chart patterns & composite score</CardDescription></CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <Input value={patternSymbol} onChange={e => setPatternSymbol(e.target.value.toUpperCase())} placeholder="Enter symbol e.g. RELIANCE" className="max-w-xs" />
                  <Button onClick={() => qc.invalidateQueries({ queryKey: ["dyor", "patterns", patternSymbol] })}>Scan</Button>
                </div>
                {loadingPatterns ? <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div> : patternData ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 p-4 rounded-lg border bg-card">
                      <div><div className="text-2xl font-bold">{patternData.symbol}</div><div className="text-sm text-muted-foreground">{patternData.name} • {patternData.sector}</div></div>
                      <div className="ml-auto text-right">
                        <div className="text-xl font-bold">Rs.{patternData.price?.toLocaleString()}</div>
                        <Badge variant={patternData.change_pct >= 0 ? "default" : "destructive"}>{patternData.change_pct >= 0 ? "+" : ""}{patternData.change_pct}%</Badge>
                      </div>
                      <div className="text-center px-4">
                        <div className={`text-3xl font-bold ${patternData.score > 0 ? "text-green-500" : patternData.score < 0 ? "text-red-500" : "text-gray-500"}`}>{patternData.score > 0 ? "+" : ""}{patternData.score}</div>
                        <Badge variant={patternData.verdict?.includes("BULL") ? "default" : patternData.verdict?.includes("BEAR") ? "destructive" : "secondary"}>{patternData.verdict}</Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      <div className="p-2 rounded border"><span className="text-muted-foreground">RSI</span> <span className="font-mono font-bold">{patternData.indicators?.rsi}</span></div>
                      <div className="p-2 rounded border"><span className="text-muted-foreground">MACD</span> <span className="font-mono font-bold">{patternData.indicators?.macd}</span></div>
                      <div className="p-2 rounded border"><span className="text-muted-foreground">ADX</span> <span className="font-mono font-bold">{patternData.indicators?.adx}</span></div>
                      <div className="p-2 rounded border"><span className="text-muted-foreground">Vol Ratio</span> <span className="font-mono font-bold">{patternData.indicators?.volume_ratio}x</span></div>
                      <div className="p-2 rounded border"><span className="text-muted-foreground">SMA20</span> <span className="font-mono">{patternData.indicators?.sma20}</span></div>
                      <div className="p-2 rounded border"><span className="text-muted-foreground">SMA50</span> <span className="font-mono">{patternData.indicators?.sma50}</span></div>
                      <div className="p-2 rounded border"><span className="text-muted-foreground">BB Width</span> <span className="font-mono">{patternData.indicators?.bb_width}</span></div>
                      <div className="p-2 rounded border"><span className="text-muted-foreground">Stoch K/D</span> <span className="font-mono">{patternData.indicators?.stoch_k}/{patternData.indicators?.stoch_d}</span></div>
                    </div>
                    {patternData.signals?.length > 0 && <div>
                      <div className="text-sm font-semibold mb-2">Signals ({patternData.bullish_signals} bullish, {patternData.bearish_signals} bearish)</div>
                      <div className="flex flex-wrap gap-1">{patternData.signals.map((s: any, i: number) => <Badge key={i} variant={s.signal === "BULLISH" ? "default" : s.signal === "BEARISH" ? "destructive" : "secondary"} className="text-xs">{s.name}</Badge>)}</div>
                    </div>}
                    {patternData.patterns?.length > 0 && <div>
                      <div className="text-sm font-semibold mb-2">Chart Patterns Detected</div>
                      {patternData.patterns.map((p: any, i: number) => (
                        <div key={i} className="p-3 rounded border mb-2">
                          <div className="flex items-center gap-2"><Badge variant={p.type === "BULLISH" ? "default" : p.type === "BEARISH" ? "destructive" : "secondary"}>{p.type}</Badge><span className="font-semibold">{p.pattern}</span>{p.stage && <Badge variant="outline">{p.stage}</Badge>}{p.reliability && <span className="text-xs text-muted-foreground">({p.reliability})</span>}</div>
                          <div className="text-sm text-muted-foreground mt-1">{p.description}</div>
                        </div>
                      ))}
                    </div>}
                    {patternData.levels && <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-sm">
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">S2</div><div className="font-mono text-red-500">{patternData.levels.s2}</div></div>
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">S1</div><div className="font-mono text-red-400">{patternData.levels.s1}</div></div>
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">Pivot</div><div className="font-mono">{patternData.levels.pivot}</div></div>
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">R1</div><div className="font-mono text-green-400">{patternData.levels.r1}</div></div>
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">R2</div><div className="font-mono text-green-500">{patternData.levels.r2}</div></div>
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">52W</div><div className="font-mono text-xs">{patternData.levels.from_high}% / +{patternData.levels.from_low}%</div></div>
                    </div>}
                    {patternData.narrative && <div className="p-3 rounded-lg border bg-muted/50 text-sm">{patternData.narrative}</div>}
                  </div>
                ) : <p className="text-gray-500 text-center py-8">Enter a symbol and click Scan</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ HEATMAP ═══ */}
          <TabsContent value="heatmap">
            <Card>
              <CardHeader><CardTitle>Sector Heatmap</CardTitle><CardDescription>Sector-wise performance with top movers</CardDescription></CardHeader>
              <CardContent>
                {loadingHeatmap ? <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div> : heatmapData?.sectors?.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {heatmapData.sectors.map((s: any) => (
                      <div key={s.sector} className={`p-3 rounded-lg border ${s.change_pct >= 0 ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                        <div className="font-semibold text-sm">{s.sector}</div>
                        <div className={`text-xl font-bold ${s.change_pct >= 0 ? "text-green-500" : "text-red-500"}`}>{s.change_pct >= 0 ? "+" : ""}{s.change_pct}%</div>
                        <div className="text-xs text-muted-foreground">{s.stock_count} stocks</div>
                        {s.top_stocks?.map((st: any) => <div key={st.symbol} className="flex justify-between text-xs mt-1"><span>{st.symbol}</span><span className={st.change >= 0 ? "text-green-500" : "text-red-500"}>{st.change >= 0 ? "+" : ""}{st.change}%</span></div>)}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-gray-500 text-center py-8">No heatmap data available</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ DCF CALCULATOR ═══ */}
          <TabsContent value="dcf">
            <Card>
              <CardHeader><CardTitle>DCF Intrinsic Value Calculator</CardTitle><CardDescription>EPS-based DCF, FCF-based DCF & Graham Number</CardDescription></CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <Input value={dcfSymbol} onChange={e => setDcfSymbol(e.target.value.toUpperCase())} placeholder="Enter symbol e.g. TCS" className="max-w-xs" />
                  <Button onClick={() => qc.invalidateQueries({ queryKey: ["dyor", "dcf", dcfSymbol] })}>Calculate</Button>
                </div>
                {loadingDcf ? <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div> : dcfData ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 p-4 rounded-lg border bg-card">
                      <div><div className="text-2xl font-bold">{dcfData.symbol}</div><div className="text-sm text-muted-foreground">{dcfData.company} • {dcfData.sector}</div></div>
                      <div className="ml-auto text-right">
                        <div className="text-sm text-muted-foreground">Current Price</div>
                        <div className="text-xl font-bold">Rs.{dcfData.price?.toLocaleString()}</div>
                      </div>
                      <div className="text-center px-4 border-l">
                        <div className="text-sm text-muted-foreground">Fair Value</div>
                        <div className="text-xl font-bold text-blue-500">Rs.{dcfData.avg_intrinsic?.toLocaleString()}</div>
                      </div>
                      <div className="text-center px-4 border-l">
                        <Badge className="text-lg px-3 py-1" variant={dcfData.verdict === "UNDERVALUED" ? "default" : dcfData.verdict === "OVERVALUED" ? "destructive" : "secondary"}>{dcfData.verdict}</Badge>
                        <div className="text-xs mt-1">Margin: {dcfData.margin_of_safety}%</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3 rounded border"><div className="text-xs text-muted-foreground">EPS DCF Value</div><div className="text-lg font-bold">Rs.{dcfData.eps_dcf?.intrinsic_value?.toLocaleString()}</div></div>
                      <div className="p-3 rounded border"><div className="text-xs text-muted-foreground">FCF DCF Value</div><div className="text-lg font-bold">Rs.{dcfData.fcf_dcf?.intrinsic_value ? dcfData.fcf_dcf.intrinsic_value.toLocaleString() : "N/A"}</div></div>
                      <div className="p-3 rounded border"><div className="text-xs text-muted-foreground">Graham Number</div><div className="text-lg font-bold">Rs.{dcfData.graham_number?.toLocaleString()}</div></div>
                      <div className="p-3 rounded border"><div className="text-xs text-muted-foreground">Margin of Safety</div><div className={`text-lg font-bold ${dcfData.margin_of_safety > 0 ? "text-green-500" : "text-red-500"}`}>{dcfData.margin_of_safety}%</div></div>
                    </div>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-sm">
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">EPS</div><div className="font-mono">{dcfData.eps}</div></div>
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">P/E</div><div className="font-mono">{dcfData.pe}</div></div>
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">Book Value</div><div className="font-mono">{dcfData.book_value}</div></div>
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">ROE</div><div className="font-mono">{dcfData.roe}%</div></div>
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">FCF/Share</div><div className="font-mono">{dcfData.fcf_per_share}</div></div>
                      <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">Growth Rate</div><div className="font-mono">{dcfData.assumptions?.growth_rate}%</div></div>
                    </div>
                  </div>
                ) : <p className="text-gray-500 text-center py-8">Enter a symbol and click Calculate</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ DIVIDENDS ═══ */}
          <TabsContent value="dividends">
            <Card>
              <CardHeader><CardTitle>Dividend Tracker</CardTitle><CardDescription>Top dividend-paying stocks sorted by yield</CardDescription></CardHeader>
              <CardContent>
                {loadingDividends ? <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div> : dividendData?.by_yield?.length > 0 ? (
                  <div>
                    {dividendData.upcoming_ex_dates?.length > 0 && (
                      <div className="mb-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
                        <div className="text-sm font-semibold mb-1">Upcoming Ex-Dividend Dates</div>
                        <div className="flex flex-wrap gap-2">{dividendData.upcoming_ex_dates.map((d: any) => <Badge key={d.symbol} variant="outline">{d.symbol}: {d.ex_dividend_date} ({d.dividend_yield}%)</Badge>)}</div>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-3">Symbol</th><th className="pr-3">Price</th><th className="pr-3">Yield %</th><th className="pr-3">Div Rate</th><th className="pr-3">Payout %</th><th className="pr-3">P/E</th><th className="pr-3">Sector</th><th>Ex-Date</th>
                        </tr></thead>
                        <tbody>{dividendData.by_yield.map((d: any) => (
                          <tr key={d.symbol} className="border-b hover:bg-muted/50">
                            <td className="py-2 pr-3 font-semibold">{d.symbol}</td>
                            <td className="pr-3">Rs.{d.price?.toLocaleString()}</td>
                            <td className="pr-3 font-bold text-green-500">{d.dividend_yield}%</td>
                            <td className="pr-3">Rs.{d.dividend_rate}</td>
                            <td className="pr-3">{d.payout_ratio}%</td>
                            <td className="pr-3">{d.pe}</td>
                            <td className="pr-3 text-xs">{d.sector}</td>
                            <td className="text-xs">{d.ex_dividend_date || "—"}{d.upcoming && <Badge variant="outline" className="ml-1 text-xs">Upcoming</Badge>}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">{dividendData.count} stocks • Data as of {dividendData.date}</div>
                  </div>
                ) : <p className="text-gray-500 text-center py-8">No dividend data available</p>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <Footer />
    </div>
  );
}
