import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, MoreVertical, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type { Plan, Subscription } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";

export default function PlansPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showNew, setShowNew] = useState(false);
  const [activeTab, setActiveTab] = useState("plans");

  const { data: plans, isLoading } = useQuery<Plan[]>({
    queryKey: ["/api/advisor/plans"],
  });

  const { data: subscriptions } = useQuery<(Subscription & { plan?: Plan })[]>({
    queryKey: ["/api/advisor/subscriptions"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/plans", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/plans"] });
      setShowNew(false);
      toast({ title: "Plan created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/plans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/plans"] });
      toast({ title: "Plan deleted" });
    },
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList>
            <TabsTrigger value="plans" data-testid="tab-plans">Plans</TabsTrigger>
            <TabsTrigger value="subscribers" data-testid="tab-subscribers">Subscribed Users</TabsTrigger>
          </TabsList>
          <Button onClick={() => setShowNew(true)} data-testid="button-add-plan">
            <Plus className="w-4 h-4 mr-1" /> Add New Plan
          </Button>
        </div>

        <TabsContent value="plans">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !plans || plans.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-muted-foreground">
                No plans yet. Create subscription plans for your strategies.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan Name</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan Code</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Subscription Amount</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((p) => {
                        const initials = p.name.replace(/[^A-Z0-9]/gi, "").slice(0, 2).toUpperCase();
                        return (
                          <tr key={p.id} className="border-b last:border-0" data-testid={`row-plan-${p.id}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs font-bold w-8 h-8 flex items-center justify-center rounded-md">
                                  {initials}
                                </Badge>
                                <span className="font-medium">{p.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{p.code}</td>
                            <td className="px-4 py-3">
                              {"\u20B9"}{Number(p.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => deleteMutation.mutate(p.id)}
                                  >
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="subscribers">
          <Card>
            <CardContent className="p-0">
              {!plans || plans.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground">No plans to show subscribers for</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan Name</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Subscribers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((p) => {
                        const subs = (subscriptions || []).filter((s) => s.planId === p.id);
                        const initials = p.name.replace(/[^A-Z0-9]/gi, "").slice(0, 2).toUpperCase();
                        return (
                          <tr key={p.id} className="border-b last:border-0">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs font-bold w-8 h-8 flex items-center justify-center rounded-md">
                                  {initials}
                                </Badge>
                                <span className="font-medium">{p.name}({subs.length})</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {subs.length} subscriber{subs.length !== 1 ? "s" : ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <NewPlanDialog
        open={showNew}
        onOpenChange={setShowNew}
        onSubmit={(data) => createMutation.mutate({ ...data, advisorId: user?.id })}
        loading={createMutation.isPending}
      />
    </div>
  );
}

function NewPlanDialog({
  open,
  onOpenChange,
  onSubmit,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({
    name: "",
    code: "",
    amount: "",
    durationDays: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      amount: form.amount,
      durationDays: form.durationDays ? parseInt(form.durationDays) : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add New Plan</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Plan Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              data-testid="input-plan-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Plan Code</Label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
              data-testid="input-plan-code"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Subscription Amount ({"\u20B9"})</Label>
            <Input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
              data-testid="input-plan-amount"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Duration (Days)</Label>
            <Input
              type="number"
              value={form.durationDays}
              onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
              data-testid="input-plan-duration"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading} data-testid="button-save-plan">
            {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Create Plan
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
