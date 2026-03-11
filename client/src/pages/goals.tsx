import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Target, Plus, Trash2, Loader2, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";

const GOAL_TYPES = [
  { value: "retirement", label: "Retirement", icon: "🏖️", defaultTarget: 50000000, defaultHorizon: 25 },
  { value: "education", label: "Child's Education", icon: "🎓", defaultTarget: 5000000, defaultHorizon: 15 },
  { value: "house", label: "House Purchase", icon: "🏠", defaultTarget: 10000000, defaultHorizon: 7 },
  { value: "emergency", label: "Emergency Fund", icon: "🛡️", defaultTarget: 500000, defaultHorizon: 1 },
  { value: "wealth", label: "Wealth Building", icon: "📈", defaultTarget: 10000000, defaultHorizon: 10 },
  { value: "vacation", label: "Vacation / Travel", icon: "✈️", defaultTarget: 500000, defaultHorizon: 2 },
  { value: "car", label: "Car Purchase", icon: "🚗", defaultTarget: 1500000, defaultHorizon: 3 },
  { value: "wedding", label: "Wedding", icon: "💍", defaultTarget: 3000000, defaultHorizon: 5 },
  { value: "custom", label: "Custom Goal", icon: "🎯", defaultTarget: 1000000, defaultHorizon: 5 },
];

export default function GoalsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "", goalType: "retirement", targetAmount: "5000000", currentAmount: "0",
    horizonYears: "25", monthlySip: "10000", inflationRate: "6", expectedReturn: "12", priority: "medium", notes: "",
  });

  const { data: goals, isLoading } = useQuery<any[]>({ queryKey: ["/api/goals"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/goals", {
        ...form,
        targetAmount: Number(form.targetAmount),
        currentAmount: Number(form.currentAmount),
        horizonYears: Number(form.horizonYears),
        monthlySip: Number(form.monthlySip),
        inflationRate: Number(form.inflationRate),
        expectedReturn: Number(form.expectedReturn),
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      setShowCreate(false);
      toast({ title: "Goal created" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", "/api/goals/" + id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/goals"] }); },
  });

  const selectGoalType = (type: string) => {
    const gt = GOAL_TYPES.find(g => g.value === type);
    if (gt) {
      setForm({ ...form, goalType: type, name: gt.label, targetAmount: String(gt.defaultTarget), horizonYears: String(gt.defaultHorizon) });
    }
  };

  if (!user) { navigate("/login"); return null; }

  const fmtINR = (n: number) => "\u20B9" + Math.round(n).toLocaleString("en-IN");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-5xl mx-auto px-4 py-6 space-y-6 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Financial Goals</h1>
            <p className="text-sm text-muted-foreground">Plan and track your financial milestones</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="w-3 h-3 mr-1" /> New Goal</Button>
        </div>

        {isLoading ? (
          <div className="text-center py-10"><Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" /></div>
        ) : !goals?.length ? (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <Target className="w-12 h-12 mx-auto text-muted-foreground/50" />
              <h3 className="text-lg font-semibold">No Goals Yet</h3>
              <p className="text-sm text-muted-foreground">Set financial goals like retirement, education, or house purchase and track your progress.</p>
              <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1" /> Create Your First Goal</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {goals.map((g: any) => {
              const gt = GOAL_TYPES.find(t => t.value === g.goal_type);
              return (
                <Card key={g.id} className={g.onTrack ? "border-green-200" : "border-amber-200"}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xl">{gt?.icon || "🎯"}</span>
                          <h3 className="font-semibold text-lg">{g.name}</h3>
                          <Badge variant="secondary" className={"text-[10px] " + (g.onTrack ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                            {g.onTrack ? "On Track" : "Needs Attention"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">{g.priority}</Badge>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">Target</p>
                            <p className="text-sm font-bold">{fmtINR(Number(g.target_amount))}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">Current</p>
                            <p className="text-sm font-bold">{fmtINR(Number(g.current_amount || 0))}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">Projected</p>
                            <p className="text-sm font-bold text-blue-600">{fmtINR(g.projectedValue)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">Horizon</p>
                            <p className="text-sm font-bold">{g.horizon_years} years</p>
                          </div>
                        </div>

                        <div className="w-full h-3 rounded-full bg-muted overflow-hidden mb-2">
                          <div className={"h-full rounded-full transition-all " + (g.probability >= 70 ? "bg-green-500" : g.probability >= 40 ? "bg-amber-500" : "bg-red-500")}
                            style={{ width: Math.min(100, g.probability) + "%" }} />
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Probability: <strong className={g.probability >= 70 ? "text-green-600" : "text-amber-600"}>{g.probability}%</strong></span>
                          <span>Monthly SIP: <strong>{fmtINR(Number(g.monthly_sip || 0))}</strong></span>
                          {g.gap > 0 && (
                            <span className="text-amber-600">Gap: {fmtINR(g.gap)} | Need extra SIP of {fmtINR(g.additionalSIPNeeded)}/mo</span>
                          )}
                        </div>

                        <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                          <span>Inflation: {g.inflation_rate}%</span>
                          <span>Expected Return: {g.expected_return}%</span>
                          <span>Inflation-Adjusted Target: {fmtINR(g.inflationAdjustedTarget)}</span>
                        </div>
                      </div>

                      <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(g.id)}>
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Financial Goal</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm mb-2 block">Goal Type</Label>
              <div className="grid grid-cols-3 gap-2">
                {GOAL_TYPES.map(gt => (
                  <button key={gt.value} onClick={() => selectGoalType(gt.value)}
                    className={"p-2 rounded-md border text-center text-xs transition-colors " + (form.goalType === gt.value ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted")}>
                    <span className="text-lg block">{gt.icon}</span>
                    {gt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1"><Label className="text-sm">Goal Name</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-sm">Target Amount</Label><Input type="number" value={form.targetAmount} onChange={e => setForm({...form, targetAmount: e.target.value})} /></div>
              <div className="space-y-1"><Label className="text-sm">Current Saved</Label><Input type="number" value={form.currentAmount} onChange={e => setForm({...form, currentAmount: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-sm">Time Horizon (years)</Label><Input type="number" value={form.horizonYears} onChange={e => setForm({...form, horizonYears: e.target.value})} /></div>
              <div className="space-y-1"><Label className="text-sm">Monthly SIP</Label><Input type="number" value={form.monthlySip} onChange={e => setForm({...form, monthlySip: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-sm">Expected Return (%)</Label><Input type="number" value={form.expectedReturn} onChange={e => setForm({...form, expectedReturn: e.target.value})} /></div>
              <div className="space-y-1"><Label className="text-sm">Inflation (%)</Label><Input type="number" value={form.inflationRate} onChange={e => setForm({...form, inflationRate: e.target.value})} /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Priority</Label>
              <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})} className="w-full p-2 rounded-md border text-sm bg-background">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="space-y-1"><Label className="text-sm">Notes (optional)</Label><Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Any additional context" /></div>
            <Button className="w-full" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name || !form.targetAmount}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Target className="w-4 h-4 mr-1" />}
              Create Goal
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}
