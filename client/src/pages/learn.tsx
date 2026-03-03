import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BookOpen, Calendar, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import type { Content } from "@shared/schema";

type ContentWithAdvisor = Content & {
  advisor: { id: string; username: string; companyName: string | null; logoUrl: string | null };
};

export default function LearnPage() {
  const { data: items, isLoading } = useQuery<ContentWithAdvisor[]>({
    queryKey: ["/api/content/public/Learn"],
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <div className="space-y-1 mb-8">
          <div className="flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-learn-title">Learn</h1>
          </div>
          <p className="text-muted-foreground">Research reports, stock analysis, and educational content published by our advisors</p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : !items || items.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              No learning content published yet. Check back soon for research and analysis from our advisors.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Link key={item.id} href={`/content/${item.id}`}>
                <Card className="hover-elevate cursor-pointer" data-testid={`content-card-${item.id}`}>
                  <CardContent className="p-5">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="flex-1 min-w-0 space-y-2">
                        <h3 className="font-semibold text-base" data-testid={`text-content-title-${item.id}`}>{item.title}</h3>
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
                          <Badge variant="secondary" className="text-xs">Research</Badge>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-primary font-medium pt-1">
                          Read More <ArrowRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
