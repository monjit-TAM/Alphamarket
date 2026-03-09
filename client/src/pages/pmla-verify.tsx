import { useState } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ShieldCheck, CheckCircle2, XCircle, Loader2, Building2, CreditCard } from "lucide-react";

export default function PmlaVerifyPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const subscriptionId = params.get("subscriptionId") || "";

  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccount, setConfirmAccount] = useState("");
  const [ifsc, setIfsc] = useState("");

  const { data: pmlaStatus, isLoading } = useQuery<{ required: boolean; done: boolean; verification: any }>({
    queryKey: ["/api/pmla/status", subscriptionId],
    queryFn: async () => {
      const res = await fetch("/api/pmla/status?subscriptionId=" + subscriptionId, { credentials: "include" });
      if (!res.ok) return { required: false, done: false, verification: null };
      return res.json();
    },
    enabled: !!subscriptionId,
  });

  const { data: rpCheck } = useQuery<{ requiresRiskProfiling: boolean; completed: boolean }>({
    queryKey: ["/api/risk-profiling/check", subscriptionId],
    queryFn: async () => {
      const res = await fetch("/api/risk-profiling/check?subscriptionId=" + subscriptionId, { credentials: "include" });
      if (!res.ok) return { requiresRiskProfiling: false, completed: false };
      return res.json();
    },
    enabled: !!subscriptionId,
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pmla/bank/verify", {
        subscriptionId,
        accountNumber,
        ifsc: ifsc.toUpperCase(),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.pmlaDone) {
        toast({ title: "PMLA Verification Complete", description: "All checks passed successfully." });
      } else {
        toast({ title: "Verification Needs Review", description: "Some checks need attention. Your advisor will review.", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Verification Failed", description: err.message || "Please check your details and try again.", variant: "destructive" });
    },
  });

  if (!user) {
    navigate("/login");
    return null;
  }

  if (!subscriptionId) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-xl mx-auto px-4 py-10">
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-muted-foreground">Missing subscription ID. Please access this page from your dashboard.</p>
              <Button onClick={() => navigate("/investor-dashboard")} className="mt-4">Go to Dashboard</Button>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  const result = verifyMutation.data;
  const isDone = pmlaStatus?.done || result?.pmlaDone;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-xl mx-auto px-4 py-10 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">PMLA Verification</h1>
          <p className="text-sm text-muted-foreground">Prevention of Money Laundering Act compliance check</p>
        </div>

        {isDone ? (
          <Card>
            <CardContent className="py-10 text-center space-y-4">
              <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
              <div className="space-y-1">
                <h2 className="text-xl font-bold">PMLA Verification Complete</h2>
                <p className="text-sm text-muted-foreground">All compliance checks have passed successfully.</p>
              </div>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <Badge className="bg-green-100 text-green-700">Bank Verified</Badge>
                <Badge className="bg-green-100 text-green-700">Name Matched</Badge>
                <Badge className="bg-green-100 text-green-700">PAN-Aadhaar Linked</Badge>
              </div>
              {rpCheck?.requiresRiskProfiling && !rpCheck?.completed ? (
                <Button onClick={() => navigate("/risk-profiling?subscriptionId=" + subscriptionId)}>
                  <ShieldCheck className="w-4 h-4 mr-1" /> Complete Risk Profiling Next
                </Button>
              ) : (
                <Button onClick={() => navigate("/investor-dashboard")}>Go to Dashboard</Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Bank Account Verification
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Enter your bank account details for verification. The account holder name will be cross-verified with your Aadhaar and PAN records. No money will be debited.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-sm">Bank Account Number</Label>
                    <Input
                      type="text"
                      placeholder="Enter account number"
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                      maxLength={18}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm">Confirm Account Number</Label>
                    <Input
                      type="text"
                      placeholder="Re-enter account number"
                      value={confirmAccount}
                      onChange={(e) => setConfirmAccount(e.target.value.replace(/\D/g, ""))}
                      maxLength={18}
                    />
                    {confirmAccount && accountNumber !== confirmAccount && (
                      <p className="text-xs text-red-500">Account numbers do not match</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm">IFSC Code</Label>
                    <Input
                      type="text"
                      placeholder="e.g. SBIN0001234"
                      value={ifsc}
                      onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                      maxLength={11}
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => verifyMutation.mutate()}
                  disabled={
                    verifyMutation.isPending ||
                    !accountNumber ||
                    accountNumber !== confirmAccount ||
                    ifsc.length !== 11
                  }
                >
                  {verifyMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Verifying...</>
                  ) : (
                    <><ShieldCheck className="w-4 h-4 mr-1" /> Verify Bank Account</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {result && !result.pmlaDone && (
              <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-amber-600" />
                    <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">Verification Needs Review</p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bank Verification</span>
                      <Badge variant="secondary" className={result.bankVerified ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                        {result.bankVerified ? "Passed" : "Failed"}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Name Match</span>
                      <Badge variant="secondary" className={result.nameMatch?.result !== "MISMATCH" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                        {result.nameMatch?.result} ({result.nameMatch?.score}%)
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">PAN-Aadhaar Linked</span>
                      <Badge variant="secondary" className={result.panAadhaarLinked ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                        {result.panAadhaarLinked ? "Yes" : "No"}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-amber-700">Your advisor will review the verification. You may retry with correct details or contact your advisor.</p>
                  <Button variant="outline" size="sm" onClick={() => { setAccountNumber(""); setConfirmAccount(""); setIfsc(""); verifyMutation.reset(); }}>
                    Try Again
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
