import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Link } from "wouter";
import { Search, Filter, CheckCircle, Shield, Heart, MessageCircle } from "lucide-react";
import { useState } from "react";
import type { User } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function AdvisorsListing() {
  const [search, setSearch] = useState("");
  const [themeFilter, setThemeFilter] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const { user } = useAuth();

  const { data: advisors, isLoading } = useQuery<(User & { liveStrategies?: number })[]>({
    queryKey: ["/api/advisors"],
  });

  const { data: watchlistIds } = useQuery<{ strategyIds: string[]; advisorIds: string[] }>({
    queryKey: ["/api/investor/watchlist/ids"],
    enabled: !!user,
  });

  const filtered = (advisors || []).filter((a) => {
    if (search && !(a.companyName || a.username).toLowerCase().includes(search.toLowerCase())) return false;
    if (themeFilter && themeFilter !== "all" && !(a.themes || []).some((t) => t.toLowerCase().includes(themeFilter.toLowerCase()))) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-7xl mx-auto px-4 md:px-6 py-6 w-full">
        <div className="flex flex-col md:flex-row gap-6">
          <aside className="w-full md:w-56 space-y-4 flex-shrink-0">
            <h3 className="font-semibold text-sm flex items-center gap-1">
              <Filter className="w-4 h-4" /> Filters
            </h3>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Theme</label>
              <Select value={themeFilter} onValueChange={setThemeFilter}>
                <SelectTrigger className="h-8 text-xs" data-testid="filter-theme-advisors">
                  <SelectValue placeholder="All Themes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Themes</SelectItem>
                  {["Equity", "F&O", "Growth", "Value", "SwingTrade", "Basket", "Commodity", "Shorting"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </aside>

          <div className="flex-1 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="relative flex-1 w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search advisors..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-advisors"
                />
              </div>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-36" data-testid="select-sort-advisors">
                  <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="popular">Popular</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="grid md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-12 w-12 rounded-full" />
                        <Skeleton className="h-5 w-40" />
                      </div>
                      <Skeleton className="h-20 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <Card>
                <CardContent className="p-10 text-center space-y-2">
                  <Shield className="w-10 h-10 text-muted-foreground mx-auto" />
                  <p className="text-muted-foreground">No advisors found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {filtered.map((advisor) => (
                  <AdvisorCard key={advisor.id} advisor={advisor} watchlistedIds={watchlistIds?.advisorIds} />
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

function AdvisorCard({ advisor, watchlistedIds }: { advisor: User & { liveStrategies?: number }; watchlistedIds?: string[] }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isWatchlisted = watchlistedIds?.includes(advisor.id) ?? false;

  const toggleMutation = useMutation({
    mutationFn: async () => {
      if (isWatchlisted) {
        await apiRequest("DELETE", "/api/investor/watchlist", { itemType: "advisor", itemId: advisor.id });
      } else {
        await apiRequest("POST", "/api/investor/watchlist", { itemType: "advisor", itemId: advisor.id });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/watchlist/ids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investor/watchlist"] });
      toast({ title: isWatchlisted ? "Removed from watchlist" : "Added to watchlist" });
    },
  });

  return (
    <Card className="hover-elevate" data-testid={`card-advisor-${advisor.id}`}>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12">
              {advisor.logoUrl && <AvatarImage src={advisor.logoUrl} />}
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                {(advisor.companyName || advisor.username).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="font-semibold text-sm">{advisor.companyName || advisor.username}</h3>
              <p className="text-xs text-muted-foreground font-medium">Registration Number</p>
              <p className="text-xs text-muted-foreground">{advisor.sebiRegNumber || "N/A"}</p>
            </div>
          </div>
          {user && (
            <Button
              size="icon"
              variant="ghost"
              className={isWatchlisted ? "text-red-500" : "text-muted-foreground"}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleMutation.mutate(); }}
              disabled={toggleMutation.isPending}
              data-testid={`button-watchlist-advisor-${advisor.id}`}
            >
              <Heart className={`w-4 h-4 ${isWatchlisted ? "fill-current" : ""}`} />
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">Theme</span>
            <p className="font-medium">{advisor.themes?.join(" | ") || "Equity"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Active Since</span>
            <p className="font-medium">
              {advisor.activeSince
                ? new Date(advisor.activeSince).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                : "N/A"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Registered</span>
            <p className="font-medium flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-accent" /> Yes
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Live Strategies</span>
            <p className="font-medium">{advisor.liveStrategies || 0}</p>
          </div>
        </div>

        {advisor.overview && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Advisor Overview</p>
            <p className="text-xs text-muted-foreground/80 line-clamp-3 leading-relaxed">{advisor.overview}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Link href={`/advisors/${advisor.id}`} className="flex-1">
            <Button className="w-full" data-testid={`button-view-advisor-${advisor.id}`}>
              View Details
            </Button>
          </Link>
          <Link href={`/advisors/${advisor.id}#ask-question`}>
            <Button variant="outline" size="icon" data-testid={`button-ask-advisor-${advisor.id}`}>
              <MessageCircle className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
