import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IndianRupee, Users, TrendingUp, FileText, Plus, Download, ShieldCheck, Fingerprint, CheckCircle2, XCircle, FileSignature } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import type { Strategy, Call, Subscription, Content as ContentType, RiskProfile } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

interface EnrichedSubscriber extends Subscription {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  strategyName: string;
  planName: string;
}

interface RevenueData {
  monthlyRevenue: number;
  ytdRevenue: number;
  totalPayments: number;
}

function RiskProfileDialog({ subscriptionId, open, onClose }: { subscriptionId: string | null; open: boolean; onClose: () => void }) {
  const { data: profile, isLoading } = useQuery<RiskProfile>({
    queryKey: ["/api/risk-profiles", subscriptionId],
    enabled: !!subscriptionId && open,
  });

  const categoryColors: Record<string, string> = {
    "Conservative": "text-blue-600",
    "Moderately Conservative": "text-cyan-600",
    "Moderate": "text-green-600",
    "Aggressive": "text-orange-600",
    "Very Aggressive": "text-red-600",
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Risk Profile
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : profile ? (
          <div className="space-y-4">
            <div className="text-center p-4 rounded-md border">
              <p className="text-xs text-muted-foreground mb-1">Risk Category</p>
              <p className={`text-xl font-bold ${categoryColors[profile.riskCategory || ""] || ""}`} data-testid="text-dialog-risk-category">
                {profile.riskCategory}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-2 rounded-md border">
                <p className="text-xs text-muted-foreground">Capacity</p>
                <p className="text-lg font-semibold">{profile.capacityScore}</p>
              </div>
              <div className="p-2 rounded-md border">
                <p className="text-xs text-muted-foreground">Tolerance</p>
                <p className="text-lg font-semibold">{profile.toleranceScore}</p>
              </div>
              <div className="p-2 rounded-md border">
                <p className="text-xs text-muted-foreground">Overall</p>
                <p className="text-lg font-semibold">{profile.overallScore}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-2 py-1 border-b">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium text-right">{profile.fullName}</span>
              </div>
              <div className="flex justify-between gap-2 py-1 border-b">
                <span className="text-muted-foreground">Occupation</span>
                <span className="font-medium text-right">{profile.occupation || "N/A"}</span>
              </div>
              <div className="flex justify-between gap-2 py-1 border-b">
                <span className="text-muted-foreground">Annual Income</span>
                <span className="font-medium text-right">{profile.annualIncome?.replace(/_/g, " ") || "N/A"}</span>
              </div>
              <div className="flex justify-between gap-2 py-1 border-b">
                <span className="text-muted-foreground">Financial Assets</span>
                <span className="font-medium text-right">{profile.totalFinancialAssets?.replace(/_/g, " ") || "N/A"}</span>
              </div>
              <div className="flex justify-between gap-2 py-1 border-b">
                <span className="text-muted-foreground">Investment Objective</span>
                <span className="font-medium text-right">{profile.investmentObjective?.replace(/_/g, " ") || "N/A"}</span>
              </div>
              <div className="flex justify-between gap-2 py-1 border-b">
                <span className="text-muted-foreground">Time Horizon</span>
                <span className="font-medium text-right">{profile.timeHorizon?.replace(/_/g, " ") || "N/A"}</span>
              </div>
              <div className="flex justify-between gap-2 py-1 border-b">
                <span className="text-muted-foreground">Market Knowledge</span>
                <span className="font-medium text-right">{profile.marketKnowledge || "N/A"}</span>
              </div>
              <div className="flex justify-between gap-2 py-1 border-b">
                <span className="text-muted-foreground">Experience</span>
                <span className="font-medium text-right">{profile.yearsOfExperience?.replace(/_/g, " ") || "N/A"}</span>
              </div>
              <div className="flex justify-between gap-2 py-1 border-b">
                <span className="text-muted-foreground">Expected Return</span>
                <span className="font-medium text-right">{profile.expectedReturn?.replace(/_/g, " ") || "N/A"}</span>
              </div>
              <div className="flex justify-between gap-2 py-1">
                <span className="text-muted-foreground">Risk Statement</span>
                <span className="font-medium text-right">{profile.riskStatement?.replace(/_/g, " ") || "N/A"}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">Risk profile not found</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface EkycDetail {
  subscriptionId: string;
  investorName: string;
  investorEmail: string;
  ekycDone: boolean;
  aadhaar: {
    status: string;
    name: string;
    last4: string;
    dob: string;
    gender: string;
    address: string;
    photo: string;
    verifiedAt: string;
  } | null;
  pan: {
    status: string;
    number: string;
    name: string;
    category: string;
    aadhaarLinked: boolean;
    verifiedAt: string;
  } | null;
}

function EkycDetailDialog({ subscriptionId, open, onClose }: { subscriptionId: string | null; open: boolean; onClose: () => void }) {
  const { data: ekyc, isLoading } = useQuery<EkycDetail>({
    queryKey: ["/api/advisor/ekyc", subscriptionId],
    enabled: !!subscriptionId && open,
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="w-4 h-4" />
            eKYC Verification Details
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : ekyc ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-md border">
              <div>
                <p className="text-xs text-muted-foreground">Overall Status</p>
                <p className="font-semibold" data-testid="text-ekyc-overall-status">{ekyc.ekycDone ? "Verified" : "Incomplete"}</p>
              </div>
              {ekyc.ekycDone ? (
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              ) : (
                <XCircle className="w-6 h-6 text-muted-foreground" />
              )}
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-md border">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Aadhaar Verification</p>
                  {ekyc.aadhaar ? (
                    <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Verified</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">Pending</Badge>
                  )}
                </div>
                {ekyc.aadhaar ? (
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Name</span>
                      <span className="font-medium text-right">{ekyc.aadhaar.name || "N/A"}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Aadhaar (Last 4)</span>
                      <span className="font-medium">XXXX-XXXX-{ekyc.aadhaar.last4}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">DOB</span>
                      <span className="font-medium">{ekyc.aadhaar.dob || "N/A"}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Gender</span>
                      <span className="font-medium">{ekyc.aadhaar.gender || "N/A"}</span>
                    </div>
                    {ekyc.aadhaar.verifiedAt && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Verified On</span>
                        <span className="font-medium">{new Date(ekyc.aadhaar.verifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Not yet verified</p>
                )}
              </div>

              <div className="p-3 rounded-md border">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">PAN Verification</p>
                  {ekyc.pan ? (
                    <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Verified</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">Pending</Badge>
                  )}
                </div>
                {ekyc.pan ? (
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Name</span>
                      <span className="font-medium text-right">{ekyc.pan.name || "N/A"}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">PAN</span>
                      <span className="font-medium">{ekyc.pan.number || "N/A"}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Category</span>
                      <span className="font-medium">{ekyc.pan.category || "N/A"}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Aadhaar Linked</span>
                      <span className="font-medium">{ekyc.pan.aadhaarLinked ? "Yes" : "No"}</span>
                    </div>
                    {ekyc.pan.verifiedAt && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Verified On</span>
                        <span className="font-medium">{new Date(ekyc.pan.verifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Not yet verified</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">eKYC details not found</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface AgreementDetail {
  found: boolean;
  agreementId: string;
  investorName: string;
  investorEmail: string;
  aadhaarName: string;
  aadhaarLast4: string;
  signedAt: string;
  status: string;
}

function AgreementDetailDialog({ subscriptionId, open, onClose }: { subscriptionId: string | null; open: boolean; onClose: () => void }) {
  const { data: agreement, isLoading } = useQuery<AgreementDetail>({
    queryKey: ["/api/advisor/agreements", subscriptionId],
    enabled: !!subscriptionId && open,
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="w-4 h-4" />
            Agreement Details
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : agreement?.found ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-md border">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="font-semibold" data-testid="text-agreement-status">{agreement.status === "signed" ? "Signed" : "Pending"}</p>
              </div>
              {agreement.status === "signed" ? (
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              ) : (
                <XCircle className="w-6 h-6 text-muted-foreground" />
              )}
            </div>

            <div className="p-3 rounded-md border space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Investor</span>
                <span className="font-medium text-right">{agreement.investorName}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium text-right">{agreement.investorEmail}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Signed By (Aadhaar)</span>
                <span className="font-medium text-right">{agreement.aadhaarName} (XXXX-{agreement.aadhaarLast4})</span>
              </div>
              {agreement.signedAt && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Signed On</span>
                  <span className="font-medium text-right">
                    {new Date(agreement.signedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-4 text-center space-y-2">
            <XCircle className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">No signed agreement found for this subscription.</p>
            <p className="text-xs text-muted-foreground">This may be an older subscription created before the e-Sign requirement was introduced.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardHome() {
  const { user } = useAuth();
  const [riskProfileSubId, setRiskProfileSubId] = useState<string | null>(null);
  const [ekycSubId, setEkycSubId] = useState<string | null>(null);
  const [agreementSubId, setAgreementSubId] = useState<string | null>(null);

  const { data: strategies, isLoading: loadingStrategies } = useQuery<Strategy[]>({
    queryKey: ["/api/advisor/strategies"],
  });

  const { data: subscribers } = useQuery<EnrichedSubscriber[]>({
    queryKey: ["/api/advisor/subscribers"],
  });

  const { data: revenue } = useQuery<RevenueData>({
    queryKey: ["/api/advisor/revenue"],
  });

  const { data: contents } = useQuery<ContentType[]>({
    queryKey: ["/api/advisor/content"],
  });

  const monthlyRevenue = revenue?.monthlyRevenue || 0;
  const ytdRevenue = revenue?.ytdRevenue || 0;

  const chartData = (strategies || []).map((s) => ({
    name: s.name.length > 12 ? s.name.slice(0, 12) + "..." : s.name,
    fullName: s.name,
    cagr: Number(s.cagr || 0),
    recs: Number(s.totalRecommendations || 0),
  }));

  const hasChartData = chartData.some((d) => d.cagr !== 0);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const currentMonthSubs = (subscribers || []).filter(sub => {
    if (!sub.createdAt) return false;
    const d = new Date(sub.createdAt);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });
  const previousSubs = (subscribers || []).filter(sub => {
    if (!sub.createdAt) return true;
    const d = new Date(sub.createdAt);
    return d.getMonth() !== currentMonth || d.getFullYear() !== currentYear;
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Subscription Revenue</h2>
          <div className="grid grid-cols-2 gap-3">
            <Card className="bg-primary text-primary-foreground">
              <CardContent className="p-4 space-y-1">
                <p className="text-sm opacity-80">Monthly Revenue</p>
                <p className="text-2xl font-bold">
                  {"\u20B9"}{monthlyRevenue.toLocaleString("en-IN")}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-accent text-accent-foreground">
              <CardContent className="p-4 space-y-1">
                <p className="text-sm opacity-80">Revenue YTD</p>
                <p className="text-2xl font-bold">
                  {"\u20B9"}{ytdRevenue.toLocaleString("en-IN")}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Strategy Performance</h3>
            <Card>
              <CardContent className="p-4">
                {!strategies || strategies.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                    <div className="text-center space-y-1">
                      <TrendingUp className="w-8 h-8 mx-auto text-muted-foreground/50" />
                      <p>Create strategies to see performance</p>
                    </div>
                  </div>
                ) : !hasChartData ? (
                  <div data-testid="chart-strategy-performance">
                    <div className="space-y-2">
                      {chartData.map((d, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                          <span className="text-sm font-medium truncate">{d.fullName}</span>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>CAGR: {d.cagr}%</span>
                            <span>Recs: {d.recs}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-48" data-testid="chart-strategy-performance">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 11 }}
                          interval={0}
                          angle={-20}
                          textAnchor="end"
                          height={50}
                        />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-popover text-popover-foreground border rounded-md p-2 shadow-md text-xs space-y-0.5">
                                  <p className="font-medium">{data.fullName}</p>
                                  <p>CAGR: {data.cagr}%</p>
                                  <p>Recommendations: {data.recs}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar dataKey="cagr" radius={[4, 4, 0, 0]} maxBarSize={40}>
                          {chartData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.cagr >= 0 ? "hsl(145 45% 42%)" : "hsl(10 72% 48%)"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/strategies">
              <Button size="sm" variant="outline" data-testid="button-add-stock">
                <Plus className="w-3 h-3 mr-1" /> Add Stock
              </Button>
            </Link>
            <Link href="/dashboard/strategies">
              <Button size="sm" variant="outline" data-testid="button-new-strategy">
                <Plus className="w-3 h-3 mr-1" /> New Strategy
              </Button>
            </Link>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Customers Acquired</h2>
          <Tabs defaultValue="current">
            <TabsList>
              <TabsTrigger value="previous" data-testid="tab-previous-months">Previous Months</TabsTrigger>
              <TabsTrigger value="current" data-testid="tab-current-month">Current Month</TabsTrigger>
            </TabsList>
            <TabsContent value="current">
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    <div className="grid grid-cols-[1fr_auto] px-4 py-2 text-xs font-medium text-muted-foreground gap-2">
                      <span>Customer</span>
                      <div className="flex gap-4">
                        <span className="w-16 text-center">Agreement</span>
                        <span className="w-16 text-center">EKYC</span>
                        <span className="w-16 text-center">Risk Prof.</span>
                      </div>
                    </div>
                    {currentMonthSubs.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No subscribers this month
                      </div>
                    ) : (
                      currentMonthSubs.slice(0, 10).map((sub) => (
                        <div key={sub.id} className="grid grid-cols-[1fr_auto] px-4 py-2.5 text-sm gap-2" data-testid={`row-subscriber-${sub.id}`}>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{sub.customerName}</p>
                            <p className="text-xs text-muted-foreground truncate">{sub.customerEmail}</p>
                            {sub.customerPhone && <p className="text-xs text-muted-foreground">{sub.customerPhone}</p>}
                            {sub.strategyName && <p className="text-xs text-muted-foreground mt-0.5">Strategy: {sub.strategyName}</p>}
                          </div>
                          <div className="flex gap-4 items-center">
                            <button
                              onClick={() => setAgreementSubId(sub.id)}
                              className="w-16 text-center text-xs font-medium text-accent underline cursor-pointer"
                              data-testid={`button-view-agreement-${sub.id}`}
                            >
                              View
                            </button>
                            {sub.ekycDone ? (
                              <button
                                onClick={() => setEkycSubId(sub.id)}
                                className="w-16 text-center text-xs font-medium text-accent underline cursor-pointer"
                                data-testid={`button-view-ekyc-${sub.id}`}
                              >
                                View
                              </button>
                            ) : (
                              <span className="w-16 text-center text-xs font-medium text-primary">No</span>
                            )}
                            {sub.riskProfiling ? (
                              <button
                                onClick={() => setRiskProfileSubId(sub.id)}
                                className="w-16 text-center text-xs font-medium text-accent underline cursor-pointer"
                                data-testid={`button-view-risk-${sub.id}`}
                              >
                                View
                              </button>
                            ) : (
                              <span className="w-16 text-center text-xs font-medium text-primary">No</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="previous">
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    <div className="grid grid-cols-[1fr_auto] px-4 py-2 text-xs font-medium text-muted-foreground gap-2">
                      <span>Customer</span>
                      <div className="flex gap-4">
                        <span className="w-16 text-center">Agreement</span>
                        <span className="w-16 text-center">EKYC</span>
                        <span className="w-16 text-center">Risk Prof.</span>
                      </div>
                    </div>
                    {previousSubs.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No data for previous months
                      </div>
                    ) : (
                      previousSubs.slice(0, 10).map((sub) => (
                        <div key={sub.id} className="grid grid-cols-[1fr_auto] px-4 py-2.5 text-sm gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{sub.customerName}</p>
                            <p className="text-xs text-muted-foreground truncate">{sub.customerEmail}</p>
                            {sub.customerPhone && <p className="text-xs text-muted-foreground">{sub.customerPhone}</p>}
                            {sub.strategyName && <p className="text-xs text-muted-foreground mt-0.5">Strategy: {sub.strategyName}</p>}
                          </div>
                          <div className="flex gap-4 items-center">
                            <button
                              onClick={() => setAgreementSubId(sub.id)}
                              className="w-16 text-center text-xs font-medium text-accent underline cursor-pointer"
                              data-testid={`button-view-agreement-prev-${sub.id}`}
                            >
                              View
                            </button>
                            {sub.ekycDone ? (
                              <button
                                onClick={() => setEkycSubId(sub.id)}
                                className="w-16 text-center text-xs font-medium text-accent underline cursor-pointer"
                                data-testid={`button-view-ekyc-prev-${sub.id}`}
                              >
                                View
                              </button>
                            ) : (
                              <span className="w-16 text-center text-xs font-medium text-primary">No</span>
                            )}
                            {sub.riskProfiling ? (
                              <button
                                onClick={() => setRiskProfileSubId(sub.id)}
                                className="w-16 text-center text-xs font-medium text-accent underline cursor-pointer"
                              >
                                View
                              </button>
                            ) : (
                              <span className="w-16 text-center text-xs font-medium text-primary">No</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">Manage Media & Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(contents || []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">No content published yet</p>
            ) : (
              (contents || []).slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted/50">
                  <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{c.title}</span>
                </div>
              ))
            )}
            <Link href="/dashboard/content">
              <Button variant="outline" className="w-full mt-2" size="sm" data-testid="button-add-content">
                <Plus className="w-3 h-3 mr-1" /> Add New Content / Media
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {["Calls Report", "Customer Acquisition Report", "Financial Report"].map((r) => (
              <div key={r} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                <span className="text-sm text-primary font-medium">{r}</span>
              </div>
            ))}
            <Link href="/dashboard/reports">
              <Button className="w-full mt-2" size="sm" data-testid="button-download-reports">
                <Download className="w-3 h-3 mr-1" /> Download
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <RiskProfileDialog
        subscriptionId={riskProfileSubId}
        open={!!riskProfileSubId}
        onClose={() => setRiskProfileSubId(null)}
      />
      <EkycDetailDialog
        subscriptionId={ekycSubId}
        open={!!ekycSubId}
        onClose={() => setEkycSubId(null)}
      />
      <AgreementDetailDialog
        subscriptionId={agreementSubId}
        open={!!agreementSubId}
        onClose={() => setAgreementSubId(null)}
      />
    </div>
  );
}
