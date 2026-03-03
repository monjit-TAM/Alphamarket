import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, ArrowLeft, Clock, IndianRupee } from "lucide-react";
import type { Strategy, Plan, User } from "@shared/schema";
import { Link } from "wouter";

export default function SubscribePage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const { data: strategy, isLoading: strategyLoading } = useQuery<Strategy & { advisor?: User }>({
    queryKey: ["/api/strategies", id],
  });

  const { data: plans, isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ["/api/strategies", id, "plans"],
    enabled: !!id,
  });

  const isLoading = strategyLoading || plansLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 space-y-6">
          <Skeleton className="h-8 w-60" />
          <div className="grid md:grid-cols-3 gap-4">
            <Skeleton className="h-60" />
            <Skeleton className="h-60" />
            <Skeleton className="h-60" />
          </div>
        </div>
      </div>
    );
  }

  if (!strategy) return null;

  const advisorName = strategy.advisor?.companyName || strategy.advisor?.username || "Advisor";
  const availablePlans = plans || [];

  const handleProceed = () => {
    if (!selectedPlanId) return;
    navigate(`/strategies/${id}/esign-agreement?plan=${selectedPlanId}`);
  };

  const formatDuration = (days: number | null | undefined) => {
    if (!days) return "Unlimited";
    if (days === 30) return "1 Month";
    if (days === 90) return "3 Months";
    if (days === 180) return "6 Months";
    if (days === 365) return "1 Year";
    return `${days} Days`;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-4xl mx-auto px-4 md:px-6 py-8 w-full space-y-6">
        <div>
          <Link href={`/strategies/${id}`}>
            <Button variant="ghost" size="sm" className="mb-3" data-testid="button-back-strategy">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Strategy
            </Button>
          </Link>
          <h1 className="text-2xl font-bold" data-testid="text-subscribe-title">Subscribe to {strategy.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            by {advisorName} &middot; Choose a pricing plan to continue
          </p>
        </div>

        {availablePlans.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground" data-testid="text-no-plans">
                No pricing plans are currently available for this strategy. Please check back later.
              </p>
              <Link href={`/strategies/${id}`}>
                <Button variant="outline" className="mt-4" data-testid="button-back-no-plans">
                  Back to Strategy
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {availablePlans.map((plan) => {
                const isSelected = selectedPlanId === plan.id;
                return (
                  <Card
                    key={plan.id}
                    className={`cursor-pointer transition-all ${isSelected ? "ring-2 ring-primary border-primary" : "hover-elevate"}`}
                    onClick={() => setSelectedPlanId(plan.id)}
                    data-testid={`card-plan-${plan.id}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">{plan.name}</CardTitle>
                        {isSelected && (
                          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                            <Check className="w-4 h-4 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                      <CardDescription className="text-xs">{plan.code}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-baseline gap-1">
                        <IndianRupee className="w-5 h-5" />
                        <span className="text-3xl font-bold" data-testid={`text-plan-amount-${plan.id}`}>
                          {Number(plan.amount).toLocaleString("en-IN")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" />
                        <span data-testid={`text-plan-duration-${plan.id}`}>{formatDuration(plan.durationDays)}</span>
                      </div>
                      {plan.durationDays && (
                        <p className="text-xs text-muted-foreground">
                          {"\u20B9"}{(Number(plan.amount) / (plan.durationDays / 30)).toFixed(0)}/month approx.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-4 pt-4 border-t">
              <div>
                {selectedPlanId && (
                  <p className="text-sm text-muted-foreground" data-testid="text-selected-plan">
                    Selected: <span className="font-medium text-foreground">{availablePlans.find(p => p.id === selectedPlanId)?.name}</span>
                  </p>
                )}
              </div>
              <Button
                onClick={handleProceed}
                disabled={!selectedPlanId}
                data-testid="button-proceed-payment"
              >
                Review & Sign Agreement
              </Button>
            </div>
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
