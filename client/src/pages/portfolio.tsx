import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Plus, Upload, Trash2, BarChart3, PieChart, TrendingUp, TrendingDown, Loader2, ExternalLink, Eye, FolderPlus, Download } from "lucide-react";

export default function PortfolioPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("My Portfolio");
  const [shareWithAdvisors, setShareWithAdvisors] = useState(false);
  const [selectedPortfolio, setSelectedPortfolio] = useState<string | null>(null);
  const [showAddHolding, setShowAddHolding] = useState(false);
  const [holdingForm, setHoldingForm] = useState({ assetType: "equity", name: "", symbol: "", quantity: "", avgBuyPrice: "", sector: "", premium: "", sumAssured: "", maturityDate: "", interestRate: "", policyNumber: "", provider: "" });

  const { data: portfolios, isLoading } = useQuery<any[]>({ queryKey: ["/api/portfolio"] });

  const { data: holdings } = useQuery<any[]>({
    queryKey: ["/api/portfolio", selectedPortfolio, "holdings"],
    queryFn: async () => {
      const r = await fetch("/api/portfolio/" + selectedPortfolio + "/holdings", { credentials: "include" });
      return r.json();
    },
    enabled: !!selectedPortfolio,
  });

  const syncPrices = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/portfolio/" + selectedPortfolio + "/sync-prices");
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio", selectedPortfolio, "holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio", selectedPortfolio, "analytics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({ title: "Prices synced", description: data.updated + " of " + data.total + " holdings updated" });
    },
    onError: () => { toast({ title: "Sync failed", variant: "destructive" }); },
  });

  const { data: suggestions, refetch: refetchSuggestions } = useQuery<any[]>({
    queryKey: ["/api/portfolio", selectedPortfolio, "suggestions"],
    queryFn: async () => {
      const r = await fetch("/api/portfolio/" + selectedPortfolio + "/suggestions", { credentials: "include" });
      return r.json();
    },
    enabled: !!selectedPortfolio,
  });

  const generateSuggestions = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/portfolio/" + selectedPortfolio + "/generate-suggestions");
      return r.json();
    },
    onSuccess: (data: any) => {
      refetchSuggestions();
      toast({ title: data.count + " suggestions generated" });
    },
  });

  const respondToSuggestion = useMutation({
    mutationFn: async ({ id, response }: { id: string; response: string }) => {
      await apiRequest("PATCH", "/api/suggestion/" + id + "/respond", { response });
    },
    onSuccess: () => { refetchSuggestions(); },
  });

  const { data: advisorRecs } = useQuery<any[]>({
    queryKey: ["/api/investor/recommendations-from-advisor"],
  });

  const toggleAction = useMutation({
    mutationFn: async ({ recId, idx }: { recId: string; idx: number }) => {
      const r = await apiRequest("PATCH", "/api/investor/recommendation/" + recId + "/action/" + idx);
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/investor/recommendations-from-advisor"] }); },
  });

  const { data: analytics } = useQuery<any>({
    queryKey: ["/api/portfolio", selectedPortfolio, "analytics"],
    queryFn: async () => {
      const r = await fetch("/api/portfolio/" + selectedPortfolio + "/analytics", { credentials: "include" });
      return r.json();
    },
    enabled: !!selectedPortfolio,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/portfolio", { name: newName, shareWithAdvisors });
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      setSelectedPortfolio(data.id);
      setShowCreate(false);
      toast({ title: "Portfolio created" });
    },
  });

  const addHoldingMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/portfolio/" + selectedPortfolio + "/holding", holdingForm);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio", selectedPortfolio, "holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio", selectedPortfolio, "analytics"] });
      setShowAddHolding(false);
      setHoldingForm({ assetType: "equity", name: "", symbol: "", quantity: "", avgBuyPrice: "", sector: "", premium: "", sumAssured: "", maturityDate: "", interestRate: "", policyNumber: "", provider: "" });
      toast({ title: "Holding added" });
    },
  });

  const deleteHolding = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", "/api/portfolio/holding/" + id); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio", selectedPortfolio, "holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio", selectedPortfolio, "analytics"] });
    },
  });

  const uploadCsv = async () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".csv,.xlsx,.xls";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]; if (!file) return;
      const fd = new FormData(); fd.append("file", file);
      try {
        const res = await fetch("/api/portfolio/" + selectedPortfolio + "/import-csv", { method: "POST", body: fd, credentials: "include" });
        const data = await res.json();
        if (data.success) {
          queryClient.invalidateQueries({ queryKey: ["/api/portfolio", selectedPortfolio, "holdings"] });
          queryClient.invalidateQueries({ queryKey: ["/api/portfolio", selectedPortfolio, "analytics"] });
          toast({ title: "CSV imported", description: data.imported + " holdings imported as " + data.assetType });
        } else {
          toast({ title: "Import failed", description: data.error, variant: "destructive" });
        }
      } catch { toast({ title: "Import failed", variant: "destructive" }); }
    };
    input.click();
  };

  const uploadPdf = async () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".pdf";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]; if (!file) return;
      const fd = new FormData(); fd.append("file", file);
      try {
        const res = await fetch("/api/portfolio/" + selectedPortfolio + "/import-pdf", { method: "POST", body: fd, credentials: "include" });
        const data = await res.json();
        if (data.success) {
          queryClient.invalidateQueries({ queryKey: ["/api/portfolio", selectedPortfolio, "holdings"] });
          queryClient.invalidateQueries({ queryKey: ["/api/portfolio", selectedPortfolio, "analytics"] });
          toast({ title: "CAS Statement Imported", description: data.imported + " funds imported from " + data.source + " statement" });
        } else {
          toast({ title: "Import failed", description: data.error, variant: "destructive" });
        }
      } catch(e) { toast({ title: "Import failed", variant: "destructive" }); }
    };
    input.click();
  };

  if (!user) { navigate("/login"); return null; }

  const fmtINR = (n: number) => "\u20B9" + Math.round(n).toLocaleString("en-IN");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-6xl mx-auto px-4 py-6 space-y-6 w-full">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold">My Portfolio</h1>
          <Button size="sm" onClick={() => setShowCreate(true)}><FolderPlus className="w-3 h-3 mr-1" /> New Portfolio</Button>
        </div>

        {isLoading ? (
          <div className="text-center py-10"><Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" /></div>
        ) : !portfolios?.length ? (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <PieChart className="w-12 h-12 mx-auto text-muted-foreground/50" />
              <h3 className="text-lg font-semibold">No Portfolios Yet</h3>
              <p className="text-sm text-muted-foreground">Create a portfolio and add your stock and mutual fund holdings for analysis.</p>
              <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1" /> Create Portfolio</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {!selectedPortfolio ? (
              <div className="grid gap-4 md:grid-cols-2">
                {portfolios.map((p: any) => (
                  <Card key={p.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedPortfolio(p.id)}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">{p.name}</h3>
                        <Badge variant="secondary" className="text-xs">{p.holding_count || 0} holdings</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">Invested: {fmtINR(Number(p.total_invested || 0))}</span>
                        <span className="text-muted-foreground">Current: {fmtINR(Number(p.total_current || 0))}</span>
                      </div>
                      {p.share_with_advisors && <Badge variant="outline" className="text-[10px]">Shared with advisors</Badge>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedPortfolio(null)}>&larr; All Portfolios</Button>
                  <h2 className="text-lg font-semibold flex-1">{portfolios.find((p: any) => p.id === selectedPortfolio)?.name || "Portfolio"}</h2>
                  <Button variant="outline" size="sm" onClick={() => syncPrices.mutate()} disabled={syncPrices.isPending}>
                    {syncPrices.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <TrendingUp className="w-3 h-3 mr-1" />} Sync Prices
                  </Button>
                  <Button variant="outline" size="sm" onClick={uploadCsv}><Upload className="w-3 h-3 mr-1" /> Import CSV</Button>
                  <Button variant="outline" size="sm" onClick={uploadPdf}><Upload className="w-3 h-3 mr-1" /> Import CAS PDF</Button>
                  <Button size="sm" onClick={() => setShowAddHolding(true)}><Plus className="w-3 h-3 mr-1" /> Add Holding</Button>
                </div>

                {analytics && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card><CardContent className="p-3 text-center">
                      <p className="text-xs text-muted-foreground">Total Invested</p>
                      <p className="text-lg font-bold">{fmtINR(analytics.summary.totalInvested)}</p>
                    </CardContent></Card>
                    <Card><CardContent className="p-3 text-center">
                      <p className="text-xs text-muted-foreground">Current Value</p>
                      <p className="text-lg font-bold">{fmtINR(analytics.summary.totalCurrent)}</p>
                    </CardContent></Card>
                    <Card><CardContent className="p-3 text-center">
                      <p className="text-xs text-muted-foreground">P&L</p>
                      <p className={"text-lg font-bold " + (analytics.summary.totalGainLoss >= 0 ? "text-green-600" : "text-red-600")}>
                        {analytics.summary.totalGainLoss >= 0 ? "+" : ""}{fmtINR(analytics.summary.totalGainLoss)}
                      </p>
                    </CardContent></Card>
                    <Card><CardContent className="p-3 text-center">
                      <p className="text-xs text-muted-foreground">Returns</p>
                      <p className={"text-lg font-bold " + (analytics.summary.totalGainLossPercent >= 0 ? "text-green-600" : "text-red-600")}>
                        {analytics.summary.totalGainLossPercent >= 0 ? "+" : ""}{analytics.summary.totalGainLossPercent.toFixed(2)}%
                      </p>
                    </CardContent></Card>
                  </div>
                )}

                {analytics && (
                  <div className="grid md:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Asset Allocation</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        {Object.entries(analytics.assetAllocation).map(([type, value]: any) => {
                          const total = analytics.summary.totalCurrent || analytics.summary.totalInvested || 1;
                          const pct = (value / total * 100).toFixed(1);
                          return (
                            <div key={type} className="flex items-center justify-between text-sm">
                              <span className="capitalize">{type.replace("_", " ")}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                                  <div className="h-full rounded-full bg-blue-500" style={{ width: pct + "%" }} />
                                </div>
                                <span className="text-xs w-12 text-right">{pct}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Quick Stats</CardTitle></CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">Holdings</span><span className="font-medium">{analytics.summary.totalHoldings}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Stocks</span><span className="font-medium">{analytics.summary.equityCount}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Mutual Funds</span><span className="font-medium">{analytics.summary.mfCount}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Winners</span><span className="font-medium text-green-600">{analytics.summary.winners}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Losers</span><span className="font-medium text-red-600">{analytics.summary.losers}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Top 5 Concentration</span><span className="font-medium">{analytics.concentrationRisk.toFixed(1)}%</span></div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Suggestions ({suggestions?.length || 0})</CardTitle>
                      <Button variant="outline" size="sm" onClick={() => generateSuggestions.mutate()} disabled={generateSuggestions.isPending}>
                        {generateSuggestions.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <TrendingUp className="w-3 h-3 mr-1" />}
                        Analyze
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {!suggestions?.length ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Click Analyze to generate portfolio suggestions based on your holdings.</p>
                    ) : (
                      <div className="space-y-3">
                        {suggestions.map((s: any) => (
                          <div key={s.id} className={"p-3 rounded-md border " + (s.priority === "high" ? "border-red-200 bg-red-50 dark:bg-red-950/10" : s.priority === "medium" ? "border-amber-200 bg-amber-50 dark:bg-amber-950/10" : "border-gray-200")}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium">{s.title}</p>
                                  <Badge variant="secondary" className={"text-[10px] " + (s.priority === "high" ? "bg-red-100 text-red-700" : s.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600")}>{s.priority}</Badge>
                                  {s.advisor_approved && <Badge className="text-[10px] bg-green-100 text-green-700">Advisor Approved</Badge>}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                                {s.advisor_notes && <p className="text-xs mt-1 italic text-blue-600">Advisor: {s.advisor_notes}</p>}
                              </div>
                              {s.status === "pending" && (
                                <div className="flex gap-1 shrink-0">
                                  <Button variant="outline" size="sm" className="h-7 text-xs text-green-600" onClick={() => respondToSuggestion.mutate({ id: s.id, response: "accepted" })}>Accept</Button>
                                  <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500" onClick={() => respondToSuggestion.mutate({ id: s.id, response: "rejected" })}>Reject</Button>
                                </div>
                              )}
                              {s.status !== "pending" && (
                                <Badge variant="secondary" className={"text-[10px] " + (s.status === "accepted" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>{s.status}</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {advisorRecs && advisorRecs.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Advisor Recommendations ({advisorRecs.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {advisorRecs.map((rec: any) => (
                        <div key={rec.id} className="p-3 rounded-md border space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">{rec.title}</p>
                              <p className="text-xs text-muted-foreground">From: {rec.advisor_company || rec.advisor_name}</p>
                            </div>
                            <Badge variant="secondary" className={"text-[10px] " + (rec.status === "completed" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700")}>{rec.status}</Badge>
                          </div>
                          {rec.summary && <p className="text-xs text-muted-foreground">{rec.summary}</p>}
                          {rec.actions?.length > 0 && (
                            <div className="space-y-1">
                              {rec.actions.map((a: any, i: number) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                  <button onClick={() => toggleAction.mutate({ recId: rec.id, idx: i })} className={"w-4 h-4 rounded border flex items-center justify-center shrink-0 " + (a.done ? "bg-green-500 border-green-500 text-white" : "border-gray-300")}>
                                    {a.done && "✓"}
                                  </button>
                                  <span className={a.done ? "line-through text-muted-foreground" : ""}>{a.action}: {a.name} {a.details ? "- " + a.details : ""}</span>
                                  {a.priority && <Badge variant="outline" className="text-[9px]">{a.priority}</Badge>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {analytics?.deepAnalysisLinks && (
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm font-medium mb-2">Deep Analysis Tools</p>
                      <div className="flex gap-3">
                        <a href={analytics.deepAnalysisLinks.stocks} target="_blank" rel="noopener">
                          <Button variant="outline" size="sm"><BarChart3 className="w-3 h-3 mr-1" /> Stock Analyzer <ExternalLink className="w-3 h-3 ml-1" /></Button>
                        </a>
                        <a href={analytics.deepAnalysisLinks.mf} target="_blank" rel="noopener">
                          <Button variant="outline" size="sm"><PieChart className="w-3 h-3 mr-1" /> MF Analyzer <ExternalLink className="w-3 h-3 ml-1" /></Button>
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Import Templates</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground mb-3">Download a sample CSV template, fill in your holdings, and upload to import your portfolio.</p>
                    <div className="flex gap-2 flex-wrap">
                      <a href="/api/portfolio/templates/stocks" download><Button variant="outline" size="sm" className="text-xs"><Download className="w-3 h-3 mr-1" /> Stocks Template</Button></a>
                      <a href="/api/portfolio/templates/mutual_funds" download><Button variant="outline" size="sm" className="text-xs"><Download className="w-3 h-3 mr-1" /> Mutual Funds Template</Button></a>
                      <a href="/api/portfolio/templates/combined" download><Button variant="outline" size="sm" className="text-xs"><Download className="w-3 h-3 mr-1" /> Combined Template</Button></a>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">Supported: CSV files and CAMS/KFintech/NSDL CAS PDF statements.</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Holdings ({holdings?.length || 0})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!holdings?.length ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No holdings yet. Add manually or import a CSV.</p>
                    ) : (
                      <div className="divide-y">
                        {holdings.map((h: any) => (
                          <div key={h.id} className="flex items-center justify-between py-2.5 gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium truncate">{h.name}</p>
                                <Badge variant="secondary" className="text-[10px] capitalize">{h.asset_type?.replace("_", " ")}</Badge>
                              </div>
                              <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                                {h.symbol && <span>{h.symbol}</span>}
                                <span>Qty: {h.quantity}</span>
                                <span>Avg: {fmtINR(Number(h.avg_buy_price || 0))}</span>
                                {h.sector && <span>{h.sector}</span>}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-medium">{fmtINR(Number(h.invested_value || 0))}</p>
                              {Number(h.gain_loss || 0) !== 0 && (
                                <p className={"text-xs " + (Number(h.gain_loss) >= 0 ? "text-green-600" : "text-red-600")}>
                                  {Number(h.gain_loss) >= 0 ? "+" : ""}{Number(h.gain_loss_percent || 0).toFixed(1)}%
                                </p>
                              )}
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => deleteHolding.mutate(h.id)}><Trash2 className="w-3 h-3 text-red-400" /></Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Portfolio</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1"><Label>Portfolio Name</Label><Input value={newName} onChange={e => setNewName(e.target.value)} /></div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Share with advisors</Label>
                <p className="text-xs text-muted-foreground">Let your subscribed advisors view this portfolio</p>
              </div>
              <Switch checked={shareWithAdvisors} onCheckedChange={setShareWithAdvisors} />
            </div>
            <Button className="w-full" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddHolding} onOpenChange={setShowAddHolding}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Holding</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm">Type</Label>
              <select value={holdingForm.assetType} onChange={e => setHoldingForm({...holdingForm, assetType: e.target.value})} className="w-full p-2 rounded-md border text-sm bg-background">
                <option value="equity">Stock / Equity</option>
                <option value="mutual_fund">Mutual Fund</option>
                <option value="elss">ELSS (Tax Saver)</option>
                <option value="fd">Fixed Deposit</option>
                <option value="ppf">PPF</option>
                <option value="nps">NPS</option>
                <option value="epf">EPF</option>
                <option value="gold">Gold (Physical/Digital/SGB)</option>
                <option value="insurance_term">Term Insurance</option>
                <option value="insurance_medical">Health Insurance</option>
                <option value="ulip">ULIP</option>
                <option value="debt">Debt / Bond</option>
                <option value="real_estate">Real Estate</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1"><Label className="text-sm">Name</Label><Input value={holdingForm.name} onChange={e => setHoldingForm({...holdingForm, name: e.target.value})} placeholder={holdingForm.assetType.includes("insurance") ? "e.g. LIC Term Plan" : holdingForm.assetType === "fd" ? "e.g. SBI FD 2025" : "e.g. HDFC Bank"} /></div>
            <div className="space-y-1"><Label className="text-sm">Provider / Institution</Label><Input value={holdingForm.provider} onChange={e => setHoldingForm({...holdingForm, provider: e.target.value})} placeholder="e.g. HDFC, SBI, LIC, ICICI" /></div>
            {["equity", "mutual_fund", "elss", "gold", "debt", "ulip"].includes(holdingForm.assetType) && (
              <>
                <div className="space-y-1"><Label className="text-sm">Symbol (optional)</Label><Input value={holdingForm.symbol} onChange={e => setHoldingForm({...holdingForm, symbol: e.target.value})} placeholder="e.g. HDFCBANK" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-sm">Quantity / Units</Label><Input type="number" value={holdingForm.quantity} onChange={e => setHoldingForm({...holdingForm, quantity: e.target.value})} /></div>
                  <div className="space-y-1"><Label className="text-sm">Avg Buy Price / NAV</Label><Input type="number" value={holdingForm.avgBuyPrice} onChange={e => setHoldingForm({...holdingForm, avgBuyPrice: e.target.value})} /></div>
                </div>
              </>
            )}
            {["fd", "ppf", "nps", "epf"].includes(holdingForm.assetType) && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-sm">Invested Amount</Label><Input type="number" value={holdingForm.avgBuyPrice} onChange={e => setHoldingForm({...holdingForm, avgBuyPrice: e.target.value, quantity: "1"})} placeholder="Total amount" /></div>
                  <div className="space-y-1"><Label className="text-sm">Interest Rate (%)</Label><Input type="number" value={holdingForm.interestRate} onChange={e => setHoldingForm({...holdingForm, interestRate: e.target.value})} placeholder="e.g. 7.1" /></div>
                </div>
                <div className="space-y-1"><Label className="text-sm">Maturity Date</Label><Input type="date" value={holdingForm.maturityDate} onChange={e => setHoldingForm({...holdingForm, maturityDate: e.target.value})} /></div>
              </>
            )}
            {holdingForm.assetType.includes("insurance") && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-sm">Annual Premium</Label><Input type="number" value={holdingForm.premium} onChange={e => setHoldingForm({...holdingForm, premium: e.target.value, quantity: "1", avgBuyPrice: e.target.value})} /></div>
                  <div className="space-y-1"><Label className="text-sm">Sum Assured / Coverage</Label><Input type="number" value={holdingForm.sumAssured} onChange={e => setHoldingForm({...holdingForm, sumAssured: e.target.value})} /></div>
                </div>
                <div className="space-y-1"><Label className="text-sm">Policy Number</Label><Input value={holdingForm.policyNumber} onChange={e => setHoldingForm({...holdingForm, policyNumber: e.target.value})} /></div>
              </>
            )}
            {holdingForm.assetType === "real_estate" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-sm">Purchase Price</Label><Input type="number" value={holdingForm.avgBuyPrice} onChange={e => setHoldingForm({...holdingForm, avgBuyPrice: e.target.value, quantity: "1"})} /></div>
                <div className="space-y-1"><Label className="text-sm">Current Estimate</Label><Input type="number" value={holdingForm.quantity} onChange={e => setHoldingForm({...holdingForm, quantity: e.target.value})} placeholder="Current market value" /></div>
              </div>
            )}
            {["equity", "mutual_fund"].includes(holdingForm.assetType) && (
              <div className="space-y-1"><Label className="text-sm">Sector (optional)</Label><Input value={holdingForm.sector} onChange={e => setHoldingForm({...holdingForm, sector: e.target.value})} placeholder="e.g. Banking, IT" /></div>
            )}
            <Button className="w-full" onClick={() => addHoldingMutation.mutate()} disabled={addHoldingMutation.isPending || !holdingForm.name}>
              {addHoldingMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Add Holding
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}
