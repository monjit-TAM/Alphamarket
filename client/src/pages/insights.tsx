import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Lightbulb, Calendar, ArrowRight, TrendingUp, BookOpen } from "lucide-react";
import { Link } from "wouter";
import type { Content } from "@shared/schema";

type ContentWithAdvisor = Content & {
  advisor: { id: string; username: string; companyName: string | null; logoUrl: string | null };
};

type FilterTab = "all" | "MarketUpdate" | "Learn";

export default function InsightsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const { data: marketItems, isLoading: loadingMarket } = useQuery<ContentWithAdvisor[]>({
    queryKey: ["/api/content/public/MarketUpdate"],
  });

  const { data: learnItems, isLoading: loadingLearn } = useQuery<ContentWithAdvisor[]>({
    queryKey: ["/api/content/public/Learn"],
  });

  const isLoading = loadingMarket || loadingLearn;

  // Merge and sort by date (newest first)
  const allItems = [...(marketItems || []), ...(learnItems || [])].sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return db - da;
  });

  const filteredItems = activeTab === "all"
    ? allItems
    : allItems.filter((item) => item.type === activeTab);

  const marketCount = (marketItems || []).length;
  const learnCount = (learnItems || []).length;

  const tabs: { key: FilterTab; label: string; count: number; icon: typeof Lightbulb }[] = [
    { key: "all", label: "All", count: allItems.length, icon: Lightbulb },
    { key: "MarketUpdate", label: "Market Updates", count: marketCount, icon: TrendingUp },
    { key: "Learn", label: "Research & Learning", count: learnCount, icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        {/* Header */}
        <div className="space-y-1 mb-6">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-insights-title">Insights</h1>
          </div>
          <p className="text-muted-foreground">
            Market updates, research reports, stock analysis, and educational content from our advisors
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`
                inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors
                ${activeTab === tab.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }
              `}
              data-testid={`tab-${tab.key}`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
              {!isLoading && (
                <span className={`text-xs ml-0.5 ${activeTab === tab.key ? "opacity-80" : "opacity-60"}`}>
                  ({tab.count})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content list */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              {activeTab === "all"
                ? "No insights published yet. Check back soon for research and updates from our advisors."
                : activeTab === "MarketUpdate"
                ? "No market updates published yet."
                : "No research or learning content published yet."
              }
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => {
              const isMarketUpdate = item.type === "MarketUpdate";
              return (
                <Link key={item.id} href={`/content/${item.id}`}>
                  <Card className="hover-elevate cursor-pointer" data-testid={`content-card-${item.id}`}>
                    <CardContent className="p-5">
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1 min-w-0 space-y-2">
                          <h3 className="font-semibold text-base" data-testid={`text-content-title-${item.id}`}>
                            {item.title}
                          </h3>
                          {item.body && (
                            <p className="text-sm text-muted-foreground line-clamp-2">{item.body}</p>
                          )}
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <Avatar className="w-5 h-5">
                                <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                                  {(item.advisor.companyName || item.advisor.username).slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs font-medium" data-testid={`text-advisor-name-${item.id}`}>
                                {item.advisor.companyName || item.advisor.username}
                              </span>
                            </div>
                            {item.createdAt && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="w-3 h-3" />
                                {new Date(item.createdAt).toLocaleDateString("en-IN", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </div>
                            )}
                            <Badge
                              variant="secondary"
                              className={`text-xs ${isMarketUpdate ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}
                            >
                              {isMarketUpdate ? (
                                <><TrendingUp className="w-3 h-3 mr-1" />Market Update</>
                              ) : (
                                <><BookOpen className="w-3 h-3 mr-1" />Research</>
                              )}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1 text-sm text-primary font-medium pt-1">
                            Read More <ArrowRight className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
