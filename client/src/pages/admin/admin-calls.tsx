import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Edit, RotateCcw, X, Check, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function AdminCalls() {
  const [search, setSearch] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [page, setPage] = useState(1);
  const [editCall, setEditCall] = useState<any>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: strategies } = useQuery<any[]>({
    queryKey: ["/api/admin/calls/strategies"],
  });

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/calls/closed", search, strategyFilter, page],
    queryFn: () =>
      fetch(`/api/admin/calls/closed?page=${page}&limit=30&search=${search}&strategyId=${strategyFilter}`, { credentials: "include" })
        .then(r => r.json()),
  });

  const editMutation = useMutation({
    mutationFn: async (updates: any) => {
      const res = await apiRequest("PATCH", `/api/admin/calls/${editCall.id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Call updated" });
      qc.invalidateQueries({ queryKey: ["/api/admin/calls/closed"] });
      setEditCall(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/calls/${id}/reactivate`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Call reactivated" });
      qc.invalidateQueries({ queryKey: ["/api/admin/calls/closed"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/calls/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Call deleted permanently" });
      qc.invalidateQueries({ queryKey: ["/api/admin/calls/closed"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const closeMutation = useMutation({
    mutationFn: async ({ id, ...body }: any) => {
      const res = await apiRequest("POST", `/api/admin/calls/${id}/close`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Call closed" });
      qc.invalidateQueries({ queryKey: ["/api/admin/calls/closed"] });
      setEditCall(null);
    },
  });

  const calls = data?.calls || [];
  const total = data?.total || 0;
  const pages = data?.pages || 1;

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Closed Calls Management</h1>
          <p className="text-sm text-muted-foreground">{total} closed calls across all advisors</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs mb-1 block">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Stock name, strategy, advisor..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="w-[250px]">
              <Label className="text-xs mb-1 block">Strategy</Label>
              <Select value={strategyFilter} onValueChange={v => { setStrategyFilter(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="All Strategies" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Strategies</SelectItem>
                  {(strategies || []).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.advisor_name} — {s.name} ({s.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Stock</th>
                <th className="text-left p-3 font-medium">Strategy</th>
                <th className="text-left p-3 font-medium">Advisor</th>
                <th className="text-center p-3 font-medium">Action</th>
                <th className="text-right p-3 font-medium">Entry</th>
                <th className="text-right p-3 font-medium">Target</th>
                <th className="text-right p-3 font-medium">SL</th>
                <th className="text-right p-3 font-medium">Exit</th>
                <th className="text-right p-3 font-medium">Gain%</th>
                <th className="text-left p-3 font-medium">Exit Date</th>
                <th className="text-center p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="text-center p-8 text-muted-foreground">Loading...</td></tr>
              ) : calls.length === 0 ? (
                <tr><td colSpan={11} className="text-center p-8 text-muted-foreground">No closed calls found</td></tr>
              ) : calls.map((c: any) => (
                <tr key={c.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-semibold">{c.stock_name}</td>
                  <td className="p-3 text-xs">{c.strategy_name}<br/><span className="text-muted-foreground">{c.strategy_type}</span></td>
                  <td className="p-3 text-xs">{c.advisor_name}</td>
                  <td className="p-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${c.action === 'Buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {c.action}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono text-xs">{c.buy_range_start ? `₹${Number(c.buy_range_start).toFixed(1)}` : '—'}</td>
                  <td className="p-3 text-right font-mono text-xs text-green-600">{c.target_price ? `₹${Number(c.target_price).toFixed(1)}` : '—'}</td>
                  <td className="p-3 text-right font-mono text-xs text-red-600">{c.stop_loss ? `₹${Number(c.stop_loss).toFixed(1)}` : '—'}</td>
                  <td className="p-3 text-right font-mono text-xs">{c.sell_price ? `₹${Number(c.sell_price).toFixed(1)}` : '—'}</td>
                  <td className="p-3 text-right font-mono text-xs">
                    <span className={Number(c.gain_percent) >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {c.gain_percent ? `${Number(c.gain_percent).toFixed(1)}%` : '—'}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{c.exit_date ? new Date(c.exit_date).toLocaleDateString('en-IN') : '—'}</td>
                  <td className="p-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button variant="ghost" size="sm" onClick={() => setEditCall(c)} title="Edit">
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => {
                        if (confirm(`Reactivate ${c.stock_name}? This will set status back to Active.`))
                          reactivateMutation.mutate(c.id);
                      }} title="Reactivate">
                        <RotateCcw className="h-3.5 w-3.5 text-green-600" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => {
                        if (confirm(`PERMANENTLY DELETE ${c.stock_name}? This cannot be undone!`))
                          deleteMutation.mutate(c.id);
                      }} title="Delete permanently">
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex gap-2 justify-center">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground py-1.5">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editCall} onOpenChange={open => !open && setEditCall(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Call: {editCall?.stock_name}</DialogTitle>
          </DialogHeader>
          {editCall && <EditCallForm call={editCall} onSave={(updates: any) => editMutation.mutate(updates)} onClose={() => setEditCall(null)} onReclose={(data: any) => closeMutation.mutate({ id: editCall.id, ...data })} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditCallForm({ call, onSave, onClose, onReclose }: { call: any; onSave: (u: any) => void; onClose: () => void; onReclose: (d: any) => void }) {
  const [form, setForm] = useState({
    stockName: call.stock_name || "",
    action: call.action || "Buy",
    buyRangeStart: call.buy_range_start || "",
    buyRangeEnd: call.buy_range_end || "",
    targetPrice: call.target_price || "",
    stopLoss: call.stop_loss || "",
    entryPrice: call.entry_price || "",
    sellPrice: call.sell_price || "",
    gainPercent: call.gain_percent || "",
    rationale: call.rationale || "",
    status: call.status || "Closed",
    theme: call.theme || "",
  });

  const handleSave = () => {
    const updates: any = {};
    if (form.stockName !== call.stock_name) updates.stockName = form.stockName;
    if (form.action !== call.action) updates.action = form.action;
    if (form.buyRangeStart !== (call.buy_range_start || "")) updates.buyRangeStart = form.buyRangeStart || null;
    if (form.buyRangeEnd !== (call.buy_range_end || "")) updates.buyRangeEnd = form.buyRangeEnd || null;
    if (form.targetPrice !== (call.target_price || "")) updates.targetPrice = form.targetPrice || null;
    if (form.stopLoss !== (call.stop_loss || "")) updates.stopLoss = form.stopLoss || null;
    if (form.entryPrice !== (call.entry_price || "")) updates.entryPrice = form.entryPrice || null;
    if (form.sellPrice !== (call.sell_price || "")) updates.sellPrice = form.sellPrice || null;
    if (form.gainPercent !== (call.gain_percent || "")) updates.gainPercent = form.gainPercent || null;
    if (form.rationale !== (call.rationale || "")) updates.rationale = form.rationale;
    if (form.status !== call.status) updates.status = form.status;
    if (form.theme !== (call.theme || "")) updates.theme = form.theme;
    if (Object.keys(updates).length === 0) { onClose(); return; }
    onSave(updates);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Stock Name</Label>
          <Input value={form.stockName} onChange={e => setForm(f => ({ ...f, stockName: e.target.value }))} />
        </div>
        <div>
          <Label className="text-xs">Action</Label>
          <Select value={form.action} onValueChange={v => setForm(f => ({ ...f, action: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Buy">Buy</SelectItem>
              <SelectItem value="Sell">Sell</SelectItem>
              <SelectItem value="Hold">Hold</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><Label className="text-xs">Buy Range Start</Label><Input type="number" step="0.01" value={form.buyRangeStart} onChange={e => setForm(f => ({ ...f, buyRangeStart: e.target.value }))} /></div>
        <div><Label className="text-xs">Buy Range End</Label><Input type="number" step="0.01" value={form.buyRangeEnd} onChange={e => setForm(f => ({ ...f, buyRangeEnd: e.target.value }))} /></div>
        <div><Label className="text-xs">Entry Price</Label><Input type="number" step="0.01" value={form.entryPrice} onChange={e => setForm(f => ({ ...f, entryPrice: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><Label className="text-xs">Target</Label><Input type="number" step="0.01" value={form.targetPrice} onChange={e => setForm(f => ({ ...f, targetPrice: e.target.value }))} /></div>
        <div><Label className="text-xs">Stop Loss</Label><Input type="number" step="0.01" value={form.stopLoss} onChange={e => setForm(f => ({ ...f, stopLoss: e.target.value }))} /></div>
        <div><Label className="text-xs">Theme</Label><Input value={form.theme} onChange={e => setForm(f => ({ ...f, theme: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Sell/Exit Price</Label><Input type="number" step="0.01" value={form.sellPrice} onChange={e => setForm(f => ({ ...f, sellPrice: e.target.value }))} /></div>
        <div><Label className="text-xs">Gain %</Label><Input type="number" step="0.1" value={form.gainPercent} onChange={e => setForm(f => ({ ...f, gainPercent: e.target.value }))} /></div>
      </div>
      <div>
        <Label className="text-xs">Status</Label>
        <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Active">Active (Reactivate)</SelectItem>
            <SelectItem value="Closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Rationale</Label>
        <Textarea rows={4} value={form.rationale} onChange={e => setForm(f => ({ ...f, rationale: e.target.value }))} />
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onClose}><X className="h-4 w-4 mr-1" /> Cancel</Button>
        <Button onClick={handleSave}><Check className="h-4 w-4 mr-1" /> Save Changes</Button>
      </div>
    </div>
  );
}
