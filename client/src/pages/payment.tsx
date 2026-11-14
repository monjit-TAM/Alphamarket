import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, IndianRupee, ShieldCheck, CreditCard, Loader2 } from "lucide-react";
import type { Strategy, Plan, User } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useState, useEffect, useCallback } from "react";

declare global {
  interface Window {
    Cashfree: any;
    Razorpay: any;
  }
}

function loadScript(src: string, globalName: "Cashfree" | "Razorpay"): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window[globalName]) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${globalName} checkout`));
    document.head.appendChild(script);
  });
}

const loadCashfreeScript = () => loadScript("https://sdk.cashfree.com/js/v3/cashfree.js", "Cashfree");
const loadRazorpayScript = () => loadScript("https://checkout.razorpay.com/v1/checkout.js", "Razorpay");

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const planId = params.get("plan");
  const { user } = useAuth();
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);

  const { data: strategy, isLoading: strategyLoading } = useQuery<Strategy & { advisor?: User }>({
    queryKey: ["/api/strategies", id],
  });

  const { data: plans, isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ["/api/strategies", id, "plans"],
    enabled: !!id,
  });

  const isLoading = strategyLoading || plansLoading;

  const formatDuration = useCallback((days: number | null | undefined) => {
    if (!days) return "Unlimited";
    if (days === 30) return "1 Month";
    if (days === 90) return "3 Months";
    if (days === 180) return "6 Months";
    if (days === 365) return "1 Year";
    return `${days} Days`;
  }, []);

  const handlePayment = async () => {
    if (!user) {
      toast({ title: "Please sign in to subscribe", variant: "destructive" });
      navigate("/login");
      return;
    }
    setProcessing(true);
    try {
      const res = await apiRequest("POST", "/api/payments/create-order", {
        strategyId: id,
        planId,
      });
      const data = await res.json();

      if (data.gateway === "razorpay" && data.razorpay) {
        await loadRazorpayScript();
        const callbackUrl = `/payment-callback?order_id=${encodeURIComponent(data.orderId)}&vt=${encodeURIComponent(data.verifyToken)}`;
        const rz = new window.Razorpay({
          key: data.razorpay.keyId,
          order_id: data.razorpay.orderId,
          amount: data.razorpay.amount,
          currency: data.razorpay.currency,
          name: data.razorpay.name,
          description: data.razorpay.description,
          prefill: data.razorpay.prefill,
          theme: { color: "#e14a14" },
          // Server re-checks the order with Razorpay before activating anything
          handler: () => navigate(callbackUrl),
          modal: {
            ondismiss: () => {
              setProcessing(false);
              toast({ title: "Payment cancelled", description: "You can try again whenever you're ready." });
            },
          },
        });
        rz.on("payment.failed", (resp: any) => {
          toast({
            title: "Payment failed",
            description: resp?.error?.description || "Please try again",
            variant: "destructive",
          });
        });
        rz.open();
        return;
      }

      if (!data.paymentSessionId) {
        throw new Error("Failed to create payment order");
      }

      await loadCashfreeScript();
      const cashfree = window.Cashfree({ mode: "production" });

      const result = await cashfree.checkout({
        paymentSessionId: data.paymentSessionId,
        redirectTarget: "_self",
      });

      if (result?.error) {
        toast({
          title: "Payment was cancelled or failed",
          description: result.error.message || "Please try again",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Payment failed",
        description: err.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-8 space-y-6">
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (!strategy || !planId) return null;

  const selectedPlan = (plans || []).find(p => p.id === planId);
  if (!selectedPlan) return null;

  const advisorName = strategy.advisor?.companyName || strategy.advisor?.username || "Advisor";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-2xl mx-auto px-4 md:px-6 py-8 w-full space-y-6">
        <div>
          <Link href={`/strategies/${id}/subscribe`}>
            <Button variant="ghost" size="sm" className="mb-3" data-testid="button-back-plans">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Plans
            </Button>
          </Link>
          <h1 className="text-2xl font-bold" data-testid="text-payment-title">Complete Payment</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review your order and proceed with payment
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Strategy</span>
                <span className="text-sm font-medium" data-testid="text-order-strategy">{strategy.name}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Advisor</span>
                <span className="text-sm font-medium" data-testid="text-order-advisor">{advisorName}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Plan</span>
                <span className="text-sm font-medium" data-testid="text-order-plan">{selectedPlan.name}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Duration</span>
                <span className="text-sm font-medium" data-testid="text-order-duration">{formatDuration(selectedPlan.durationDays)}</span>
              </div>
            </div>

            <div className="border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Total Amount</span>
                <span className="text-xl font-bold flex items-center gap-0.5" data-testid="text-order-total">
                  <IndianRupee className="w-4 h-4" />
                  {Number(selectedPlan.amount).toLocaleString("en-IN")}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Payment Gateway
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-6 space-y-3">
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Secure payment via our payment partner</span>
              </div>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                You'll complete the payment on a secure checkout. All major UPI apps, cards, net banking, and wallets are supported.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link href={`/strategies/${id}/subscribe`}>
            <Button variant="outline" data-testid="button-cancel-payment">
              Cancel
            </Button>
          </Link>
          <Button
            onClick={handlePayment}
            disabled={processing}
            data-testid="button-confirm-payment"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              `Pay \u20B9${Number(selectedPlan.amount).toLocaleString("en-IN")} & Subscribe`
            )}
          </Button>
        </div>
      </div>
      <Footer />
    </div>
  );
}
