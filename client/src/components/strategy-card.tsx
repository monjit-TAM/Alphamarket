import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { BarChart3, Calendar, Clock, Zap, Heart, Package } from "lucide-react";
import type { Strategy, User } from "@shared/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type StrategyWithMeta = Strategy & {
  advisor?: Partial<User>;
  liveCalls?: number;
};

function getRiskColor(risk: string | null | undefined) {
  if (!risk) return "text-muted-foreground bg-muted";
  if (risk.toLowerCase().includes("high")) return "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";
  if (risk.toLowerCase().includes("low")) return "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800";
  return "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800";
}

export function StrategyCard({ strategy, watchlistedIds }: { strategy: StrategyWithMeta; watchlistedIds?: string[] }) {
  const advisorName = strategy.advisor?.companyName || strategy.advisor?.username || "Advisor";
  const truncatedAdvisorName = advisorName.length > 20 ? advisorName.slice(0, 18) + "..." : advisorName;
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isWatchlisted = watchlistedIds?.includes(strategy.id) ?? false;

  const toggleMutation = useMutation({
    mutationFn: async () => {
      if (isWatchlisted) {
        await apiRequest("DELETE", "/api/investor/watchlist", { itemType: "strategy", itemId: strategy.id });
      } else {
        await apiRequest("POST", "/api/investor/watchlist", { itemType: "strategy", itemId: strategy.id });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/watchlist/ids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investor/watchlist"] });
      toast({ title: isWatchlisted ? "Removed from watchlist" : "Added to watchlist" });
    },
  });

  const isBasket = strategy.type === "Basket";

  return (
    <Card
      className={`hover-elevate overflow-visible ${isBasket ? "border-indigo-200 dark:border-indigo-800 ring-1 ring-indigo-100 dark:ring-indigo-900/50" : ""}`}
      data-testid={`card-strategy-${strategy.id}`}
    >
      {isBasket && (
        <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-medium px-3 py-1.5 flex items-center gap-1.5 rounded-t-lg" data-testid={`badge-basket-${strategy.id}`}>
          <Package className="w-3 h-3" />
          Basket Strategy
        </div>
      )}
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm leading-tight line-clamp-2" data-testid={`text-strategy-name-${strategy.id}`}>
              {strategy.name}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              by {truncatedAdvisorName}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {user && (
              <Button
                size="icon"
                variant="ghost"
                className={isWatchlisted ? "text-red-500" : "text-muted-foreground"}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleMutation.mutate(); }}
                disabled={toggleMutation.isPending}
                data-testid={`button-watchlist-strategy-${strategy.id}`}
              >
                <Heart className={`w-4 h-4 ${isWatchlisted ? "fill-current" : ""}`} />
              </Button>
            )}
            <Badge variant="outline" className="text-xs">
              Performance
            </Badge>
          </div>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          <Badge variant="secondary" className={`text-xs ${getRiskColor(strategy.riskLevel)}`}>
            {strategy.riskLevel || "Medium Risk"}
          </Badge>
          {isBasket && (
            <Badge variant="secondary" className="text-xs bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800">
              Multi-Stock
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">Strategy Type</span>
            <p className="font-medium">{isBasket ? "Basket" : strategy.type === "CommodityFuture" ? "Commodity Future" : strategy.type}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Active Since</span>
            <p className="font-medium">
              {strategy.createdAt
                ? new Date(strategy.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                : "N/A"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Horizon</span>
            <p className="font-medium">{strategy.horizon || "N/A"}</p>
          </div>
          <div>
            <span className="text-muted-foreground flex items-center gap-1">
              <Zap className="w-3 h-3" /> Live Calls
            </span>
            <p className="font-medium">{strategy.liveCalls ?? 0}</p>
          </div>
        </div>

        {strategy.minimumInvestment && Number(strategy.minimumInvestment) > 0 && (
          <div className="text-xs">
            <span className="text-muted-foreground">Minimum Investment</span>
            <p className="font-medium">{"\u20B9"}{Number(strategy.minimumInvestment).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground">Strategy Description</p>
          <p className="text-xs text-muted-foreground/80 line-clamp-3 mt-0.5 leading-relaxed">
            {strategy.description}
          </p>
        </div>

        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Pricing Plans</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/strategies/${strategy.id}/subscribe`}>
              <Button size="sm" data-testid={`button-subscribe-${strategy.id}`}>
                Subscribe
              </Button>
            </Link>
            <Link href={`/strategies/${strategy.id}`}>
              <Button variant="outline" size="sm" data-testid={`button-view-more-${strategy.id}`}>
                View More
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
