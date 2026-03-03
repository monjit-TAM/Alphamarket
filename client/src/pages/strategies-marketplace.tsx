import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { StrategyCard } from "@/components/strategy-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, BarChart3, Zap, BookOpen } from "lucide-react";
import { useState } from "react";
import { useSearch } from "wouter";
import { useAuth } from "@/lib/auth";
import type { Strategy, User } from "@shared/schema";

type StrategyWithMeta = Strategy & { advisor?: Partial<User>; liveCalls?: number };

const themeOptions = ["Equity", "F&O", "Growth", "Value", "SwingTrade", "Momentum", "Basket", "Commodity", "Dividend Stocks", "Shorting", "ETF"];
const typeOptions = ["Equity", "Basket", "Future", "Commodity", "CommodityFuture", "Option"];
const volatilityOptions = ["Low", "Medium", "High"];
const horizonOptions = ["Intraday", "Swing", "Positional", "Long Term"];
const managementStyleOptions = ["Active", "Passive", "Quantitative", "Discretionary"];
const marketCapOptions = ["Large Cap", "Mid Cap", "Small Cap", "Multi Cap"];

export default function StrategiesMarketplace() {
  const searchParams = useSearch();
  const urlParams = new URLSearchParams(searchParams);
  const initialHorizon = urlParams.get("horizon") || "";

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [themeFilter, setThemeFilter] = useState("");
  const [volatilityFilter, setVolatilityFilter] = useState("");
  const [horizonFilter, setHorizonFilter] = useState(initialHorizon);
  const [managementStyleFilter, setManagementStyleFilter] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  const { user } = useAuth();

  const { data: strategies, isLoading } = useQuery<StrategyWithMeta[]>({
    queryKey: ["/api/strategies/public"],
  });

  const { data: watchlistIds } = useQuery<{ strategyIds: string[]; advisorIds: string[] }>({
    queryKey: ["/api/investor/watchlist/ids"],
    enabled: !!user,
  });

  const filtered = (strategies || []).filter((s) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !(s.advisor?.companyName || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter && typeFilter !== "all" && s.type !== typeFilter) return false;
    if (themeFilter && themeFilter !== "all" && !(s.theme || []).some((t) => t.toLowerCase().includes(themeFilter.toLowerCase()))) return false;
    if (volatilityFilter && volatilityFilter !== "all" && s.volatility?.toLowerCase() !== volatilityFilter.toLowerCase()) return false;
    if (horizonFilter && horizonFilter !== "all" && !(s.horizon || "").toLowerCase().includes(horizonFilter.toLowerCase())) return false;
    if (managementStyleFilter && managementStyleFilter !== "all" && s.managementStyle?.toLowerCase() !== managementStyleFilter.toLowerCase()) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "newest") return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    if (sortBy === "liveCalls") return (b.liveCalls || 0) - (a.liveCalls || 0);
    return 0;
  });

  const clearFilters = () => {
    setSearch(""); setTypeFilter(""); setThemeFilter(""); setVolatilityFilter(""); setHorizonFilter(""); setManagementStyleFilter("");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-7xl mx-auto px-4 md:px-6 py-6 w-full">
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
                <label className="text-xs text-muted-foreground mb-1 block">Management Style</label>
                <Select value={managementStyleFilter} onValueChange={setManagementStyleFilter}>
                  <SelectTrigger className="h-8 text-xs" data-testid="filter-management-style">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {managementStyleOptions.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
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

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Strategy Type</label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-8 text-xs" data-testid="filter-type">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {typeOptions.map((t) => (
                      <SelectItem key={t} value={t}>{t === "CommodityFuture" ? "Commodity Future" : t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Market Cap</label>
                <Select>
                  <SelectTrigger className="h-8 text-xs" data-testid="filter-market-cap">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {marketCapOptions.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(themeFilter || volatilityFilter || horizonFilter || typeFilter || managementStyleFilter) && (
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={clearFilters} data-testid="button-clear-filters">
                Clear All Filters
              </Button>
            )}

            <div className="border-t pt-3 space-y-2">
              <Button variant="ghost" size="sm" className="w-full justify-start text-xs gap-2" data-testid="link-live-calls">
                <Zap className="w-3 h-3 text-primary" />
                Live Calls Today
              </Button>
              <Button variant="ghost" size="sm" className="w-full justify-start text-xs gap-2" data-testid="link-all-strategies-sidebar">
                <BarChart3 className="w-3 h-3 text-primary" />
                All Strategies
              </Button>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Training</p>
              <Button variant="ghost" size="sm" className="w-full justify-start text-xs gap-2">
                <BookOpen className="w-3 h-3 text-primary" />
                Master Stock Market
              </Button>
            </div>
          </aside>

          <div className="flex-1 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="relative flex-1 w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search strategies or advisors..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-strategies"
                />
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-36" data-testid="select-sort">
                    <SelectValue placeholder="Sort By" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="liveCalls">Most Active</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground whitespace-nowrap">{sorted.length} results</p>
              </div>
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
            ) : sorted.length === 0 ? (
              <Card>
                <CardContent className="p-10 text-center space-y-2">
                  <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto" />
                  <p className="text-muted-foreground">No strategies match your filters</p>
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear Filters
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sorted.map((strategy) => (
                  <StrategyCard key={strategy.id} strategy={strategy} watchlistedIds={watchlistIds?.strategyIds} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
