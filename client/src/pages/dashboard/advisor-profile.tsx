import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, ShieldCheck, Banknote, IndianRupee, ArrowUpRight, Clock, CheckCircle2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type { Score } from "@shared/schema";

export default function AdvisorProfile() {
  const { user, refetch } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const [form, setForm] = useState({
    companyName: "",
    overview: "",
    email: "",
    phone: "",
    sebiRegNumber: "",
    themes: [] as string[],
  });

  const [scoreForm, setScoreForm] = useState({
    beginningOfMonth: "",
    receivedDuring: "",
    resolvedDuring: "",
    pendingAtEnd: "",
    pendencyReasons: "",
  });

  const [bankForm, setBankForm] = useState({
    bankName: "", accountNumber: "", confirmAccountNumber: "", ifscCode: "",
    accountHolderName: "", accountType: "savings", micrCode: "", branchAddress: "", upiId: "",
  });
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  const { data: bankDetails } = useQuery({ queryKey: ["/api/advisor/bank-details"], enabled: activeTab === "bank" });
  const { data: revenue } = useQuery<any>({ queryKey: ["/api/advisor/revenue"], enabled: activeTab === "bank" });
  const { data: payments } = useQuery<any[]>({ queryKey: ["/api/advisor/payments"], enabled: activeTab === "bank" });

  useEffect(() => {
    if (bankDetails && (bankDetails as any).bank_name) {
      const b = bankDetails as any;
      setBankForm({
        bankName: b.bank_name || "", accountNumber: b.account_number || "",
        confirmAccountNumber: b.account_number || "", ifscCode: b.ifsc_code || "",
        accountHolderName: b.account_holder_name || "", accountType: b.account_type || "savings",
        micrCode: b.micr_code || "", branchAddress: b.branch_address || "", upiId: b.upi_id || "",
      });
    }
  }, [bankDetails]);

  const saveBankMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", "/api/advisor/bank-details", data);
      return res.json();
    },
    onSuccess: () => { toast({ title: "Bank details saved" }); queryClient.invalidateQueries({ queryKey: ["/api/advisor/bank-details"] }); },
  });

  const requestPaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/advisor/request-payment", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payment request submitted" });
      setPaymentAmount(""); setPaymentNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/revenue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/payments"] });
    },
  });

  useEffect(() => {
    if (user) {
      setForm({
        companyName: user.companyName || "",
        overview: user.overview || "",
        email: user.email || "",
        phone: user.phone || "",
        sebiRegNumber: user.sebiRegNumber || "",
        themes: user.themes || [],
      });
    }
  }, [user]);

  const { data: scores } = useQuery<Score[]>({
    queryKey: ["/api/advisor/scores"],
  });

  const { data: riskSettings } = useQuery<{ requireRiskProfiling: boolean }>({
    queryKey: ["/api/advisor/settings/risk-profiling"],
  });

  const riskToggleMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const res = await apiRequest("PATCH", "/api/advisor/settings/risk-profiling", { requireRiskProfiling: value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/settings/risk-profiling"] });
      toast({ title: "Risk profiling setting updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const { data: pmlaSettings } = useQuery<{ requirePmla: boolean }>({
    queryKey: ["/api/advisor/pmla-setting"],
  });

  const pmlaToggleMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const res = await apiRequest("PATCH", "/api/advisor/pmla-setting", { requirePmla: value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/pmla-setting"] });
      toast({ title: "PMLA verification setting updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update PMLA setting", variant: "destructive" });
    },
  });


  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", "/api/advisor/profile", data);
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Profile updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const scoreMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/advisor/scores", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/scores"] });
      toast({ title: "Scores saved" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleThemeAdd = (theme: string) => {
    if (theme && !form.themes.includes(theme)) {
      setForm({ ...form, themes: [...form.themes, theme] });
    }
  };

  const handleThemeRemove = (theme: string) => {
    setForm({ ...form, themes: form.themes.filter((t) => t !== theme) });
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
          <TabsTrigger value="scores" data-testid="tab-scores">Scores</TabsTrigger>
          <TabsTrigger value="bank" data-testid="tab-bank">Bank & Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company Details</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  updateMutation.mutate(form);
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label>Company Name</Label>
                  <Input
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                    data-testid="input-company-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Overview</Label>
                  <Textarea
                    value={form.overview}
                    onChange={(e) => setForm({ ...form, overview: e.target.value })}
                    rows={5}
                    data-testid="input-overview"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Select Theme</Label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {form.themes.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/20 text-xs"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => handleThemeRemove(t)}
                          className="ml-0.5 text-muted-foreground"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {["Equity", "F&O", "Commodity", "Growth", "Value", "Momentum"].map((t) => (
                      <Button
                        key={t}
                        type="button"
                        variant={form.themes.includes(t) ? "default" : "outline"}
                        size="sm"
                        onClick={() =>
                          form.themes.includes(t) ? handleThemeRemove(t) : handleThemeAdd(t)
                        }
                        data-testid={`button-theme-${t.toLowerCase()}`}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Email ID</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    data-testid="input-profile-email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Mobile Number</Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    data-testid="input-profile-phone"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>SEBI Registration Number</Label>
                  <Input
                    value={form.sebiRegNumber}
                    onChange={(e) => setForm({ ...form, sebiRegNumber: e.target.value })}
                    data-testid="input-sebi-reg"
                  />
                </div>
                <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-profile">
                  {updateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-1" />
                  )}
                  Save Profile
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Investor Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between gap-4 p-4 rounded-md border">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Risk Profiling for Subscribers</Label>
                  <p className="text-xs text-muted-foreground">
                    When enabled, investors will be asked to complete a risk profiling questionnaire after subscribing to your strategies. Their risk profile will be visible in your Customers Acquired section.
                  </p>
                </div>
                <Switch
                  checked={riskSettings?.requireRiskProfiling || false}
                  onCheckedChange={(checked) => riskToggleMutation.mutate(checked)}
                  disabled={riskToggleMutation.isPending}
                  data-testid="switch-risk-profiling"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scores">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Scores</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  scoreMutation.mutate({
                    advisorId: user?.id,
                    beginningOfMonth: parseInt(scoreForm.beginningOfMonth) || 0,
                    receivedDuring: parseInt(scoreForm.receivedDuring) || 0,
                    resolvedDuring: parseInt(scoreForm.resolvedDuring) || 0,
                    pendingAtEnd: parseInt(scoreForm.pendingAtEnd) || 0,
                    pendencyReasons: scoreForm.pendencyReasons,
                  });
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>At beginning of the month</Label>
                    <Input
                      type="number"
                      value={scoreForm.beginningOfMonth}
                      onChange={(e) => setScoreForm({ ...scoreForm, beginningOfMonth: e.target.value })}
                      data-testid="input-score-beginning"
                    />
                  </div>

              <div className="flex items-center justify-between gap-4 p-4 rounded-md border">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">PMLA Verification for Subscribers</Label>
                  <p className="text-xs text-muted-foreground">
                    When enabled, investors must complete PMLA checks (bank account verification, name matching, PAN-Aadhaar linkage) after eKYC before accessing your recommendations.
                  </p>
                </div>
                <Switch
                  checked={pmlaSettings?.requirePmla || false}
                  onCheckedChange={(checked) => pmlaToggleMutation.mutate(checked)}
                  disabled={pmlaToggleMutation.isPending}
                  data-testid="switch-pmla"
                />
              </div>
                  <div className="space-y-1.5">
                    <Label>Received during of the month</Label>
                    <Input
                      type="number"
                      value={scoreForm.receivedDuring}
                      onChange={(e) => setScoreForm({ ...scoreForm, receivedDuring: e.target.value })}
                      data-testid="input-score-received"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Resolved during of the month</Label>
                    <Input
                      type="number"
                      value={scoreForm.resolvedDuring}
                      onChange={(e) => setScoreForm({ ...scoreForm, resolvedDuring: e.target.value })}
                      data-testid="input-score-resolved"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Pending at the end of the month</Label>
                    <Input
                      type="number"
                      value={scoreForm.pendingAtEnd}
                      onChange={(e) => setScoreForm({ ...scoreForm, pendingAtEnd: e.target.value })}
                      data-testid="input-score-pending"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Reasons for pendency</Label>
                    <Input
                      value={scoreForm.pendencyReasons}
                      onChange={(e) => setScoreForm({ ...scoreForm, pendencyReasons: e.target.value })}
                      data-testid="input-score-reasons"
                    />
                  </div>
                </div>
                <Button type="submit" disabled={scoreMutation.isPending} data-testid="button-save-scores">
                  {scoreMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                  Save
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="bank">
          <div className="space-y-6">
            {/* Bank Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Banknote className="w-4 h-4" /> Bank Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Account Holder Name</Label>
                    <Input value={bankForm.accountHolderName} onChange={(e) => setBankForm({...bankForm, accountHolderName: e.target.value})} placeholder="Full name as per bank" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Bank Name</Label>
                    <Input value={bankForm.bankName} onChange={(e) => setBankForm({...bankForm, bankName: e.target.value})} placeholder="e.g. State Bank of India" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Account Type</Label>
                    <select value={bankForm.accountType} onChange={(e) => setBankForm({...bankForm, accountType: e.target.value})}
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                      <option value="savings">Savings</option>
                      <option value="current">Current</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Account Number</Label>
                    <Input value={bankForm.accountNumber} onChange={(e) => setBankForm({...bankForm, accountNumber: e.target.value})} placeholder="Account number" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Confirm Account Number</Label>
                    <Input value={bankForm.confirmAccountNumber} onChange={(e) => setBankForm({...bankForm, confirmAccountNumber: e.target.value})} placeholder="Re-enter account number" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>IFSC Code</Label>
                    <Input value={bankForm.ifscCode} onChange={(e) => setBankForm({...bankForm, ifscCode: e.target.value})} placeholder="e.g. SBIN0001234" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>MICR Code</Label>
                    <Input value={bankForm.micrCode} onChange={(e) => setBankForm({...bankForm, micrCode: e.target.value})} placeholder="9-digit MICR code" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Bank Branch Address</Label>
                    <Input value={bankForm.branchAddress} onChange={(e) => setBankForm({...bankForm, branchAddress: e.target.value})} placeholder="Branch name and address" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>UPI ID (optional)</Label>
                    <Input value={bankForm.upiId} onChange={(e) => setBankForm({...bankForm, upiId: e.target.value})} placeholder="e.g. name@upi" />
                  </div>
                </div>
                {bankForm.accountNumber && bankForm.confirmAccountNumber && bankForm.accountNumber !== bankForm.confirmAccountNumber && (
                  <p className="text-sm text-red-500 mt-2">Account numbers do not match</p>
                )}
                <Button className="mt-4" onClick={() => {
                  if (bankForm.accountNumber !== bankForm.confirmAccountNumber) { toast({ title: "Account numbers do not match", variant: "destructive" }); return; }
                  saveBankMutation.mutate(bankForm);
                }} disabled={saveBankMutation.isPending || (bankForm.accountNumber !== bankForm.confirmAccountNumber && !!bankForm.confirmAccountNumber)}>
                  {saveBankMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Save Bank Details
                </Button>
              </CardContent>
            </Card>

            {/* Revenue Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><IndianRupee className="w-4 h-4" /> Revenue Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-xs text-blue-600 font-medium">Total Revenue</p>
                    <p className="text-xl font-bold text-blue-800">₹{Number(revenue?.totalRevenue || 0).toLocaleString("en-IN")}</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4">
                    <p className="text-xs text-green-600 font-medium">Paid to You</p>
                    <p className="text-xl font-bold text-green-800">₹{Number(revenue?.totalPaid || 0).toLocaleString("en-IN")}</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-4">
                    <p className="text-xs text-amber-600 font-medium">Pending Requests</p>
                    <p className="text-xl font-bold text-amber-800">₹{Number(revenue?.pendingAmount || 0).toLocaleString("en-IN")}</p>
                  </div>
                  <div className="bg-violet-50 rounded-lg p-4">
                    <p className="text-xs text-violet-600 font-medium">Claimable</p>
                    <p className="text-xl font-bold text-violet-800">₹{Number(revenue?.claimable || 0).toLocaleString("en-IN")}</p>
                  </div>
                </div>

                {/* Request Payment */}
                <div className="border rounded-lg p-4 bg-slate-50">
                  <h4 className="text-sm font-semibold mb-3">Request Payment</h4>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Amount (₹)</Label>
                      <Input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="Enter amount" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Notes</Label>
                      <Input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Optional notes" />
                    </div>
                    <Button onClick={() => requestPaymentMutation.mutate({ amount: paymentAmount, notes: paymentNotes })}
                      disabled={!paymentAmount || Number(paymentAmount) <= 0 || requestPaymentMutation.isPending}>
                      <ArrowUpRight className="w-4 h-4 mr-1" /> Request
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payment History */}
            {payments && (payments as any[]).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Payment History</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-slate-500">
                        <th className="py-2 px-2">Date</th>
                        <th className="py-2 px-2">Type</th>
                        <th className="py-2 px-2">Amount</th>
                        <th className="py-2 px-2">Status</th>
                        <th className="py-2 px-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payments as any[]).map((p: any) => (
                        <tr key={p.id} className="border-b border-slate-100">
                          <td className="py-2 px-2 text-slate-600">{new Date(p.requested_at).toLocaleDateString("en-IN")}</td>
                          <td className="py-2 px-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.type === "credit" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                              {p.type === "credit" ? "Revenue" : "Payout"}
                            </span>
                          </td>
                          <td className={`py-2 px-2 font-medium ${p.type === "credit" ? "text-green-600" : "text-blue-600"}`}>
                            {p.type === "credit" ? "+" : "-"}₹{Number(p.amount).toLocaleString("en-IN")}
                          </td>
                          <td className="py-2 px-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              p.status === "completed" ? "bg-green-100 text-green-700" :
                              p.status === "pending" ? "bg-amber-100 text-amber-700" :
                              "bg-red-100 text-red-700"}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-slate-500 text-xs max-w-[200px] truncate">{p.notes || "\u2014"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

      </Tabs>
    </div>
  );
}
