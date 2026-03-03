import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { CheckCircle2, XCircle, Loader2, ShieldCheck, Fingerprint } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

export default function PaymentCallbackPage() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const orderId = params.get("order_id");
  const verifyToken = params.get("vt");

  const [status, setStatus] = useState<"loading" | "success" | "failed">("loading");
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [riskProfilingRequired, setRiskProfilingRequired] = useState(false);
  const [riskProfilingCompleted, setRiskProfilingCompleted] = useState(false);

  useEffect(() => {
    if (!orderId) {
      setStatus("failed");
      return;
    }

    let attempts = 0;
    const maxAttempts = 8;
    let cancelled = false;

    const verify = async () => {
      if (cancelled) return;
      try {
        const res = await fetch("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ orderId, verifyToken }),
        });

        if (!res.ok) {
          console.error("Payment verify HTTP error:", res.status, await res.text());
          if (attempts < maxAttempts) {
            attempts++;
            setTimeout(verify, 3000);
          } else {
            setStatus("failed");
          }
          return;
        }

        const data = await res.json();

        if (data.success && data.orderStatus === "PAID") {
          setStatus("success");
          try {
            if (data.subscriptionId) {
              setSubscriptionId(data.subscriptionId);
              const rpCheck = await fetch(`/api/risk-profiling/check?subscriptionId=${data.subscriptionId}`, { credentials: "include" });
              if (rpCheck.ok) {
                const rpData = await rpCheck.json();
                setRiskProfilingRequired(rpData.requiresRiskProfiling);
                setRiskProfilingCompleted(rpData.completed);
              }
            }
            const paymentRes = await fetch(`/api/payments/history`, { credentials: "include" });
            if (paymentRes.ok) {
              const payments = await paymentRes.json();
              const match = payments.find((p: any) => p.orderId === orderId);
              if (match?.strategyId) setStrategyId(match.strategyId);
            }
          } catch {}
        } else if ((data.orderStatus === "ACTIVE" || data.orderStatus === "PENDING") && attempts < maxAttempts) {
          attempts++;
          setTimeout(verify, 3000);
        } else {
          setStatus("failed");
        }
      } catch (err) {
        console.error("Payment verify error:", err);
        if (attempts < maxAttempts) {
          attempts++;
          setTimeout(verify, 3000);
        } else {
          setStatus("failed");
        }
      }
    };

    const timer = setTimeout(verify, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-lg mx-auto px-4 md:px-6 py-16 w-full flex items-start justify-center">
        <Card className="w-full">
          <CardContent className="py-12 text-center space-y-6">
            {status === "loading" && (
              <>
                <Loader2 className="w-16 h-16 mx-auto animate-spin text-muted-foreground" data-testid="icon-payment-loading" />
                <div className="space-y-2">
                  <h2 className="text-xl font-bold" data-testid="text-payment-verifying">Verifying Payment...</h2>
                  <p className="text-sm text-muted-foreground">
                    Please wait while we confirm your payment. Do not close this page.
                  </p>
                </div>
              </>
            )}

            {status === "success" && (
              <>
                <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" data-testid="icon-payment-success" />
                <div className="space-y-2">
                  <h2 className="text-xl font-bold" data-testid="text-payment-success">Payment Successful!</h2>
                  <p className="text-sm text-muted-foreground">
                    Your subscription has been activated. Complete the remaining steps below to access live recommendations.
                  </p>
                </div>

                {subscriptionId && (
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Next Steps</p>

                    <div className="flex items-start gap-3 p-4 rounded-md border border-primary/30 bg-primary/5">
                      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">1</div>
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Fingerprint className="w-4 h-4 text-primary" />
                          <p className="text-sm font-medium">Complete eKYC Verification</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Verify your identity using Aadhaar and PAN as per SEBI requirements.
                        </p>
                        <Link href={`/ekyc?subscriptionId=${subscriptionId}`}>
                          <Button size="sm" data-testid="button-complete-ekyc">
                            <Fingerprint className="w-4 h-4 mr-1" />
                            Complete eKYC
                          </Button>
                        </Link>
                      </div>
                    </div>

                    {riskProfilingRequired && !riskProfilingCompleted && (
                      <div className="flex items-start gap-3 p-4 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30">
                        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-500 text-white font-bold text-xs shrink-0">2</div>
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Complete Risk Profiling</p>
                          </div>
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            Complete eKYC first, then risk profiling will be available. Your access to live recommendations will be restricted until risk profiling is done.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-center gap-3 flex-wrap pt-2">
                  <Link href="/investor-dashboard">
                    <Button variant="outline" size="sm" data-testid="button-go-dashboard">
                      Go to Dashboard
                    </Button>
                  </Link>
                </div>
              </>
            )}

            {status === "failed" && (
              <>
                <XCircle className="w-16 h-16 mx-auto text-destructive" data-testid="icon-payment-failed" />
                <div className="space-y-2">
                  <h2 className="text-xl font-bold" data-testid="text-payment-failed">Payment Failed</h2>
                  <p className="text-sm text-muted-foreground">
                    Your payment could not be completed. No amount has been charged. Please try again.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <Button onClick={() => navigate("/strategies")} data-testid="button-try-again">
                    Browse Strategies
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
