import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, ShieldCheck } from "lucide-react";
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
      </Tabs>
    </div>
  );
}
