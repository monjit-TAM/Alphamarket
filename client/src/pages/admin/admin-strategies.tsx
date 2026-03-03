import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Trash2, Search, BarChart3 } from "lucide-react";
import type { Strategy, User } from "@shared/schema";

type StrategyWithAdvisor = Strategy & { advisor?: Partial<User> };

export default function AdminStrategies() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [editStrategy, setEditStrategy] = useState<StrategyWithAdvisor | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    status: "" as string,
    type: "" as string,
    horizon: "",
    riskLevel: "",
    volatility: "",
  });

  const { data: strategies, isLoading } = useQuery<StrategyWithAdvisor[]>({
    queryKey: ["/api/admin/strategies"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/strategies/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/strategies"] });
      toast({ title: "Strategy updated" });
      setEditStrategy(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/strategies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/strategies"] });
      toast({ title: "Strategy deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openEdit = (s: StrategyWithAdvisor) => {
    setEditStrategy(s);
    setEditForm({
      name: s.name || "",
      description: s.description || "",
      status: s.status,
      type: s.type,
      horizon: s.horizon || "",
      riskLevel: s.riskLevel || "",
      volatility: s.volatility || "",
    });
  };

  const filtered = (strategies || []).filter((s) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !(s.advisor?.companyName || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (typeFilter !== "all" && s.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <h1 className="text-xl font-bold" data-testid="admin-heading-strategies">Strategy Management</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search strategies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-52"
              data-testid="admin-input-search-strategies"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-28" data-testid="admin-filter-status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Published">Published</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36" data-testid="admin-filter-type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="Equity">Equity</SelectItem>
              <SelectItem value="Basket">Basket</SelectItem>
              <SelectItem value="Future">Future</SelectItem>
              <SelectItem value="Commodity">Commodity</SelectItem>
              <SelectItem value="CommodityFuture">Commodity Future</SelectItem>
              <SelectItem value="Option">Option</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} strategies found</p>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <BarChart3 className="w-10 h-10 mx-auto mb-2 text-muted-foreground/50" />
            No strategies found
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="admin-table-strategies">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-3 font-medium text-muted-foreground">Strategy</th>
                    <th className="p-3 font-medium text-muted-foreground">Advisor</th>
                    <th className="p-3 font-medium text-muted-foreground">Type</th>
                    <th className="p-3 font-medium text-muted-foreground">Status</th>
                    <th className="p-3 font-medium text-muted-foreground">Horizon</th>
                    <th className="p-3 font-medium text-muted-foreground">Risk</th>
                    <th className="p-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="border-b last:border-0" data-testid={`admin-strategy-row-${s.id}`}>
                      <td className="p-3">
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">{s.description}</p>
                      </td>
                      <td className="p-3 text-xs">{s.advisor?.companyName || s.advisor?.username || "N/A"}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">{s.type === "CommodityFuture" ? "Comm. Future" : s.type}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="secondary"
                          className={`text-xs ${s.status === "Published" ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30" : "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30"}`}
                        >
                          {s.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs">{s.horizon || "--"}</td>
                      <td className="p-3 text-xs">{s.riskLevel || "--"}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon" onClick={() => openEdit(s)} data-testid={`admin-edit-strategy-${s.id}`}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" size="icon" data-testid={`admin-delete-strategy-${s.id}`}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Strategy?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete "{s.name}" and all associated calls and positions. This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteMutation.mutate(s.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editStrategy} onOpenChange={(o) => { if (!o) setEditStrategy(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Strategy</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editStrategy) {
                updateMutation.mutate({ id: editStrategy.id, data: editForm });
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                data-testid="admin-edit-strategy-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                data-testid="admin-edit-strategy-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                  <SelectTrigger data-testid="admin-edit-strategy-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Draft">Draft</SelectItem>
                    <SelectItem value="Published">Published</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Horizon</Label>
                <Input
                  value={editForm.horizon}
                  onChange={(e) => setEditForm({ ...editForm, horizon: e.target.value })}
                  data-testid="admin-edit-strategy-horizon"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Risk Level</Label>
                <Select value={editForm.riskLevel} onValueChange={(v) => setEditForm({ ...editForm, riskLevel: v })}>
                  <SelectTrigger data-testid="admin-edit-strategy-risk">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low Risk">Low Risk</SelectItem>
                    <SelectItem value="Medium Risk">Medium Risk</SelectItem>
                    <SelectItem value="High Risk">High Risk</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Volatility</Label>
                <Select value={editForm.volatility} onValueChange={(v) => setEditForm({ ...editForm, volatility: v })}>
                  <SelectTrigger data-testid="admin-edit-strategy-volatility">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="admin-button-save-strategy">
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
