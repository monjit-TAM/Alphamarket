import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ShieldCheck, ChevronLeft, ChevronRight, Loader2, CheckCircle2 } from "lucide-react";

const STEPS = [
  "Identity & Basic KYC",
  "Financial Position",
  "Investment Objectives",
  "Knowledge & Experience",
  "Risk Attitude",
  "Constraints & Preferences",
  "Source of Funds",
  "Declaration & Consent",
];

interface FormData {
  fullName: string;
  dateOfBirth: string;
  pan: string;
  residentialStatus: string;
  occupation: string;
  dependents: number;
  contactDetails: string;
  nomineeDetails: string;
  annualIncome: string;
  investibleSurplus: string;
  totalFinancialAssets: string;
  totalLiabilities: string;
  emergencyFund: string;
  affordableLoss: string;
  investmentObjective: string;
  timeHorizon: string;
  cashFlowNeeds: string;
  cashFlowDetails: string;
  marketKnowledge: string;
  investmentExperience: string[];
  yearsOfExperience: string;
  pastBehavior: string;
  portfolioFallReaction: string;
  expectedReturn: string;
  volatilityComfort: number;
  riskStatement: string;
  regulatoryConstraints: boolean;
  regulatoryConstraintsDetails: string;
  liquidityPreference: string;
  taxBracket: string;
  marginUsage: boolean;
  marginUsageDetails: string;
  sourceOfFunds: string;
  fundsEncumbered: boolean;
  multiJurisdiction: boolean;
  multiJurisdictionDetails: string;
  declarationConfirm: boolean;
  consentRiskProfile: boolean;
  consentMarketRisk: boolean;
  consentPeriodicReview: boolean;
}

const defaultForm: FormData = {
  fullName: "",
  dateOfBirth: "",
  pan: "",
  residentialStatus: "",
  occupation: "",
  dependents: 0,
  contactDetails: "",
  nomineeDetails: "",
  annualIncome: "",
  investibleSurplus: "",
  totalFinancialAssets: "",
  totalLiabilities: "",
  emergencyFund: "",
  affordableLoss: "",
  investmentObjective: "",
  timeHorizon: "",
  cashFlowNeeds: "",
  cashFlowDetails: "",
  marketKnowledge: "",
  investmentExperience: [],
  yearsOfExperience: "",
  pastBehavior: "",
  portfolioFallReaction: "",
  expectedReturn: "",
  volatilityComfort: 3,
  riskStatement: "",
  regulatoryConstraints: false,
  regulatoryConstraintsDetails: "",
  liquidityPreference: "",
  taxBracket: "",
  marginUsage: false,
  marginUsageDetails: "",
  sourceOfFunds: "",
  fundsEncumbered: false,
  multiJurisdiction: false,
  multiJurisdictionDetails: "",
  declarationConfirm: false,
  consentRiskProfile: false,
  consentMarketRisk: false,
  consentPeriodicReview: false,
};

export default function RiskProfilingPage() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const subscriptionId = params.get("subscriptionId");
  const { user } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>({ ...defaultForm });
  const [completed, setCompleted] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (user) {
      setForm((prev) => ({
        ...prev,
        fullName: prev.fullName || user.companyName || user.username || "",
        contactDetails: prev.contactDetails || (user.email ? `Email: ${user.email}${user.phone ? `, Phone: ${user.phone}` : ""}` : ""),
      }));
    }
  }, [user]);

  const submitMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/risk-profiles", data);
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      setCompleted(true);
      toast({ title: "Risk profile submitted successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!form.declarationConfirm || !form.consentRiskProfile || !form.consentMarketRisk) {
      toast({ title: "Please accept all required declarations", variant: "destructive" });
      return;
    }
    submitMutation.mutate({ subscriptionId, ...form });
  };

  const updateField = (field: keyof FormData, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleExperience = (val: string) => {
    setForm((prev) => ({
      ...prev,
      investmentExperience: prev.investmentExperience.includes(val)
        ? prev.investmentExperience.filter((v) => v !== val)
        : [...prev.investmentExperience, val],
    }));
  };

  if (!subscriptionId) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardContent className="py-12 text-center space-y-4">
              <p className="text-muted-foreground">Invalid link. No subscription specified.</p>
              <Button onClick={() => navigate("/investor-dashboard")} data-testid="button-go-back">Go to Dashboard</Button>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  if (completed && result) {
    const categoryColors: Record<string, string> = {
      "Conservative": "text-blue-600",
      "Moderately Conservative": "text-cyan-600",
      "Moderate": "text-green-600",
      "Aggressive": "text-orange-600",
      "Very Aggressive": "text-red-600",
    };

    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-lg mx-auto px-4 py-12 w-full">
          <Card>
            <CardContent className="py-10 text-center space-y-6">
              <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
              <div className="space-y-2">
                <h2 className="text-xl font-bold" data-testid="text-risk-profile-complete">Risk Profile Complete</h2>
                <p className="text-sm text-muted-foreground">Your risk assessment has been recorded and shared with your advisor.</p>
              </div>

              <div className="p-4 rounded-md border space-y-3">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Your Risk Category</p>
                  <p className={`text-2xl font-bold ${categoryColors[result.riskCategory] || ""}`} data-testid="text-risk-category">
                    {result.riskCategory}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Capacity</p>
                    <p className="text-lg font-semibold" data-testid="text-capacity-score">{result.capacityScore}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tolerance</p>
                    <p className="text-lg font-semibold" data-testid="text-tolerance-score">{result.toleranceScore}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Overall</p>
                    <p className="text-lg font-semibold" data-testid="text-overall-score">{result.overallScore}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Button onClick={() => navigate("/investor-dashboard")} data-testid="button-go-dashboard-rp">
                  Go to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full Name (as per KYC) *</Label>
              <Input value={form.fullName} onChange={(e) => updateField("fullName", e.target.value)} data-testid="input-rp-fullname" />
            </div>
            <div className="space-y-1.5">
              <Label>Date of Birth *</Label>
              <Input type="date" value={form.dateOfBirth} onChange={(e) => updateField("dateOfBirth", e.target.value)} data-testid="input-rp-dob" />
            </div>
            <div className="space-y-1.5">
              <Label>PAN / KYC Identifier *</Label>
              <Input value={form.pan} onChange={(e) => updateField("pan", e.target.value.toUpperCase())} maxLength={10} data-testid="input-rp-pan" />
            </div>
            <div className="space-y-1.5">
              <Label>Residential Status</Label>
              <Select value={form.residentialStatus} onValueChange={(v) => updateField("residentialStatus", v)}>
                <SelectTrigger data-testid="select-rp-residential">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resident">Resident Indian</SelectItem>
                  <SelectItem value="nri">NRI</SelectItem>
                  <SelectItem value="pio">PIO</SelectItem>
                  <SelectItem value="others">Others</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Occupation</Label>
              <Select value={form.occupation} onValueChange={(v) => updateField("occupation", v)}>
                <SelectTrigger data-testid="select-rp-occupation">
                  <SelectValue placeholder="Select occupation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salaried">Salaried</SelectItem>
                  <SelectItem value="self_employed">Self-employed</SelectItem>
                  <SelectItem value="business">Business Owner</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="homemaker">Homemaker</SelectItem>
                  <SelectItem value="others">Others</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Number of Dependents</Label>
              <Input type="number" min={0} value={form.dependents} onChange={(e) => updateField("dependents", parseInt(e.target.value) || 0)} data-testid="input-rp-dependents" />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Details</Label>
              <Textarea value={form.contactDetails} onChange={(e) => updateField("contactDetails", e.target.value)} rows={2} data-testid="input-rp-contact" />
            </div>
            <div className="space-y-1.5">
              <Label>Nominee Details</Label>
              <Textarea value={form.nomineeDetails} onChange={(e) => updateField("nomineeDetails", e.target.value)} rows={2} data-testid="input-rp-nominee" />
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Annual Gross Household Income</Label>
              <RadioGroup value={form.annualIncome} onValueChange={(v) => updateField("annualIncome", v)} data-testid="radio-rp-income">
                <div className="space-y-2">
                  {[
                    { value: "below_3l", label: "Below \u20B93,00,000" },
                    { value: "3l_10l", label: "\u20B93L \u2013 \u20B910L" },
                    { value: "10l_25l", label: "\u20B910L \u2013 \u20B925L" },
                    { value: "above_25l", label: "Above \u20B925L" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`income-${opt.value}`} />
                      <Label htmlFor={`income-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>Net Investible Surplus</Label>
              <RadioGroup value={form.investibleSurplus} onValueChange={(v) => updateField("investibleSurplus", v)} data-testid="radio-rp-surplus">
                <div className="space-y-2">
                  {[
                    { value: "below_1l", label: "Below \u20B91 Lakh" },
                    { value: "1l_5l", label: "\u20B91L \u2013 \u20B95L" },
                    { value: "5l_25l", label: "\u20B95L \u2013 \u20B925L" },
                    { value: "above_25l", label: "Above \u20B925L" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`surplus-${opt.value}`} />
                      <Label htmlFor={`surplus-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>Total Financial Assets</Label>
              <RadioGroup value={form.totalFinancialAssets} onValueChange={(v) => updateField("totalFinancialAssets", v)} data-testid="radio-rp-assets">
                <div className="space-y-2">
                  {[
                    { value: "below_5l", label: "Below \u20B95L" },
                    { value: "5l_25l", label: "\u20B95L \u2013 \u20B925L" },
                    { value: "25l_1cr", label: "\u20B925L \u2013 \u20B91Cr" },
                    { value: "above_1cr", label: "Above \u20B91Cr" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`assets-${opt.value}`} />
                      <Label htmlFor={`assets-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>Total Liabilities / Outstanding Loans</Label>
              <RadioGroup value={form.totalLiabilities} onValueChange={(v) => updateField("totalLiabilities", v)} data-testid="radio-rp-liabilities">
                <div className="space-y-2">
                  {[
                    { value: "none", label: "None" },
                    { value: "below_5l", label: "Below \u20B95L" },
                    { value: "5l_25l", label: "\u20B95L \u2013 \u20B925L" },
                    { value: "above_25l", label: "Above \u20B925L" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`liab-${opt.value}`} />
                      <Label htmlFor={`liab-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>Emergency Fund Availability (months of expenses)</Label>
              <RadioGroup value={form.emergencyFund} onValueChange={(v) => updateField("emergencyFund", v)} data-testid="radio-rp-emergency">
                <div className="space-y-2">
                  {[
                    { value: "below_3m", label: "Less than 3 months" },
                    { value: "3m_6m", label: "3\u20136 months" },
                    { value: "6m_12m", label: "6\u201312 months" },
                    { value: "above_12m", label: "More than 12 months" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`emerg-${opt.value}`} />
                      <Label htmlFor={`emerg-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>Percentage of investible assets you can afford to lose without affecting lifestyle</Label>
              <RadioGroup value={form.affordableLoss} onValueChange={(v) => updateField("affordableLoss", v)} data-testid="radio-rp-loss">
                <div className="space-y-2">
                  {[
                    { value: "below_5", label: "Less than 5%" },
                    { value: "5_15", label: "5% \u2013 15%" },
                    { value: "15_30", label: "15% \u2013 30%" },
                    { value: "above_30", label: "More than 30%" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`loss-${opt.value}`} />
                      <Label htmlFor={`loss-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Primary Investment Objective</Label>
              <RadioGroup value={form.investmentObjective} onValueChange={(v) => updateField("investmentObjective", v)} data-testid="radio-rp-objective">
                <div className="space-y-2">
                  {[
                    { value: "capital_preservation", label: "Capital Preservation / Liquidity" },
                    { value: "regular_income", label: "Regular Income (dividends/interest)" },
                    { value: "capital_appreciation", label: "Capital Appreciation (medium term)" },
                    { value: "wealth_creation", label: "Long-term Wealth Creation / Retirement Planning" },
                    { value: "speculative", label: "Speculative / Short-term Trading" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`obj-${opt.value}`} />
                      <Label htmlFor={`obj-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>Investment Time Horizon</Label>
              <RadioGroup value={form.timeHorizon} onValueChange={(v) => updateField("timeHorizon", v)} data-testid="radio-rp-horizon">
                <div className="space-y-2">
                  {[
                    { value: "below_1y", label: "Less than 1 year" },
                    { value: "1y_3y", label: "1\u20133 years" },
                    { value: "3y_7y", label: "3\u20137 years" },
                    { value: "7y_15y", label: "7\u201315 years" },
                    { value: "above_15y", label: "More than 15 years" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`horizon-${opt.value}`} />
                      <Label htmlFor={`horizon-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>Do you have specific cash-flow needs or upcoming commitments?</Label>
              <RadioGroup value={form.cashFlowNeeds} onValueChange={(v) => updateField("cashFlowNeeds", v)} data-testid="radio-rp-cashflow">
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="yes" id="cashflow-yes" />
                    <Label htmlFor="cashflow-yes" className="font-normal cursor-pointer">Yes</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="no" id="cashflow-no" />
                    <Label htmlFor="cashflow-no" className="font-normal cursor-pointer">No</Label>
                  </div>
                </div>
              </RadioGroup>
              {form.cashFlowNeeds === "yes" && (
                <Textarea
                  value={form.cashFlowDetails}
                  onChange={(e) => updateField("cashFlowDetails", e.target.value)}
                  placeholder="Details (e.g., home purchase, education, medical)"
                  rows={2}
                  data-testid="input-rp-cashflow-details"
                />
              )}
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>How would you rate your knowledge of securities/markets?</Label>
              <RadioGroup value={form.marketKnowledge} onValueChange={(v) => updateField("marketKnowledge", v)} data-testid="radio-rp-knowledge">
                <div className="space-y-2">
                  {[
                    { value: "none", label: "None" },
                    { value: "basic", label: "Basic" },
                    { value: "moderate", label: "Moderate" },
                    { value: "advanced", label: "Advanced" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`knowledge-${opt.value}`} />
                      <Label htmlFor={`knowledge-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>Have you invested in the following instruments before? (select all that apply)</Label>
              <div className="space-y-2" data-testid="checkbox-rp-instruments">
                {[
                  { value: "bank_fd", label: "Bank FDs / Debt Mutual Funds" },
                  { value: "equity_mf", label: "Equity Mutual Funds" },
                  { value: "direct_equity", label: "Direct Equities" },
                  { value: "derivatives", label: "Derivatives / F&O" },
                  { value: "structured", label: "Structured Products / Complex Products" },
                ].map((opt) => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <Checkbox
                      checked={form.investmentExperience.includes(opt.value)}
                      onCheckedChange={() => toggleExperience(opt.value)}
                      id={`instr-${opt.value}`}
                    />
                    <Label htmlFor={`instr-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Years of Active Investing/Trading Experience</Label>
              <RadioGroup value={form.yearsOfExperience} onValueChange={(v) => updateField("yearsOfExperience", v)} data-testid="radio-rp-years">
                <div className="space-y-2">
                  {[
                    { value: "0", label: "None" },
                    { value: "below_2y", label: "Less than 2 years" },
                    { value: "2y_5y", label: "2\u20135 years" },
                    { value: "above_5y", label: "More than 5 years" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`years-${opt.value}`} />
                      <Label htmlFor={`years-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>In past market downturns, you typically:</Label>
              <RadioGroup value={form.pastBehavior} onValueChange={(v) => updateField("pastBehavior", v)} data-testid="radio-rp-past">
                <div className="space-y-2">
                  {[
                    { value: "sold", label: "Sold to avoid losses" },
                    { value: "held", label: "Held most positions" },
                    { value: "bought_more", label: "Bought more to average down" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`past-${opt.value}`} />
                      <Label htmlFor={`past-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>If your portfolio falls 20% in 6 months, what would you do?</Label>
              <RadioGroup value={form.portfolioFallReaction} onValueChange={(v) => updateField("portfolioFallReaction", v)} data-testid="radio-rp-fall">
                <div className="space-y-2">
                  {[
                    { value: "sell_most", label: "Sell most holdings to avoid further loss" },
                    { value: "sell_some", label: "Sell some underperformers" },
                    { value: "do_nothing", label: "Do nothing and wait for recovery" },
                    { value: "buy_more", label: "Buy more at lower prices" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`fall-${opt.value}`} />
                      <Label htmlFor={`fall-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>Expected Annual Return (net) from investments</Label>
              <RadioGroup value={form.expectedReturn} onValueChange={(v) => updateField("expectedReturn", v)} data-testid="radio-rp-return">
                <div className="space-y-2">
                  {[
                    { value: "below_6", label: "Less than 6%" },
                    { value: "6_10", label: "6% \u2013 10%" },
                    { value: "10_15", label: "10% \u2013 15%" },
                    { value: "15_25", label: "15% \u2013 25%" },
                    { value: "above_25", label: "Above 25%" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`return-${opt.value}`} />
                      <Label htmlFor={`return-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>Comfort with high short-term volatility for higher long-term returns (1 = Very Uncomfortable, 5 = Very Comfortable)</Label>
              <div className="px-2 pt-2">
                <Slider
                  value={[form.volatilityComfort]}
                  onValueChange={([v]) => updateField("volatilityComfort", v)}
                  min={1}
                  max={5}
                  step={1}
                  data-testid="slider-rp-volatility"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Which statement best describes you?</Label>
              <RadioGroup value={form.riskStatement} onValueChange={(v) => updateField("riskStatement", v)} data-testid="radio-rp-statement">
                <div className="space-y-2">
                  {[
                    { value: "no_loss", label: "I prefer no capital loss even if returns are lower" },
                    { value: "small_fluctuations", label: "I accept small capital fluctuations for better returns" },
                    { value: "significant_fluctuations", label: "I accept significant fluctuations for higher long-term growth" },
                    { value: "high_risk", label: "I actively seek high-risk opportunities aiming for high returns" },
                  ].map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`stmt-${opt.value}`} />
                      <Label htmlFor={`stmt-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Any regulatory/investment constraints?</Label>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.regulatoryConstraints} onCheckedChange={(v) => updateField("regulatoryConstraints", !!v)} id="reg-constraints" />
                <Label htmlFor="reg-constraints" className="font-normal cursor-pointer">Yes, I have constraints</Label>
              </div>
              {form.regulatoryConstraints && (
                <Textarea
                  value={form.regulatoryConstraintsDetails}
                  onChange={(e) => updateField("regulatoryConstraintsDetails", e.target.value)}
                  placeholder="E.g., no derivatives, no overseas investments, Shariah compliant, ESG preference"
                  rows={2}
                  data-testid="input-rp-constraints-details"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Liquidity Preference</Label>
              <Select value={form.liquidityPreference} onValueChange={(v) => updateField("liquidityPreference", v)}>
                <SelectTrigger data-testid="select-rp-liquidity">
                  <SelectValue placeholder="Select preference" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Need monthly access to funds</SelectItem>
                  <SelectItem value="quarterly">Need quarterly access</SelectItem>
                  <SelectItem value="annual">Annual access is fine</SelectItem>
                  <SelectItem value="no_preference">No specific liquidity preference</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Income Tax Bracket</Label>
              <Select value={form.taxBracket} onValueChange={(v) => updateField("taxBracket", v)}>
                <SelectTrigger data-testid="select-rp-tax">
                  <SelectValue placeholder="Select bracket" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nil">Nil (below \u20B92.5L)</SelectItem>
                  <SelectItem value="5">5% (\u20B92.5L \u2013 \u20B95L)</SelectItem>
                  <SelectItem value="20">20% (\u20B95L \u2013 \u20B910L)</SelectItem>
                  <SelectItem value="30">30% (Above \u20B910L)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Will you use margin/borrowings for investing?</Label>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.marginUsage} onCheckedChange={(v) => updateField("marginUsage", !!v)} id="margin-usage" />
                <Label htmlFor="margin-usage" className="font-normal cursor-pointer">Yes</Label>
              </div>
              {form.marginUsage && (
                <Textarea
                  value={form.marginUsageDetails}
                  onChange={(e) => updateField("marginUsageDetails", e.target.value)}
                  placeholder="Details about margin/leverage usage"
                  rows={2}
                  data-testid="input-rp-margin-details"
                />
              )}
            </div>
          </div>
        );

      case 6:
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Source of Investment Funds</Label>
              <Select value={form.sourceOfFunds} onValueChange={(v) => updateField("sourceOfFunds", v)}>
                <SelectTrigger data-testid="select-rp-source">
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salary">Salary</SelectItem>
                  <SelectItem value="business">Business Profit</SelectItem>
                  <SelectItem value="inheritance">Inheritance</SelectItem>
                  <SelectItem value="sale_of_asset">Sale of Asset</SelectItem>
                  <SelectItem value="loan">Loan</SelectItem>
                  <SelectItem value="gift">Gift</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Are your funds free of encumbrances?</Label>
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox checked={!form.fundsEncumbered} onCheckedChange={() => updateField("fundsEncumbered", false)} id="encumbered-no" />
                  <Label htmlFor="encumbered-no" className="font-normal cursor-pointer">Yes, free of encumbrances</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={form.fundsEncumbered} onCheckedChange={() => updateField("fundsEncumbered", true)} id="encumbered-yes" />
                  <Label htmlFor="encumbered-yes" className="font-normal cursor-pointer">No</Label>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Will funds originate from multiple jurisdictions?</Label>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.multiJurisdiction} onCheckedChange={(v) => updateField("multiJurisdiction", !!v)} id="multi-juris" />
                <Label htmlFor="multi-juris" className="font-normal cursor-pointer">Yes</Label>
              </div>
              {form.multiJurisdiction && (
                <Textarea
                  value={form.multiJurisdictionDetails}
                  onChange={(e) => updateField("multiJurisdictionDetails", e.target.value)}
                  placeholder="Details about jurisdictions"
                  rows={2}
                  data-testid="input-rp-jurisdiction-details"
                />
              )}
            </div>
          </div>
        );

      case 7:
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">
              Please read and accept the following declarations to complete your risk profile.
            </p>
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-md border">
                <Checkbox
                  checked={form.declarationConfirm}
                  onCheckedChange={(v) => updateField("declarationConfirm", !!v)}
                  id="decl-1"
                  className="mt-0.5"
                  data-testid="checkbox-rp-declaration"
                />
                <Label htmlFor="decl-1" className="font-normal cursor-pointer text-sm">
                  I confirm that the information provided is true and complete. *
                </Label>
              </div>
              <div className="flex items-start gap-2 p-3 rounded-md border">
                <Checkbox
                  checked={form.consentRiskProfile}
                  onCheckedChange={(v) => updateField("consentRiskProfile", !!v)}
                  id="decl-2"
                  className="mt-0.5"
                  data-testid="checkbox-rp-consent-profile"
                />
                <Label htmlFor="decl-2" className="font-normal cursor-pointer text-sm">
                  I understand that the risk profile is based on my responses and will be used to assess suitability; I consent to the advisor using this for advice and recordkeeping. *
                </Label>
              </div>
              <div className="flex items-start gap-2 p-3 rounded-md border">
                <Checkbox
                  checked={form.consentMarketRisk}
                  onCheckedChange={(v) => updateField("consentMarketRisk", !!v)}
                  id="decl-3"
                  className="mt-0.5"
                  data-testid="checkbox-rp-consent-risk"
                />
                <Label htmlFor="decl-3" className="font-normal cursor-pointer text-sm">
                  I understand that actual market returns are not guaranteed and all investments are subject to market risk; I have read the risk disclosure. *
                </Label>
              </div>
              <div className="flex items-start gap-2 p-3 rounded-md border">
                <Checkbox
                  checked={form.consentPeriodicReview}
                  onCheckedChange={(v) => updateField("consentPeriodicReview", !!v)}
                  id="decl-4"
                  className="mt-0.5"
                  data-testid="checkbox-rp-consent-review"
                />
                <Label htmlFor="decl-4" className="font-normal cursor-pointer text-sm">
                  I consent to periodic review and to be contacted for profiling updates.
                </Label>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-2xl mx-auto px-4 py-8 w-full">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <ShieldCheck className="w-6 h-6 text-accent" />
            <h1 className="text-xl font-bold" data-testid="text-rp-title">Risk Profiling Questionnaire</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
        </div>

        <div className="flex gap-1 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-muted"}`}
            />
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{STEPS[step]}</CardTitle>
          </CardHeader>
          <CardContent>
            {renderStep()}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between mt-6 gap-3">
          <Button
            variant="outline"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            data-testid="button-rp-prev"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep(step + 1)}
              data-testid="button-rp-next"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={submitMutation.isPending || !form.declarationConfirm || !form.consentRiskProfile || !form.consentMarketRisk}
              data-testid="button-rp-submit"
            >
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
              Submit Risk Profile
            </Button>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
