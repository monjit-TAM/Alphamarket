import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TrendingUp, Shield, BarChart3, Users, ArrowRight,
  Zap, Eye, BookOpen, Filter, ChevronRight, Activity
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { StrategyCard } from "@/components/strategy-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import type { Strategy, User } from "@shared/schema";

type StrategyWithMeta = Strategy & { advisor?: Partial<User>; liveCalls?: number };

const liveCallCategories = [
  { key: "Intraday", label: "Intraday Today" },
  { key: "F&O", label: "F&O" },
  { key: "Swing", label: "Swing" },
  { key: "Positional", label: "Positional (Long Term)" },
  { key: "Multi Leg", label: "Multi Leg" },
  { key: "Commodities", label: "Commodities" },
  { key: "Basket", label: "Basket" },
];

const themeOptions = ["Equity", "F&O", "Growth", "Value", "SwingTrade", "Momentum", "Basket", "Commodity", "Dividend Stocks", "Shorting", "ETF"];
const volatilityOptions = ["Low", "Medium", "High"];
const horizonOptions = ["Intraday", "Swing", "Positional", "Long Term"];

export default function Home() {
  const [themeFilter, setThemeFilter] = useState("");
  const [volatilityFilter, setVolatilityFilter] = useState("");
  const [horizonFilter, setHorizonFilter] = useState("");
  const [search, setSearch] = useState("");

  const { data: strategies, isLoading } = useQuery<StrategyWithMeta[]>({
    queryKey: ["/api/strategies/public"],
  });

  const { data: liveCallCounts } = useQuery<Record<string, number>>({
    queryKey: ["/api/live-call-counts"],
  });

  const filtered = (strategies || []).filter((s) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !(s.advisor?.companyName || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (themeFilter && !(s.theme || []).some((t) => t.toLowerCase().includes(themeFilter.toLowerCase()))) return false;
    if (volatilityFilter && s.volatility?.toLowerCase() !== volatilityFilter.toLowerCase()) return false;
    if (horizonFilter && !(s.horizon || "").toLowerCase().includes(horizonFilter.toLowerCase())) return false;
    return true;
  });

  const stats = [
    { value: "40+", label: "Advisors", icon: Users },
    { value: "80+", label: "Strategies", icon: BarChart3 },
    { value: "3M+", label: "Customers Reached", icon: TrendingUp },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <section className="relative overflow-hidden bg-gradient-to-br from-primary/8 via-background to-accent/5">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-10 md:py-16">
          <div className="grid md:grid-cols-3 gap-8 items-center">
            <div className="md:col-span-2 space-y-4">
              <div className="flex items-center gap-6 flex-wrap">
                {stats.map((s) => (
                  <div key={s.label} className="text-center" data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, '-')}`}>
                    <p className="text-2xl md:text-3xl font-bold text-primary">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 justify-end">
              <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center">
                <Activity className="w-7 h-7 text-primary" />
              </div>
              <span className="font-semibold text-lg">Investment Platform</span>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-muted/20 border-y">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-10 md:py-14">
          <div className="max-w-3xl mx-auto text-center space-y-4 mb-8">
            <h1 className="text-2xl md:text-4xl font-bold tracking-tight leading-tight">
              Find the Right Trading and Investment Ideas for you
            </h1>
            <p className="text-muted-foreground">
              Choose based on your risk appetite, trading style, or market focus.
              Access curated strategies from verified advisors and build your perfect portfolio.
            </p>
          </div>

          <div className="mb-8">
            <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Live Calls
              <span className="text-xs text-muted-foreground font-normal ml-1">Real-time opportunities</span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
              {liveCallCategories.map((cat) => {
                const count = liveCallCounts?.[cat.key] ?? 0;
                return (
                  <Card key={cat.key} className="hover-elevate" data-testid={`live-calls-${cat.key.toLowerCase().replace(/\s+/g, '-')}`}>
                    <CardContent className="p-3 text-center space-y-1">
                      <p className="text-2xl font-bold text-primary">{count}</p>
                      <p className="text-xs text-muted-foreground leading-tight">{cat.label}</p>
                      <Link href={`/strategies?horizon=${cat.key}`}>
                        <Button variant="ghost" size="sm" className="text-xs px-2 h-6 mt-1" data-testid={`button-view-${cat.key.toLowerCase().replace(/\s+/g, '-')}`}>
                          View
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
          <div className="flex flex-col md:flex-row gap-6">
            <aside className="w-full md:w-56 flex-shrink-0 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-1">
                <Filter className="w-4 h-4" /> Filters
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Theme</label>
                  <Select value={themeFilter} onValueChange={setThemeFilter}>
                    <SelectTrigger className="h-8 text-xs" data-testid="filter-theme">
                      <SelectValue placeholder="All Themes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Themes</SelectItem>
                      {themeOptions.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Volatility</label>
                  <Select value={volatilityFilter} onValueChange={setVolatilityFilter}>
                    <SelectTrigger className="h-8 text-xs" data-testid="filter-volatility">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {volatilityOptions.map((v) => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Horizon</label>
                  <Select value={horizonFilter} onValueChange={setHorizonFilter}>
                    <SelectTrigger className="h-8 text-xs" data-testid="filter-horizon">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {horizonOptions.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="border-t pt-3 space-y-2">
                <Link href="/strategies">
                  <Button variant="ghost" size="sm" className="w-full justify-start text-xs gap-2" data-testid="link-live-calls-today">
                    <Zap className="w-3 h-3 text-primary" />
                    Live Calls Today
                  </Button>
                </Link>
                <Link href="/strategies">
                  <Button variant="ghost" size="sm" className="w-full justify-start text-xs gap-2" data-testid="link-all-strategies">
                    <BarChart3 className="w-3 h-3 text-primary" />
                    All Strategies
                  </Button>
                </Link>
              </div>

              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Training</p>
                <Button variant="ghost" size="sm" className="w-full justify-start text-xs gap-2" data-testid="link-master-stock-market">
                  <BookOpen className="w-3 h-3 text-primary" />
                  Master Stock Market
                </Button>
              </div>

              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Media</p>
                <div className="space-y-2">
                  {[
                    { name: "Business Connect", url: "https://businessconnectindia.in/alphamarket/" },
                    { name: "Startup Times", url: "https://startuptimes.net/building-the-bridge-between-investors-advisors-and-brokers-the-alphamarket-story" },
                  ].map((m) => (
                    <a key={m.name} href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                      <Card className="hover-elevate">
                        <CardContent className="p-2 flex items-center gap-2">
                          <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <span className="text-xs font-medium truncate">{m.name}</span>
                        </CardContent>
                      </Card>
                    </a>
                  ))}
                </div>
              </div>
            </aside>

            <div className="flex-1 space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <Input
                  placeholder="Search strategies or advisors..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-xs"
                  data-testid="input-search-home"
                />
                <p className="text-xs text-muted-foreground ml-auto">
                  {filtered.length} strategies found
                </p>
              </div>

              {isLoading ? (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <Card key={i}>
                      <CardContent className="p-5 space-y-3">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <Card>
                  <CardContent className="p-10 text-center space-y-2">
                    <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto" />
                    <p className="text-muted-foreground">No strategies match your filters</p>
                    <Button variant="outline" size="sm" onClick={() => { setThemeFilter(""); setVolatilityFilter(""); setHorizonFilter(""); setSearch(""); }}>
                      Clear Filters
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filtered.map((strategy) => (
                    <StrategyCard key={strategy.id} strategy={strategy} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
