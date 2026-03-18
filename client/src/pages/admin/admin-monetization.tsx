import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Save, RefreshCw, IndianRupee, Search, BarChart3, PieChart,
  Shield, Users, Receipt, Tag, Plus, Trash2, Eye, EyeOff,
} from "lucide-react";

// ── Pricing Tab ──────────────────────────────────────────────────
function PricingTab({ config, setConfig, hasChanges, setHasChanges, saveMutation }: any) {
  const handleChange = (section: string, field: string, value: any) => {
    setConfig((prev: any) => ({
      ...prev,
      [section]: { ...(prev[section] || {}), [field]: value },
    }));
    setHasChanges(true);
  };

  const handleOnboardingChange = (field: string, value: any) => {
    setConfig((prev: any) => ({
      ...prev,
      onboarding: { ...prev.onboarding, [field]: value },
    }));
    setHasChanges(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Configure pricing, free tiers, trials, and revenue models</p>
        <Button onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending} size="sm">
          <Save className="w-4 h-4 mr-2" />{saveMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {/* DYOR */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Search className="w-4 h-4" /> DYOR Research Tool</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={config.dyor?.enabled ? "default" : "secondary"} className="text-[10px]">
                {config.dyor?.enabled ? "Active" : "Disabled"}
              </Badge>
              <Switch checked={config.dyor?.enabled ?? true} onCheckedChange={(v) => handleChange("dyor", "enabled", v)} />
            </div>
          </div>
          <CardDescription>Free for approved advisors. Investors get a trial, then monthly subscription.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Trial Days (Investors)</Label>
              <Input type="number" value={config.dyor?.trialDays ?? 10} onChange={(e) => handleChange("dyor", "trialDays", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">Monthly Price (Rs)</Label>
              <Input type="number" value={config.dyor?.monthlyPrice ?? 4999} onChange={(e) => handleChange("dyor", "monthlyPrice", parseInt(e.target.value) || 0)} />
            </div>
            <div className="flex items-end">
              <div className="flex items-center gap-2 pb-2">
                <Switch checked={config.dyor?.freeForApprovedAdvisors ?? true} onCheckedChange={(v) => handleChange("dyor", "freeForApprovedAdvisors", v)} />
                <Label className="text-xs">Free for Approved Advisors</Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stock & MF Bundle */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Stock & MF Analyzer Bundle</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={config.stockMfBundle?.enabled ? "default" : "secondary"} className="text-[10px]">
                {config.stockMfBundle?.enabled ? "Active" : "Disabled"}
              </Badge>
              <Switch checked={config.stockMfBundle?.enabled ?? true} onCheckedChange={(v) => handleChange("stockMfBundle", "enabled", v)} />
            </div>
          </div>
          <CardDescription>Bundled Stock + MF Analyzer with included analyses and overage pricing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Monthly Price (Rs)</Label>
              <Input type="number" value={config.stockMfBundle?.monthlyPrice ?? 999} onChange={(e) => handleChange("stockMfBundle", "monthlyPrice", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">Included Analyses/Month</Label>
              <Input type="number" value={config.stockMfBundle?.includedAnalyses ?? 3} onChange={(e) => handleChange("stockMfBundle", "includedAnalyses", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">Additional Analysis Price (Rs)</Label>
              <Input type="number" value={config.stockMfBundle?.additionalAnalysisPrice ?? 499} onChange={(e) => handleChange("stockMfBundle", "additionalAnalysisPrice", parseInt(e.target.value) || 0)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Portfolio Tool */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><PieChart className="w-4 h-4" /> Portfolio Evaluation Tool</CardTitle>
            <Switch checked={config.portfolioTool?.enabled ?? true} onCheckedChange={(v) => handleChange("portfolioTool", "enabled", v)} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Monthly Price (Rs)</Label>
              <Input type="number" value={config.portfolioTool?.proPrice ?? 499} onChange={(e) => handleChange("portfolioTool", "proPrice", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">Quarterly Price (Rs)</Label>
              <Input type="number" value={config.portfolioTool?.quarterlyPrice ?? 1999} onChange={(e) => handleChange("portfolioTool", "quarterlyPrice", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">Free Features</Label>
              <Input value={config.portfolioTool?.freeFeatures ?? ""} onChange={(e) => handleChange("portfolioTool", "freeFeatures", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Advisor Platform */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" /> Advisor Platform</CardTitle>
            <Switch checked={config.advisorPlatform?.enabled ?? true} onCheckedChange={(v) => handleChange("advisorPlatform", "enabled", v)} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Monthly Price (Rs)</Label>
              <Input type="number" value={config.advisorPlatform?.proPrice ?? 2999} onChange={(e) => handleChange("advisorPlatform", "proPrice", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">Free Clients</Label>
              <Input type="number" value={config.advisorPlatform?.freeClients ?? 10} onChange={(e) => handleChange("advisorPlatform", "freeClients", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">Free Strategies</Label>
              <Input type="number" value={config.advisorPlatform?.freeStrategies ?? 1} onChange={(e) => handleChange("advisorPlatform", "freeStrategies", parseInt(e.target.value) || 0)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Onboarding Costs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Receipt className="w-4 h-4" /> Onboarding Costs (per investor)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">eKYC Cost (Rs)</Label>
              <Input type="number" value={config.onboarding?.ekycCost ?? 10} onChange={(e) => handleOnboardingChange("ekycCost", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">eSign Cost (Rs)</Label>
              <Input type="number" value={config.onboarding?.esignCost ?? 15} onChange={(e) => handleOnboardingChange("esignCost", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">PMLA Cost (Rs)</Label>
              <Input type="number" value={config.onboarding?.pmlaCost ?? 3} onChange={(e) => handleOnboardingChange("pmlaCost", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">Strategy</Label>
              <Select value={config.onboarding?.strategy ?? "absorb"} onValueChange={(v) => handleOnboardingChange("strategy", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="absorb">Absorb (Platform pays)</SelectItem>
                  <SelectItem value="pass_through">Pass-through (Investor pays)</SelectItem>
                  <SelectItem value="split">Split 50/50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Total per investor: Rs {(config.onboarding?.ekycCost || 0) + (config.onboarding?.esignCost || 0) + (config.onboarding?.pmlaCost || 0)}</p>
        </CardContent>
      </Card>

      {/* Revenue Projections */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><IndianRupee className="w-4 h-4" /> Monthly Revenue Projections</CardTitle></CardHeader>
        <CardContent>
          <div className="text-xs space-y-1">
            {[
              { name: "DYOR", users: 1000, price: config.dyor?.monthlyPrice || 4999 },
              { name: "Stock & MF Bundle", users: 500, price: config.stockMfBundle?.monthlyPrice || 999 },
              { name: "Portfolio Tool", users: 500, price: config.portfolioTool?.proPrice || 499 },
              { name: "Advisor Platform", users: 100, price: config.advisorPlatform?.proPrice || 2999 },
            ].map((p) => (
              <div key={p.name} className="flex justify-between py-1 border-b border-border/50">
                <span>{p.name} ({p.users} users x Rs {p.price})</span>
                <span className="font-mono">Rs {(p.users * p.price).toLocaleString("en-IN")}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 font-semibold">
              <span>Total Projected</span>
              <span className="font-mono">Rs {(1000*(config.dyor?.monthlyPrice||4999) + 500*(config.stockMfBundle?.monthlyPrice||999) + 500*(config.portfolioTool?.proPrice||499) + 100*(config.advisorPlatform?.proPrice||2999)).toLocaleString("en-IN")}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Coupons Tab ──────────────────────────────────────────────────
function CouponsTab() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: "", description: "", discountType: "percentage", discountValue: "", applicableTools: [] as string[], maxUses: "", minAmount: "", maxDiscount: "", validUntil: "" });

  const { data: coupons = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/coupons"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...form, discountValue: parseFloat(form.discountValue) || 0, maxUses: form.maxUses ? parseInt(form.maxUses) : null, minAmount: form.minAmount ? parseFloat(form.minAmount) : 0, maxDiscount: form.maxDiscount ? parseFloat(form.maxDiscount) : null, validUntil: form.validUntil || null };
      const res = await apiRequest("POST", "/api/admin/coupons", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/coupons"] });
      toast({ title: "Coupon created" });
      setShowCreate(false);
      setForm({ code: "", description: "", discountType: "percentage", discountValue: "", applicableTools: [], maxUses: "", minAmount: "", maxDiscount: "", validUntil: "" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiRequest("PUT", "/api/admin/coupons/" + id, { isActive });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/coupons"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", "/api/admin/coupons/" + id);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/coupons"] }); toast({ title: "Coupon deleted" }); },
  });

  const toolOptions = ["dyor", "stockMfBundle", "portfolioTool", "advisorPlatform"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage discount coupon codes</p>
        <Button onClick={() => setShowCreate(!showCreate)} size="sm"><Plus className="w-4 h-4 mr-2" /> New Coupon</Button>
      </div>

      {showCreate && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Code</Label>
                <Input placeholder="e.g. LAUNCH50" value={form.code} onChange={(e) => setForm({...form, code: e.target.value.toUpperCase()})} />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input placeholder="50% off launch offer" value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} />
              </div>
              <div>
                <Label className="text-xs">Discount Type</Label>
                <Select value={form.discountType} onValueChange={(v) => setForm({...form, discountType: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                    <SelectItem value="fixed">Fixed Amount (Rs)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Discount Value</Label>
                <Input type="number" placeholder={form.discountType === "percentage" ? "e.g. 50" : "e.g. 500"} value={form.discountValue} onChange={(e) => setForm({...form, discountValue: e.target.value})} />
              </div>
              <div>
                <Label className="text-xs">Max Uses</Label>
                <Input type="number" placeholder="Unlimited" value={form.maxUses} onChange={(e) => setForm({...form, maxUses: e.target.value})} />
              </div>
              <div>
                <Label className="text-xs">Max Discount (Rs)</Label>
                <Input type="number" placeholder="No cap" value={form.maxDiscount} onChange={(e) => setForm({...form, maxDiscount: e.target.value})} />
              </div>
              <div>
                <Label className="text-xs">Valid Until</Label>
                <Input type="date" value={form.validUntil} onChange={(e) => setForm({...form, validUntil: e.target.value})} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Applicable Tools (leave empty for all)</Label>
              <div className="flex gap-2 mt-1">
                {toolOptions.map((t) => (
                  <Badge key={t} variant={form.applicableTools.includes(t) ? "default" : "outline"} className="cursor-pointer text-xs"
                    onClick={() => setForm({...form, applicableTools: form.applicableTools.includes(t) ? form.applicableTools.filter((x) => x !== t) : [...form.applicableTools, t]})}>
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.code || !form.discountValue || createMutation.isPending} size="sm">
              {createMutation.isPending ? "Creating..." : "Create Coupon"}
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : coupons.length === 0 ? <p className="text-sm text-muted-foreground">No coupons yet</p> : (
        <div className="space-y-2">
          {coupons.map((c: any) => (
            <Card key={c.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Tag className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-sm">{c.code}</span>
                      <Badge variant={c.is_active ? "default" : "secondary"} className="text-[10px]">{c.is_active ? "Active" : "Disabled"}</Badge>
                      <Badge variant="outline" className="text-[10px]">{c.discount_type === "percentage" ? c.discount_value + "%" : "Rs " + c.discount_value}</Badge>
                      {c.max_discount && <Badge variant="outline" className="text-[10px]">Max Rs {c.max_discount}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {c.description || "No description"} &middot; Used {c.used_count}/{c.max_uses || "\u221e"} &middot; Tools: {(c.applicable_tools || []).join(", ") || "All"}
                      {c.valid_until && " \u00b7 Expires: " + new Date(c.valid_until).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => toggleMutation.mutate({ id: c.id, isActive: !c.is_active })}>
                    {c.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { if (confirm("Delete coupon " + c.code + "?")) deleteMutation.mutate(c.id); }}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Usage Stats Tab ──────────────────────────────────────────────
function UsageStatsTab() {
  const [days, setDays] = useState(30);
  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/usage-stats", days],
    queryFn: async () => { const res = await fetch("/api/admin/usage-stats?days=" + days, { credentials: "include" }); return res.json(); },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading usage stats...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Tool usage analytics and subscription revenue</p>
        <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v))}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        {(stats?.byTool || []).map((t: any) => (
          <Card key={t.tool}>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t.tool}</p>
              <p className="text-2xl font-bold">{t.total}</p>
              <p className="text-xs text-muted-foreground">{t.unique_users} unique users</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Subscription Revenue */}
      {stats?.subscriptions?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Subscription Revenue</CardTitle></CardHeader>
          <CardContent>
            <div className="text-xs space-y-1">
              {stats.subscriptions.map((s: any, i: number) => (
                <div key={i} className="flex justify-between py-1 border-b border-border/50">
                  <span>{s.tool} ({s.status})</span>
                  <span>{s.total} subs &middot; Rs {parseFloat(s.revenue || 0).toLocaleString("en-IN")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Users */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Top Users</CardTitle></CardHeader>
        <CardContent>
          <div className="text-xs space-y-1">
            {(stats?.topUsers || []).slice(0, 20).map((u: any, i: number) => (
              <div key={i} className="flex justify-between py-1 border-b border-border/50">
                <span>{u.username} ({u.email}) <Badge variant="outline" className="text-[10px] ml-1">{u.role}</Badge></span>
                <span>{u.tool}: {u.total} uses</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Daily Breakdown */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Daily Usage</CardTitle></CardHeader>
        <CardContent>
          <div className="text-xs space-y-1 max-h-60 overflow-y-auto">
            {(stats?.byDay || []).map((d: any, i: number) => (
              <div key={i} className="flex justify-between py-1 border-b border-border/50">
                <span>{d.day} &middot; {d.tool}</span>
                <span>{d.total} uses</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────
export default function AdminMonetization() {
  const { toast } = useToast();
  const [config, setConfig] = useState<any>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: savedConfig, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/monetization-config"],
  });

  useEffect(() => {
    if (savedConfig) setConfig(savedConfig);
  }, [savedConfig]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/monetization-config", config);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/monetization-config"] });
      toast({ title: "Saved", description: "Monetization config updated successfully." });
      setHasChanges(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-4 max-w-4xl"><h2 className="text-xl font-semibold">Monetization Settings</h2><p className="text-sm text-muted-foreground">Loading...</p></div>;

  return (
    <div className="space-y-4 max-w-4xl">
      <h2 className="text-xl font-semibold">Monetization Settings</h2>
      <Tabs defaultValue="pricing">
        <TabsList>
          <TabsTrigger value="pricing"><IndianRupee className="w-4 h-4 mr-1" /> Pricing</TabsTrigger>
          <TabsTrigger value="coupons"><Tag className="w-4 h-4 mr-1" /> Coupons</TabsTrigger>
          <TabsTrigger value="usage"><BarChart3 className="w-4 h-4 mr-1" /> Usage Stats</TabsTrigger>
        </TabsList>
        <TabsContent value="pricing"><PricingTab config={config} setConfig={setConfig} hasChanges={hasChanges} setHasChanges={setHasChanges} saveMutation={saveMutation} /></TabsContent>
        <TabsContent value="coupons"><CouponsTab /></TabsContent>
        <TabsContent value="usage"><UsageStatsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
