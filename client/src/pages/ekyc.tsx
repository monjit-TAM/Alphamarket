import { useState, useEffect } from "react";
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
import { ShieldCheck, CheckCircle2, XCircle, Loader2, ArrowRight, CreditCard, Fingerprint } from "lucide-react";

type EkycStatus = {
  subscriptionId: string;
  ekycDone: boolean;
  aadhaar: { status: string; name: string; last4: string; verifiedAt: string } | null;
  pan: { status: string; panNumber: string; panName: string; verifiedAt: string } | null;
};

function EkycCompleteStep({ subscriptionId, aadhaarVerified, panVerified }: { subscriptionId: string; aadhaarVerified: boolean; panVerified: boolean }) {
  const [, navigate] = useLocation();
  const { data: rpCheck, isLoading: rpLoading } = useQuery<{ requiresRiskProfiling: boolean; completed: boolean }>({
    queryKey: ["/api/risk-profiling/check", subscriptionId],
    queryFn: async () => {
      const res = await fetch(`/api/risk-profiling/check?subscriptionId=${subscriptionId}`, { credentials: "include" });
      if (!res.ok) return { requiresRiskProfiling: false, completed: false };
      return res.json();
    },
    enabled: !!subscriptionId,
  });

  const needsRiskProfiling = rpCheck?.requiresRiskProfiling && !rpCheck?.completed;

  return (
    <Card>
      <CardContent className="py-10 text-center space-y-4">
        <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" data-testid="icon-ekyc-complete" />
        <div className="space-y-1">
          <h2 className="text-xl font-bold" data-testid="text-ekyc-complete">eKYC Verification Complete</h2>
          <p className="text-sm text-muted-foreground">
            Your identity has been verified successfully.
            {needsRiskProfiling
              ? " Please complete your Risk Profiling to access strategy recommendations."
              : " You can now access your subscribed strategy recommendations."}
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {aadhaarVerified && (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 no-default-hover-elevate no-default-active-elevate">
              <Fingerprint className="w-3 h-3 mr-1" /> Aadhaar Verified
            </Badge>
          )}
          {panVerified && (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 no-default-hover-elevate no-default-active-elevate">
              <CreditCard className="w-3 h-3 mr-1" /> PAN Verified
            </Badge>
          )}
        </div>

        {needsRiskProfiling && (
          <div className="p-4 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 space-y-2">
            <div className="flex items-center justify-center gap-2">
              <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Risk Profiling Required</p>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              You must complete your risk profile before you can access live recommendations. This ensures you receive investment advice suitable for your risk appetite.
            </p>
            <Button onClick={() => navigate(`/risk-profiling?subscriptionId=${subscriptionId}`)} className="mt-2" data-testid="button-ekyc-to-risk-profiling">
              <ShieldCheck className="w-4 h-4 mr-1" />
              Complete Risk Profiling Now
            </Button>
          </div>
        )}

        {rpLoading ? (
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
        ) : !needsRiskProfiling ? (
          <Button onClick={() => navigate("/investor-dashboard")} data-testid="button-ekyc-dashboard">
            Go to Dashboard
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => navigate("/investor-dashboard")} data-testid="button-ekyc-dashboard-later">
            I'll do it later
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function EkycPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const subscriptionId = params.get("subscriptionId");

  const [step, setStep] = useState<"aadhaar" | "pan" | "complete">("aadhaar");
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [referenceId, setReferenceId] = useState<number | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [aadhaarVerified, setAadhaarVerified] = useState(false);
  const [aadhaarResult, setAadhaarResult] = useState<{ name: string; dob: string; gender: string } | null>(null);

  const [panNumber, setPanNumber] = useState("");
  const [panName, setPanName] = useState("");
  const [panDob, setPanDob] = useState("");
  const [panVerified, setPanVerified] = useState(false);

  const { data: ekycStatus, isLoading: statusLoading } = useQuery<EkycStatus>({
    queryKey: ["/api/ekyc/status", subscriptionId],
    queryFn: async () => {
      const res = await fetch(`/api/ekyc/status?subscriptionId=${subscriptionId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch eKYC status");
      return res.json();
    },
    enabled: !!subscriptionId && !!user,
  });

  useEffect(() => {
    if (ekycStatus) {
      if (ekycStatus.aadhaar?.status === "verified") {
        setAadhaarVerified(true);
        if (ekycStatus.pan?.status === "verified") {
          setStep("complete");
          setPanVerified(true);
        } else {
          setStep("pan");
        }
      }
      if (ekycStatus.pan?.status === "verified") {
        setPanVerified(true);
      }
    }
  }, [ekycStatus]);

  const sendOtpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ekyc/aadhaar/otp", {
        subscriptionId,
        aadhaarNumber,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setReferenceId(data.referenceId);
      setOtpSent(true);
      toast({ title: "OTP Sent", description: "An OTP has been sent to your Aadhaar-registered mobile number." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to send OTP", variant: "destructive" });
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ekyc/aadhaar/verify", {
        subscriptionId,
        referenceId,
        otp,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setAadhaarVerified(true);
      setAadhaarResult({ name: data.name, dob: data.dob, gender: data.gender });
      setStep("pan");
      toast({ title: "Aadhaar Verified", description: `Verified successfully as ${data.name}` });
    },
    onError: (err: any) => {
      toast({ title: "Verification Failed", description: err.message || "Invalid OTP", variant: "destructive" });
    },
  });

  const verifyPanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ekyc/pan/verify", {
        subscriptionId,
        pan: panNumber,
        nameAsPan: panName,
        dateOfBirth: panDob,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.status === "valid") {
        setPanVerified(true);
        setStep("complete");
        toast({ title: "PAN Verified", description: "Your PAN card has been verified successfully." });
      } else {
        toast({ title: "PAN Invalid", description: "The PAN number could not be verified. Please check and try again.", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Verification Failed", description: err.message || "Failed to verify PAN", variant: "destructive" });
    },
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Please sign in to complete eKYC.</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!subscriptionId) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md w-full mx-4">
            <CardContent className="py-8 text-center space-y-4">
              <XCircle className="w-12 h-12 mx-auto text-destructive" />
              <p className="text-muted-foreground">Invalid eKYC link. Subscription ID is missing.</p>
              <Button onClick={() => navigate("/investor-dashboard")} data-testid="button-go-dashboard">
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  if (statusLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-xl mx-auto px-4 md:px-6 py-8 w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-ekyc-title">Complete eKYC Verification</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Verify your identity using Aadhaar and PAN to activate your subscription
          </p>
        </div>

        <div className="flex items-center justify-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
            aadhaarVerified ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
            step === "aadhaar" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`} data-testid="step-aadhaar">
            {aadhaarVerified ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Fingerprint className="w-3.5 h-3.5" />}
            Aadhaar
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
            panVerified ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
            step === "pan" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`} data-testid="step-pan">
            {panVerified ? <CheckCircle2 className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}
            PAN
          </div>
        </div>

        {step === "aadhaar" && !aadhaarVerified && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Fingerprint className="w-5 h-5" />
                Aadhaar Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!otpSent ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="aadhaar">Aadhaar Number</Label>
                    <Input
                      id="aadhaar"
                      placeholder="Enter 12-digit Aadhaar number"
                      value={aadhaarNumber}
                      onChange={(e) => setAadhaarNumber(e.target.value.replace(/\D/g, "").slice(0, 12))}
                      maxLength={12}
                      data-testid="input-aadhaar-number"
                    />
                    <p className="text-xs text-muted-foreground">An OTP will be sent to your Aadhaar-registered mobile number</p>
                  </div>
                  <Button
                    onClick={() => sendOtpMutation.mutate()}
                    disabled={aadhaarNumber.length !== 12 || sendOtpMutation.isPending}
                    className="w-full"
                    data-testid="button-send-otp"
                  >
                    {sendOtpMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    Send OTP
                  </Button>
                </>
              ) : (
                <>
                  <div className="p-3 rounded-md bg-muted/50 text-sm">
                    OTP sent to mobile number linked with Aadhaar ending ****{aadhaarNumber.slice(-4)}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="otp">Enter OTP</Label>
                    <Input
                      id="otp"
                      placeholder="Enter 6-digit OTP"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      maxLength={6}
                      data-testid="input-aadhaar-otp"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setOtpSent(false);
                        setOtp("");
                        setReferenceId(null);
                      }}
                      data-testid="button-resend-otp"
                    >
                      Resend OTP
                    </Button>
                    <Button
                      onClick={() => verifyOtpMutation.mutate()}
                      disabled={otp.length !== 6 || verifyOtpMutation.isPending}
                      className="flex-1"
                      data-testid="button-verify-otp"
                    >
                      {verifyOtpMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                      Verify OTP
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {step === "aadhaar" && aadhaarVerified && aadhaarResult && (
          <Card>
            <CardContent className="py-6 text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 mx-auto text-green-500" />
              <div>
                <p className="font-medium">{aadhaarResult.name}</p>
                <p className="text-sm text-muted-foreground">DOB: {aadhaarResult.dob} | Gender: {aadhaarResult.gender}</p>
              </div>
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 no-default-hover-elevate no-default-active-elevate">Aadhaar Verified</Badge>
            </CardContent>
          </Card>
        )}

        {step === "pan" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                PAN Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {aadhaarVerified && aadhaarResult && (
                <div className="p-3 rounded-md bg-green-50 dark:bg-green-900/10 text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  <span>Aadhaar verified as <strong>{aadhaarResult.name}</strong></span>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="pan">PAN Number</Label>
                <Input
                  id="pan"
                  placeholder="e.g. ABCDE1234F"
                  value={panNumber}
                  onChange={(e) => setPanNumber(e.target.value.toUpperCase().slice(0, 10))}
                  maxLength={10}
                  data-testid="input-pan-number"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pan-name">Name as per PAN (optional)</Label>
                <Input
                  id="pan-name"
                  placeholder="Full name as printed on PAN card"
                  value={panName}
                  onChange={(e) => setPanName(e.target.value)}
                  data-testid="input-pan-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pan-dob">Date of Birth (optional, DD/MM/YYYY)</Label>
                <Input
                  id="pan-dob"
                  placeholder="DD/MM/YYYY"
                  value={panDob}
                  onChange={(e) => setPanDob(e.target.value)}
                  data-testid="input-pan-dob"
                />
              </div>
              <Button
                onClick={() => verifyPanMutation.mutate()}
                disabled={!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber) || verifyPanMutation.isPending}
                className="w-full"
                data-testid="button-verify-pan"
              >
                {verifyPanMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Verify PAN
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "complete" && (
          <EkycCompleteStep
            subscriptionId={subscriptionId}
            aadhaarVerified={aadhaarVerified}
            panVerified={panVerified}
          />
        )}
      </div>
      <Footer />
    </div>
  );
}
