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
import {
  Save, RefreshCw, IndianRupee, Search, BarChart3, PieChart,
  Shield, Users, Receipt,
} from "lucide-react";

interface ProductConfig {
  enabled: boolean;
  label: string;
  freeTierLimit?: number;
  freeTierPeriod?: string;
  proPrice: number;
  proPeriod: string;
  enterprisePrice?: number;
  quarterlyPrice?: number;
  freeFeatures?: string;
  freeClients?: number;
  freeStrategies?: number;
}

interface OnboardingConfig {
  ekycCost: number;
  esignCost: number;
  pmlaCost: number;
  strategy: string;
}

interface MonetizationConfig {
  dyor: ProductConfig;
  stockAnalyzer: ProductConfig;
  mfAnalyzer: ProductConfig;
  portfolioTool: ProductConfig;
  advisorPlatform: ProductConfig;
  onboarding: OnboardingConfig;
}

const DEFAULT_CONFIG: MonetizationConfig = {
  dyor: { enabled: true, freeTierLimit: 5, freeTierPeriod: "month", proPrice: 299, proPeriod: "month", enterprisePrice: 0, label: "DYOR Research Tool" },
  stockAnalyzer: { enabled: true, freeTierLimit: 3, freeTierPeriod: "month", proPrice: 499, proPeriod: "month", label: "Stock Analyzer (AlphaLens)" },
  mfAnalyzer: { enabled: true, freeTierLimit: 2, freeTierPeriod: "month", proPrice: 399, proPeriod: "month", label: "MF Analyzer" },
  portfolioTool: { enabled: true, freeFeatures: "Basic portfolio view + sync", proPrice: 499, proPeriod: "month", quarterlyPrice: 1999, label: "Portfolio Evaluation Tool" },
  advisorPlatform: { enabled: true, freeClients: 10, freeStrategies: 1, proPrice: 2999, proPeriod: "month", label: "Advisor Platform" },
  onboarding: { ekycCost: 10, esignCost: 15, pmlaCost: 3, strategy: "absorb" },
};

function ProductCard({
  icon, config, productKey, onChange,
}: {
  icon: React.ReactNode;
  config: ProductConfig;
  productKey: string;
  onChange: (key: string, field: string, value: any) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            {icon}
            {config.label}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={config.enabled ? "default" : "secondary"} className="text-[10px]">
              {config.enabled ? "Active" : "Disabled"}
            </Badge>
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => onChange(productKey, "enabled", v)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {config.freeTierLimit !== undefined && (
            <div className="space-y-1">
              <Label className="text-xs">Free Tier Limit</Label>
              <Input
                type="number"
                min="0"
                value={config.freeTierLimit}
                onChange={(e) => onChange(productKey, "freeTierLimit", Number(e.target.value))}
                className="h-8 text-sm"
              />
            </div>
          )}
          {config.freeTierPeriod !== undefined && (
            <div className="space-y-1">
              <Label className="text-xs">Free Period</Label>
              <Select value={config.freeTierPeriod} onValueChange={(v) => onChange(productKey, "freeTierPeriod", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Per Day</SelectItem>
                  <SelectItem value="week">Per Week</SelectItem>
                  <SelectItem value="month">Per Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {config.freeClients !== undefined && (
            <div className="space-y-1">
              <Label className="text-xs">Free Clients</Label>
              <Input
                type="number"
                min="0"
                value={config.freeClients}
                onChange={(e) => onChange(productKey, "freeClients", Number(e.target.value))}
                className="h-8 text-sm"
              />
            </div>
          )}
          {config.freeStrategies !== undefined && (
            <div className="space-y-1">
              <Label className="text-xs">Free Strategies</Label>
              <Input
                type="number"
                min="0"
                value={config.freeStrategies}
                onChange={(e) => onChange(productKey, "freeStrategies", Number(e.target.value))}
                className="h-8 text-sm"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Pro Price (Rs)</Label>
            <Input
              type="number"
              min="0"
              value={config.proPrice}
              onChange={(e) => onChange(productKey, "proPrice", Number(e.target.value))}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pro Period</Label>
            <Select value={config.proPeriod} onValueChange={(v) => onChange(productKey, "proPeriod", v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Monthly</SelectItem>
                <SelectItem value="quarter">Quarterly</SelectItem>
                <SelectItem value="year">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {config.quarterlyPrice !== undefined && (
            <div className="space-y-1">
              <Label className="text-xs">Quarterly Price (Rs)</Label>
              <Input
                type="number"
                min="0"
                value={config.quarterlyPrice}
                onChange={(e) => onChange(productKey, "quarterlyPrice", Number(e.target.value))}
                className="h-8 text-sm"
              />
            </div>
          )}
        </div>
        {config.freeFeatures !== undefined && (
          <div className="space-y-1">
            <Label className="text-xs">Free Tier Features</Label>
            <Input
              value={config.freeFeatures}
              onChange={(e) => onChange(productKey, "freeFeatures", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminMonetization() {
  const { toast } = useToast();
  const [config, setConfig] = useState<MonetizationConfig>(DEFAULT_CONFIG);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: savedConfig, isLoading } = useQuery<MonetizationConfig | null>({
    queryKey: ["/api/admin/monetization-config"],
  });

  useEffect(() => {
    if (savedConfig) {
      setConfig({ ...DEFAULT_CONFIG, ...savedConfig });
    }
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
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleChange = (productKey: string, field: string, value: any) => {
    setConfig((prev) => ({
      ...prev,
      [productKey]: { ...(prev as any)[productKey], [field]: value },
    }));
    setHasChanges(true);
  };

  const handleOnboardingChange = (field: string, value: any) => {
    setConfig((prev) => ({
      ...prev,
      onboarding: { ...prev.onboarding, [field]: value },
    }));
    setHasChanges(true);
  };

  const totalOnboarding = config.onboarding.ekycCost + config.onboarding.esignCost + config.onboarding.pmlaCost;

  // Revenue projections
  const projections = [
    { product: config.dyor.label, users: 1000, price: config.dyor.proPrice, total: 1000 * config.dyor.proPrice },
    { product: config.stockAnalyzer.label, users: 500, price: config.stockAnalyzer.proPrice, total: 500 * config.stockAnalyzer.proPrice },
    { product: config.mfAnalyzer.label, users: 300, price: config.mfAnalyzer.proPrice, total: 300 * config.mfAnalyzer.proPrice },
    { product: config.portfolioTool.label, users: 500, price: config.portfolioTool.proPrice, total: 500 * config.portfolioTool.proPrice },
    { product: config.advisorPlatform.label, users: 100, price: config.advisorPlatform.proPrice, total: 100 * config.advisorPlatform.proPrice },
  ];
  const totalProjectedRevenue = projections.reduce((s, p) => s + p.total, 0);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-4xl">
        <h2 className="text-xl font-semibold">Monetization Settings</h2>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Monetization Settings</h2>
          <p className="text-sm text-muted-foreground mt-1">Configure pricing, free tiers, and revenue models for all products</p>
          <p className="text-xs text-muted-foreground mt-1">
            <strong>Free Tier Limit:</strong> Number of free analyses/uses a non-paying user gets per period (day/week/month). After this limit, users must upgrade to Pro to continue using the tool. Set to 0 to disable free access entirely.
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
        >
          {saveMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
          Save Changes
        </Button>
      </div>

      <div className="space-y-4">
        <ProductCard
          icon={<Search className="w-4 h-4 text-blue-500" />}
          config={config.dyor}
          productKey="dyor"
          onChange={handleChange}
        />
        <ProductCard
          icon={<BarChart3 className="w-4 h-4 text-teal-500" />}
          config={config.stockAnalyzer}
          productKey="stockAnalyzer"
          onChange={handleChange}
        />
        <ProductCard
          icon={<PieChart className="w-4 h-4 text-purple-500" />}
          config={config.mfAnalyzer}
          productKey="mfAnalyzer"
          onChange={handleChange}
        />
        <ProductCard
          icon={<BarChart3 className="w-4 h-4 text-green-500" />}
          config={config.portfolioTool}
          productKey="portfolioTool"
          onChange={handleChange}
        />
        <ProductCard
          icon={<Shield className="w-4 h-4 text-amber-500" />}
          config={config.advisorPlatform}
          productKey="advisorPlatform"
          onChange={handleChange}
        />
      </div>

      <Separator />

      {/* Onboarding Costs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Receipt className="w-4 h-4 text-rose-500" />
            Client Onboarding Costs
          </CardTitle>
          <CardDescription className="text-xs">EKYC, Esigning, and PMLA verification costs per client</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">eKYC Cost (Rs)</Label>
              <Input
                type="number"
                min="0"
                value={config.onboarding.ekycCost}
                onChange={(e) => handleOnboardingChange("ekycCost", Number(e.target.value))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">eSigning Cost (Rs)</Label>
              <Input
                type="number"
                min="0"
                value={config.onboarding.esignCost}
                onChange={(e) => handleOnboardingChange("esignCost", Number(e.target.value))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">PMLA Cost (Rs)</Label>
              <Input
                type="number"
                min="0"
                value={config.onboarding.pmlaCost}
                onChange={(e) => handleOnboardingChange("pmlaCost", Number(e.target.value))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cost Strategy</Label>
              <Select value={config.onboarding.strategy} onValueChange={(v) => handleOnboardingChange("strategy", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="absorb">Absorb (Platform pays)</SelectItem>
                  <SelectItem value="pass_to_advisor">Pass to Advisor</SelectItem>
                  <SelectItem value="pass_to_investor">Pass to Investor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Total onboarding cost per client: <span className="font-semibold text-foreground">Rs {totalOnboarding}</span>
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* Revenue Projections */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <IndianRupee className="w-4 h-4 text-emerald-500" />
            Revenue Projections (Monthly Estimate)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {projections.map((p) => (
              <div key={p.product} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{p.product}</span>
                <span>
                  <span className="text-xs text-muted-foreground">{p.users} users x Rs {p.price} = </span>
                  <span className="font-semibold">Rs {(p.total / 100000).toFixed(2)}L</span>
                </span>
              </div>
            ))}
            <Separator className="my-2" />
            <div className="flex items-center justify-between text-sm font-bold">
              <span>Total Projected Revenue</span>
              <span className="text-green-600">Rs {(totalProjectedRevenue / 100000).toFixed(2)}L/month</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
