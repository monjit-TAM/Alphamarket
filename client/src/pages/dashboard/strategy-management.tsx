import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, MoreVertical, Loader2, Pencil, ChevronDown, ChevronRight, X, Search, ArrowUp, ArrowDown, Send, Check, Package, RefreshCw, FileText, Trash2, Upload, IndianRupee, CalendarDays } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { Strategy, Call, Position, Plan, BasketRebalance, BasketConstituent, BasketRationale } from "@shared/schema";

function parseBasketFile(
  file: File,
  onSuccess: (parsed: { symbol: string; exchange: string; weightPercent: string; quantity: string; priceAtRebalance: string; action: string }[]) => void,
  onError: (msg: string) => void
) {
  const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");

  const mapRows = (rows: Record<string, string>[]) => {
    if (!rows || rows.length === 0) { onError("No valid data rows found"); return; }
    const keys = Object.keys(rows[0]);
    const norm = keys.map(k => k.trim().toLowerCase().replace(/[^a-z%]/g, ""));
    const find = (tests: string[]) => keys[norm.findIndex(n => tests.some(t => t === n || n.includes(t)))] || "";
    const symbolKey = find(["symbol", "stock"]);
    const weightKey = find(["weight", "weight%"]);
    const exchangeKey = find(["exchange"]);
    const quantityKey = find(["quantity", "qty"]);
    const priceKey = find(["price", "priceatrebalance", "entryprice"]);
    const actionKey = find(["action", "buysell"]);
    if (!symbolKey || !weightKey) { onError("File must contain at least 'Symbol' and 'Weight%' columns"); return; }
    const parsed = rows.map(row => ({
      symbol: String(row[symbolKey] || "").trim().toUpperCase(),
      exchange: exchangeKey ? String(row[exchangeKey] || "NSE").trim() : "NSE",
      weightPercent: String(row[weightKey] || "").replace("%", "").trim(),
      quantity: quantityKey ? String(row[quantityKey] || "").trim() : "",
      priceAtRebalance: priceKey ? String(row[priceKey] || "").trim() : "",
      action: actionKey ? String(row[actionKey] || "Buy").trim() : "Buy",
    })).filter(s => s.symbol);
    if (parsed.length === 0) { onError("No valid data rows found"); return; }
    onSuccess(parsed);
  };

  if (isExcel) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
        mapRows(rows);
      } catch { onError("Failed to parse Excel file"); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => { try { mapRows(results.data as Record<string, string>[]); } catch { onError("Failed to parse CSV file"); } },
      error: () => { onError("Failed to parse CSV file"); },
    });
  }
}
import { Skeleton } from "@/components/ui/skeleton";

function getCallActionsForType(type: string): { label: string; mode: "stock" | "position" }[] {
  switch (type) {
    case "Equity":
      return [{ label: "Add Stock Call", mode: "stock" }];
    case "Option":
      return [{ label: "Add Option Call", mode: "position" }];
    case "Future":
      return [{ label: "Add Future Call", mode: "position" }];
    case "Commodity":
      return [{ label: "Add Commodity Call", mode: "stock" }];
    case "CommodityFuture":
      return [{ label: "Add Commodity Future Call", mode: "position" }];
    case "Basket":
      return [
        { label: "Add Basket Stock", mode: "stock" },
      ];
    default:
      return [
        { label: "Add Stock Call", mode: "stock" },
        { label: "Add Position (F&O)", mode: "position" },
      ];
  }
}

interface SymbolResult {
  symbol: string;
  name: string;
  exchange: string;
  segment: string;
  isFnO: boolean;
}

function SymbolAutocomplete({
  value,
  onChange,
  segment,
  testId,
}: {
  value: string;
  onChange: (val: string) => void;
  segment?: string;
  testId?: string;
}) {
  const [query, setQuery] = useState(value);
  const [showDropdown, setShowDropdown] = useState(false);
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchSymbols = (q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 1) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (segment) params.set("segment", segment);
        const res = await fetch(`/api/symbols/search?${params}`);
        const data = await res.json();
        setResults(data);
        setShowDropdown(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            onChange(v);
            searchSymbols(v);
          }}
          onFocus={() => {
            if (query.length >= 1) searchSymbols(query);
          }}
          placeholder="Search symbol..."
          className="pl-8"
          data-testid={testId || "input-symbol-search"}
        />
        {loading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
      </div>
      {showDropdown && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
          {results.map((r) => (
            <button
              key={`${r.exchange}-${r.symbol}`}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover-elevate flex items-center justify-between gap-2"
              onClick={() => {
                onChange(r.symbol);
                setQuery(r.symbol);
                setShowDropdown(false);
              }}
              data-testid={`symbol-option-${r.symbol}`}
            >
              <div>
                <span className="font-medium">{r.symbol}</span>
                <span className="text-muted-foreground ml-2 text-xs">{r.name}</span>
              </div>
              <Badge variant="secondary" className="text-xs">{r.exchange}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StrategyManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showNewStrategy, setShowNewStrategy] = useState(false);
  const [showEditStrategy, setShowEditStrategy] = useState(false);
  const [showAddStock, setShowAddStock] = useState(false);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [showAddBasketStock, setShowAddBasketStock] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null);

  const { data: strategies, isLoading } = useQuery<Strategy[]>({
    queryKey: ["/api/advisor/strategies"],
  });

  const { data: plans } = useQuery<Plan[]>({
    queryKey: ["/api/advisor/plans"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/strategies", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies"] });
      setShowNewStrategy(false);
      toast({ title: "Strategy created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/strategies/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies"] });
      setShowEditStrategy(false);
      setSelectedStrategy(null);
      toast({ title: "Strategy updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/strategies/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies"] });
      toast({ title: "Strategy updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/strategies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies"] });
      toast({ title: "Strategy deleted" });
    },
  });

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">
          Manage Strategies ({strategies?.length || 0})
        </h2>
        <Button onClick={() => setShowNewStrategy(true)} data-testid="button-add-strategy">
          <Plus className="w-4 h-4 mr-1" /> Add New
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !strategies || strategies.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No strategies yet. Create your first strategy to start publishing calls.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {strategies.map((s) => {
            const callActions = getCallActionsForType(s.type);
            const isExpanded = expandedStrategy === s.id;
            return (
              <Card key={s.id} data-testid={`card-strategy-${s.id}`}>
                <CardContent className="p-0">
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate flex-wrap"
                    onClick={() => setExpandedStrategy(isExpanded ? null : s.id)}
                    data-testid={`row-strategy-${s.id}`}
                  >
                    <div className="flex items-center gap-1 text-muted-foreground">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.type} {s.horizon ? `| ${s.horizon}` : ""}</div>
                    </div>
                    <Badge variant={s.status === "Published" ? "default" : "secondary"}>
                      {s.status}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      {s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-IN") : ""}
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-actions-${s.id}`}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedStrategy(s);
                              setShowEditStrategy(true);
                            }}
                            data-testid={`button-edit-strategy-${s.id}`}
                          >
                            <Pencil className="w-4 h-4 mr-2" />
                            Edit Strategy
                          </DropdownMenuItem>
                          {callActions.map((action) => (
                            <DropdownMenuItem
                              key={action.label}
                              onClick={() => {
                                setSelectedStrategy(s);
                                if (s.type === "Basket" && action.label === "Add Basket Stock") {
                                  setShowAddBasketStock(true);
                                } else if (action.mode === "stock") {
                                  setShowAddStock(true);
                                } else {
                                  setShowAddPosition(true);
                                }
                              }}
                              data-testid={`button-action-${action.label.toLowerCase().replace(/\s+/g, "-")}-${s.id}`}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              {action.label}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuItem
                            onClick={() =>
                              toggleStatusMutation.mutate({
                                id: s.id,
                                status: s.status === "Published" ? "Draft" : "Published",
                              })
                            }
                            data-testid={`button-toggle-status-${s.id}`}
                          >
                            {s.status === "Published" ? "Unpublish" : "Publish"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteMutation.mutate(s.id)}
                            data-testid={`button-delete-strategy-${s.id}`}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t px-4 py-3">
                      {s.type === "Basket" ? (
                        <Tabs defaultValue="basket">
                          <TabsList>
                            <TabsTrigger value="basket" data-testid="tab-basket-builder">
                              <Package className="w-3 h-3 mr-1" /> Basket
                            </TabsTrigger>
                            <TabsTrigger value="calls" data-testid="tab-basket-calls">
                              Calls & Positions
                            </TabsTrigger>
                          </TabsList>
                          <TabsContent value="basket" className="mt-3">
                            <BasketBuilderPanel strategy={s} />
                          </TabsContent>
                          <TabsContent value="calls" className="mt-3">
                            <StrategyCallsPanel strategy={s} />
                          </TabsContent>
                        </Tabs>
                      ) : (
                        <StrategyCallsPanel strategy={s} />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <StrategyDialog
        open={showNewStrategy}
        onOpenChange={setShowNewStrategy}
        onSubmit={(data) => createMutation.mutate({ ...data, advisorId: user?.id })}
        loading={createMutation.isPending}
        plans={plans || []}
        mode="create"
      />

      <StrategyDialog
        open={showEditStrategy}
        onOpenChange={(v) => {
          setShowEditStrategy(v);
          if (!v) setSelectedStrategy(null);
        }}
        onSubmit={(data) => updateMutation.mutate({ ...data, id: selectedStrategy?.id })}
        loading={updateMutation.isPending}
        plans={plans || []}
        mode="edit"
        strategy={selectedStrategy}
      />

      <AddStockSheet
        open={showAddStock}
        onOpenChange={setShowAddStock}
        strategy={selectedStrategy}
      />

      <AddPositionSheet
        open={showAddPosition}
        onOpenChange={setShowAddPosition}
        strategy={selectedStrategy}
      />

      <AddBasketStockSheet
        open={showAddBasketStock}
        onOpenChange={setShowAddBasketStock}
        strategy={selectedStrategy}
      />
    </div>
  );
}

function StrategyCallsPanel({ strategy }: { strategy: Strategy }) {
  const { toast } = useToast();
  const [editingCall, setEditingCall] = useState<Call | null>(null);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [closingCall, setClosingCall] = useState<Call | null>(null);
  const [closingPosition, setClosingPosition] = useState<Position | null>(null);

  const { data: calls, isLoading: callsLoading } = useQuery<Call[]>({
    queryKey: ["/api/advisor/strategies", strategy.id, "calls"],
    queryFn: async () => {
      const res = await fetch(`/api/advisor/strategies/${strategy.id}/calls`);
      if (!res.ok) throw new Error("Failed to load calls");
      return res.json();
    },
  });

  const { data: positions, isLoading: positionsLoading } = useQuery<Position[]>({
    queryKey: ["/api/advisor/strategies", strategy.id, "positions"],
    queryFn: async () => {
      const res = await fetch(`/api/advisor/strategies/${strategy.id}/positions`);
      if (!res.ok) throw new Error("Failed to load positions");
      return res.json();
    },
  });

  const activeCalls = calls?.filter((c) => c.status === "Active" && ((c as any).publishMode === "live" || (c.isPublished && !(c as any).publishMode))) || [];
  const closedCalls = calls?.filter((c) => c.status === "Closed") || [];
  const draftCalls = calls?.filter((c) => c.status === "Active" && !c.isPublished && ((c as any).publishMode === "draft" || (c as any).publishMode === "watchlist" || !(c as any).publishMode)) || [];
  const activePositions = positions?.filter((p) => p.status === "Active" && ((p as any).publishMode === "live" || (p.isPublished && !(p as any).publishMode))) || [];
  const closedPositions = positions?.filter((p) => p.status === "Closed") || [];
  const draftPositions = positions?.filter((p) => p.status === "Active" && ((p as any).publishMode === "draft" || (p as any).publishMode === "watchlist" || (!(p as any).publishMode && !p.isPublished))) || [];

  const activeSymbols = [
    ...activeCalls.map((c) => ({ symbol: c.stockName, strategyType: strategy.type })),
    ...activePositions.filter((p) => p.symbol).map((p) => ({ symbol: p.symbol!, strategyType: strategy.type })),
  ];

  const { data: livePrices } = useQuery<Record<string, { ltp: number; change: number; changePercent: number }>>({
    queryKey: ["/api/live-prices", strategy.id, "dashboard"],
    queryFn: async () => {
      if (!activeSymbols.length) return {};
      const res = await apiRequest("POST", "/api/live-prices/bulk", { symbols: activeSymbols });
      return res.json();
    },
    enabled: activeSymbols.length > 0,
    refetchInterval: ["Future", "Option", "CommodityFuture"].includes(strategy.type) ? 5000 : 15000,
  });

  const isFnOStrategy = ["Option", "Future", "Index", "CommodityFuture"].includes(strategy.type);
  const fnoPositionGroups = isFnOStrategy
    ? activePositions
        .filter((p) => p.symbol && p.expiry && p.strikePrice)
        .reduce<Record<string, { symbol: string; expiry: string; exchange: string }>>((acc, p) => {
          const exchange = ["SENSEX", "BANKEX"].includes(p.symbol!.toUpperCase()) ? "BSE" : "NSE";
          const key = `${p.symbol}:${p.expiry}`;
          if (!acc[key]) acc[key] = { symbol: p.symbol!, expiry: p.expiry!, exchange };
          return acc;
        }, {})
    : {};

  const { data: optionChainData } = useQuery<Record<string, any[]>>({
    queryKey: ["/api/option-chain-premiums", strategy.id, JSON.stringify(fnoPositionGroups)],
    queryFn: async () => {
      const results: Record<string, any[]> = {};
      const entries = Object.entries(fnoPositionGroups);
      await Promise.all(
        entries.map(async ([key, { symbol, expiry, exchange }]) => {
          try {
            const res = await fetch(`/api/option-chain?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}&expiry=${encodeURIComponent(expiry)}`);
            if (res.ok) results[key] = await res.json();
          } catch {}
        })
      );
      return results;
    },
    enabled: isFnOStrategy && Object.keys(fnoPositionGroups).length > 0,
    refetchInterval: 15000,
  });

  const getOptionPremiumLTP = (pos: Position): number | null => {
    if (!pos.symbol || !pos.expiry || !pos.strikePrice || !optionChainData) return null;
    const key = `${pos.symbol}:${pos.expiry}`;
    const chain = optionChainData[key];
    if (!chain) return null;
    const strike = chain.find((s: any) => String(s.strikePrice) === String(pos.strikePrice));
    if (!strike) return null;
    return pos.callPut === "Put" ? (strike.pe?.ltp ?? null) : (strike.ce?.ltp ?? null);
  };

  const hasPositions = (positions?.length || 0) > 0;
  const loading = callsLoading || positionsLoading;

  if (loading) {
    return <div className="py-4"><Skeleton className="h-20 w-full" /></div>;
  }

  const totalCalls = (calls?.length || 0) + (positions?.length || 0);
  if (totalCalls === 0) {
    return (
      <div className="py-4 text-center text-muted-foreground text-sm">
        No calls or positions yet. Use the actions menu to add one.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Tabs defaultValue={draftCalls.length + draftPositions.length > 0 ? "draft" : "active"}>
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active-calls">
            Active ({activeCalls.length + activePositions.length})
          </TabsTrigger>
          <TabsTrigger value="closed" data-testid="tab-closed-calls">
            Closed ({closedCalls.length + closedPositions.length})
          </TabsTrigger>
          <TabsTrigger value="draft" data-testid="tab-draft-calls">
            Draft ({draftCalls.length + draftPositions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-3">
          {activeCalls.length === 0 && activePositions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No active published calls</p>
          ) : (
            <div className="space-y-2">
              {activeCalls.map((call) => (
                <CallRow
                  key={call.id}
                  call={call}
                  onEdit={() => setEditingCall(call)}
                  onClose={() => setClosingCall(call)}
                  livePrice={livePrices?.[call.stockName]}
                />
              ))}
              {activePositions.map((pos) => (
                <PositionRow
                  key={pos.id}
                  position={pos}
                  onEdit={() => setEditingPosition(pos)}
                  onClose={() => setClosingPosition(pos)}
                  strategyId={strategy.id}
                  livePrice={pos.symbol ? livePrices?.[pos.symbol] : undefined}
                  optionPremiumLTP={getOptionPremiumLTP(pos)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="closed" className="mt-3">
          {closedCalls.length === 0 && closedPositions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No closed calls</p>
          ) : (
            <div className="space-y-2">
              {closedCalls.map((call) => (
                <CallRow key={call.id} call={call} strategyId={strategy.id} />
              ))}
              {closedPositions.map((pos) => (
                <PositionRow key={pos.id} position={pos} strategyId={strategy.id} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="draft" className="mt-3">
          {draftCalls.length === 0 && draftPositions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No draft or watchlist items. Use the actions menu to add calls or positions as drafts.</p>
          ) : (
            <div className="space-y-2">
              {draftCalls.map((call) => (
                <DraftCallRow
                  key={call.id}
                  call={call}
                  onEdit={() => setEditingCall(call)}
                  onClose={() => setClosingCall(call)}
                  strategyId={strategy.id}
                />
              ))}
              {draftPositions.map((pos) => (
                <DraftPositionRow
                  key={pos.id}
                  position={pos}
                  onEdit={() => setEditingPosition(pos)}
                  onClose={() => setClosingPosition(pos)}
                  strategyId={strategy.id}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <EditCallDialog
        call={editingCall}
        onClose={() => setEditingCall(null)}
        strategyId={strategy.id}
      />

      <EditPositionDialog
        position={editingPosition}
        onClose={() => setEditingPosition(null)}
        strategyId={strategy.id}
      />

      <CloseCallDialog
        call={closingCall}
        onClose={() => setClosingCall(null)}
        strategyId={strategy.id}
        strategyType={strategy.type}
        livePrices={livePrices}
      />

      <ClosePositionDialog
        position={closingPosition}
        onClose={() => setClosingPosition(null)}
        strategyId={strategy.id}
        strategyType={strategy.type}
        livePrices={livePrices}
        getOptionPremiumLTP={getOptionPremiumLTP}
      />
    </div>
  );
}

function CallRow({
  call,
  onEdit,
  onClose,
  livePrice,
  strategyId,
}: {
  call: Call;
  onEdit?: () => void;
  onClose?: () => void;
  livePrice?: { ltp: number; change: number; changePercent: number };
  strategyId?: string;
}) {
  const { toast } = useToast();
  const isActive = call.status === "Active";
  const buyPrice = Number(call.entryPrice || call.buyRangeStart || 0);
  const currentPrice = livePrice?.ltp || 0;
  const isSell = call.action === "Sell";
  const pnl = buyPrice > 0 && currentPrice > 0
    ? (isSell ? ((buyPrice - currentPrice) / buyPrice) * 100 : ((currentPrice - buyPrice) / buyPrice) * 100)
    : null;

  const isMissingExitData = !isActive && (call.sellPrice == null || Number(call.sellPrice) === 0 || Number(call.sellPrice) === buyPrice);
  const [showExitEdit, setShowExitEdit] = useState(false);
  const [editExitPrice, setEditExitPrice] = useState("");

  const exitUpdateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/calls/${call.id}/exit`, { exitPrice: editExitPrice });
      return res.json();
    },
    onSuccess: () => {
      if (strategyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies", strategyId, "calls"] });
      }
      setShowExitEdit(false);
      setEditExitPrice("");
      toast({ title: "Exit price updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-md border text-sm flex-wrap"
      data-testid={`call-row-${call.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{call.stockName}</span>
          <Badge variant={call.action === "Buy" ? "default" : "secondary"}>
            {call.action}
          </Badge>
          {!isActive && (
            <Badge variant="secondary">Closed</Badge>
          )}
          {isActive && livePrice && (
            <span className="flex items-center gap-1 text-xs font-medium" data-testid={`ltp-call-${call.id}`}>
              {"\u20B9"}{livePrice.ltp.toFixed(2)}
              {livePrice.change >= 0 ? (
                <ArrowUp className="w-3 h-3 text-green-600 dark:text-green-400" />
              ) : (
                <ArrowDown className="w-3 h-3 text-red-600 dark:text-red-400" />
              )}
              <span className={livePrice.changePercent >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                ({livePrice.changePercent >= 0 ? "+" : ""}{livePrice.changePercent.toFixed(2)}%)
              </span>
            </span>
          )}
          {isActive && pnl !== null && (
            <Badge variant="secondary" className={pnl >= 0 ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30" : "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30"}>
              P&L: {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
          {call.buyRangeStart && <span>Entry: {Number(call.buyRangeStart).toFixed(2)}{call.buyRangeEnd ? ` - ${Number(call.buyRangeEnd).toFixed(2)}` : ""}</span>}
          {call.targetPrice && <span>Target: {Number(call.targetPrice).toFixed(2)}</span>}
          {call.stopLoss && <span>SL: {Number(call.stopLoss).toFixed(2)}{(call as any).trailingSlEnabled && <span className="ml-1 text-xs text-blue-500 font-medium" title={`Trailing ${(call as any).trailingSlValue || ""}${(call as any).trailingSlType === "PERCENTAGE" ? "%" : " pts"}`}>↕TSL</span>}</span>}
          {(call as any).duration && <span>Duration: {(call as any).duration} {(call as any).durationUnit || "Days"}</span>}
          {(call as any).theme && <span>Theme: {(call as any).theme}</span>}
          {!isActive && call.sellPrice != null && <span>Exit: {Number(call.sellPrice).toFixed(2)}</span>}
          {!isActive && call.gainPercent != null && (
            <span className={Number(call.gainPercent) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              {Number(call.gainPercent) >= 0 ? "+" : ""}{Number(call.gainPercent).toFixed(2)}%
            </span>
          )}
          <span>
            {call.createdAt
              ? `${new Date(call.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} ${new Date(call.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
              : call.callDate ? new Date(call.callDate).toLocaleDateString("en-IN") : ""}
          </span>
          {!isActive && call.exitDate && (
            <span>Closed: {new Date(call.exitDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} {new Date(call.exitDate).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </div>
        {call.rationale && (
          <p className="text-xs text-muted-foreground mt-1 italic">{call.rationale}</p>
        )}
        {isMissingExitData && !showExitEdit && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setShowExitEdit(true)}
            data-testid={`button-update-exit-call-${call.id}`}
          >
            <Pencil className="w-3 h-3 mr-1" />
            Update Exit Price
          </Button>
        )}
        {showExitEdit && (
          <div className="flex items-center gap-2 mt-2">
            <Input
              type="number"
              step="0.01"
              value={editExitPrice}
              onChange={(e) => setEditExitPrice(e.target.value)}
              placeholder="Exit price"
              className="w-32"
              data-testid={`input-exit-price-call-${call.id}`}
            />
            <Button
              size="sm"
              onClick={() => exitUpdateMutation.mutate()}
              disabled={exitUpdateMutation.isPending || !editExitPrice || Number(editExitPrice) <= 0}
              data-testid={`button-save-exit-call-${call.id}`}
            >
              {exitUpdateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowExitEdit(false); setEditExitPrice(""); }}
              data-testid={`button-cancel-exit-call-${call.id}`}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
      {isActive && (
        <div className="flex items-center gap-1">
          {onEdit && (
            <Button variant="ghost" size="icon" onClick={onEdit} data-testid={`button-edit-call-${call.id}`}>
              <Pencil className="w-4 h-4" />
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} data-testid={`button-close-call-${call.id}`}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PositionRow({
  position,
  onEdit,
  onClose,
  strategyId,
  livePrice,
  optionPremiumLTP,
}: {
  position: Position;
  onEdit?: () => void;
  onClose?: () => void;
  strategyId: string;
  livePrice?: { ltp: number; change: number; changePercent: number };
  optionPremiumLTP?: number | null;
}) {
  const { toast } = useToast();
  const isActive = position.status === "Active";
  const entryPx = Number(position.entryPrice || 0);
  const isFnO = position.strikePrice && position.expiry;
  const currentPx = isFnO && optionPremiumLTP != null
    ? optionPremiumLTP
    : (position.symbol && livePrice ? livePrice.ltp : 0);
  const pnl = entryPx > 0 && currentPx > 0
    ? (position.buySell === "Sell"
        ? ((entryPx - currentPx) / entryPx) * 100
        : ((currentPx - entryPx) / entryPx) * 100)
    : null;

  const [editingExit, setEditingExit] = useState(false);
  const [exitPriceInput, setExitPriceInput] = useState("");

  const exitMutation = useMutation({
    mutationFn: async (data: { exitPrice: string }) => {
      const res = await apiRequest("PATCH", `/api/positions/${position.id}/exit`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies", strategyId, "positions"] });
      setEditingExit(false);
      toast({ title: "Exit price updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isMissingExitData = !isActive && (position.exitPrice == null || position.exitPrice === "");

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-md border text-sm flex-wrap"
      data-testid={`position-row-${position.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{position.symbol || "Position"}</span>
          <Badge variant="secondary">{position.segment}</Badge>
          {position.callPut && <Badge variant="secondary">{position.callPut}</Badge>}
          <Badge variant={position.buySell === "Buy" ? "default" : "secondary"}>
            {position.buySell}
          </Badge>
          {!isActive && <Badge variant="secondary">Closed</Badge>}
          {isActive && (position as any).publishMode === "watchlist" && <Badge variant="secondary">Watchlist</Badge>}
          {isActive && (position as any).publishMode === "live" && <Badge variant="default">Live</Badge>}
          {isActive && !(position as any).publishMode && !position.isPublished && <Badge variant="secondary">Draft</Badge>}
          {isActive && livePrice != null && !isFnO && (
            <span className="flex items-center gap-1 text-xs font-medium" data-testid={`ltp-pos-${position.id}`}>
              {"\u20B9"}{livePrice.ltp.toFixed(2)}
              {livePrice.change >= 0 ? (
                <ArrowUp className="w-3 h-3 text-green-600 dark:text-green-400" />
              ) : (
                <ArrowDown className="w-3 h-3 text-red-600 dark:text-red-400" />
              )}
            </span>
          )}
          {isActive && isFnO && optionPremiumLTP != null && (
            <span className="flex items-center gap-1 text-xs font-medium" data-testid={`ltp-pos-${position.id}`}>
              {"\u20B9"}{optionPremiumLTP.toFixed(2)}
            </span>
          )}
          {isActive && pnl !== null && (
            <Badge variant="secondary" className={pnl >= 0 ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30" : "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30"}>
              P&L: {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
          {position.strikePrice && <span>Strike: {Number(position.strikePrice).toFixed(2)}</span>}
          {position.entryPrice && <span>Entry: {Number(position.entryPrice).toFixed(2)}</span>}
          {position.target && <span>Target: {position.target}</span>}
          {position.stopLoss && <span>SL: {position.stopLoss}{(position as any).trailingSlEnabled && <span className="ml-1 text-xs text-blue-500 font-medium" title={`Trailing ${(position as any).trailingSlValue || ""}${(position as any).trailingSlType === "PERCENTAGE" ? "%" : " pts"}`}>↕TSL</span>}</span>}
          {position.lots && <span>Lots: {position.lots}</span>}
          {position.expiry && <span>Exp: {position.expiry}</span>}
          {(position as any).duration && <span>Duration: {(position as any).duration} {(position as any).durationUnit || "Days"}</span>}
          {(position as any).theme && <span>Theme: {(position as any).theme}</span>}
          {!isActive && position.exitPrice != null && <span>Close Price: {Number(position.exitPrice).toFixed(2)}</span>}
          {!isActive && position.gainPercent != null && (
            <span className={Number(position.gainPercent) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              {Number(position.gainPercent) >= 0 ? "+" : ""}{Number(position.gainPercent).toFixed(2)}%
            </span>
          )}
          <span>
            {position.createdAt
              ? `${new Date(position.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} ${new Date(position.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </span>
          {!isActive && position.exitDate && (
            <span>Closed: {new Date(position.exitDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} {new Date(position.exitDate).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </div>
        {isMissingExitData && !editingExit && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-amber-600 dark:text-amber-400">Exit price missing</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingExit(true)}
              data-testid={`button-update-exit-${position.id}`}
            >
              <Pencil className="w-3 h-3 mr-1" />
              Update Exit Price
            </Button>
          </div>
        )}
        {editingExit && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              value={exitPriceInput}
              onChange={(e) => setExitPriceInput(e.target.value)}
              placeholder="Enter exit price"
              className="w-32 h-8 text-xs"
              data-testid={`input-update-exit-${position.id}`}
            />
            <Button
              size="sm"
              onClick={() => {
                if (!exitPriceInput || Number(exitPriceInput) <= 0) {
                  toast({ title: "Invalid price", variant: "destructive" });
                  return;
                }
                exitMutation.mutate({ exitPrice: exitPriceInput });
              }}
              disabled={exitMutation.isPending}
              data-testid={`button-save-exit-${position.id}`}
            >
              {exitMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setEditingExit(false); setExitPriceInput(""); }}
              data-testid={`button-cancel-exit-${position.id}`}
            >
              Cancel
            </Button>
          </div>
        )}
        {position.rationale && (
          <p className="text-xs text-muted-foreground mt-1 italic">{position.rationale}</p>
        )}
      </div>
      {isActive && (
        <div className="flex items-center gap-1">
          {onEdit && (
            <Button variant="ghost" size="icon" onClick={onEdit} data-testid={`button-edit-position-${position.id}`}>
              <Pencil className="w-4 h-4" />
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              data-testid={`button-close-position-${position.id}`}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function DraftCallRow({
  call,
  onEdit,
  onClose,
  strategyId,
}: {
  call: Call;
  onEdit?: () => void;
  onClose?: () => void;
  strategyId: string;
}) {
  const { toast } = useToast();
  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/calls/${call.id}/publish`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies", strategyId, "calls"] });
      toast({ title: "Call published successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const publishMode = (call as any).publishMode || "draft";

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-md border text-sm flex-wrap"
      data-testid={`draft-call-row-${call.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{call.stockName}</span>
          <Badge variant={call.action === "Buy" ? "default" : "secondary"}>
            {call.action}
          </Badge>
          <Badge variant="secondary">{publishMode === "watchlist" ? "Watchlist" : "Draft"}</Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
          {call.buyRangeStart && <span>Entry: {Number(call.buyRangeStart).toFixed(2)}{call.buyRangeEnd ? ` - ${Number(call.buyRangeEnd).toFixed(2)}` : ""}</span>}
          {call.targetPrice && <span>Target: {Number(call.targetPrice).toFixed(2)}</span>}
          {call.stopLoss && <span>SL: {Number(call.stopLoss).toFixed(2)}</span>}
          <span>
            {call.createdAt
              ? `${new Date(call.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} ${new Date(call.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </span>
        </div>
        {call.rationale && (
          <p className="text-xs text-muted-foreground mt-1 italic">{call.rationale}</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!call.rationale?.trim() && (
          <span className="text-xs text-muted-foreground mr-1">Add rationale to publish</span>
        )}
        <Button
          variant="default"
          size="sm"
          onClick={() => publishMutation.mutate()}
          disabled={publishMutation.isPending || !call.rationale?.trim()}
          data-testid={`button-publish-call-${call.id}`}
        >
          {publishMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
          Publish
        </Button>
        {onEdit && (
          <Button variant="ghost" size="icon" onClick={onEdit} data-testid={`button-edit-draft-call-${call.id}`}>
            <Pencil className="w-4 h-4" />
          </Button>
        )}
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} data-testid={`button-delete-draft-call-${call.id}`}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function DraftPositionRow({
  position,
  onEdit,
  onClose,
  strategyId,
}: {
  position: Position;
  onEdit?: () => void;
  onClose?: () => void;
  strategyId: string;
}) {
  const { toast } = useToast();
  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/positions/${position.id}/publish`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies", strategyId, "positions"] });
      toast({ title: "Position published successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const publishMode = (position as any).publishMode || "draft";

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-md border text-sm flex-wrap"
      data-testid={`draft-position-row-${position.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{position.symbol || "Position"}</span>
          <Badge variant="secondary">{position.segment}</Badge>
          {position.callPut && <Badge variant="secondary">{position.callPut}</Badge>}
          <Badge variant={position.buySell === "Buy" ? "default" : "secondary"}>
            {position.buySell}
          </Badge>
          <Badge variant="secondary">{publishMode === "watchlist" ? "Watchlist" : "Draft"}</Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
          {position.strikePrice && <span>Strike: {Number(position.strikePrice).toFixed(2)}</span>}
          {position.entryPrice && <span>Entry: {Number(position.entryPrice).toFixed(2)}</span>}
          {position.target && <span>Target: {position.target}</span>}
          {position.stopLoss && <span>SL: {position.stopLoss}{(position as any).trailingSlEnabled && <span className="ml-1 text-xs text-blue-500 font-medium" title={`Trailing ${(position as any).trailingSlValue || ""}${(position as any).trailingSlType === "PERCENTAGE" ? "%" : " pts"}`}>↕TSL</span>}</span>}
          {position.lots && <span>Lots: {position.lots}</span>}
          {position.expiry && <span>Exp: {position.expiry}</span>}
          <span>
            {position.createdAt
              ? `${new Date(position.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} ${new Date(position.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </span>
        </div>
        {position.rationale && (
          <p className="text-xs text-muted-foreground mt-1 italic">{position.rationale}</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!position.rationale?.trim() && (
          <span className="text-xs text-muted-foreground mr-1">Add rationale to publish</span>
        )}
        <Button
          variant="default"
          size="sm"
          onClick={() => publishMutation.mutate()}
          disabled={publishMutation.isPending || !position.rationale?.trim()}
          data-testid={`button-publish-position-${position.id}`}
        >
          {publishMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
          Publish
        </Button>
        {onEdit && (
          <Button variant="ghost" size="icon" onClick={onEdit} data-testid={`button-edit-draft-position-${position.id}`}>
            <Pencil className="w-4 h-4" />
          </Button>
        )}
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} data-testid={`button-delete-draft-position-${position.id}`}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function EditCallDialog({
  call,
  onClose,
  strategyId,
}: {
  call: Call | null;
  onClose: () => void;
  strategyId: string;
}) {
  const { toast } = useToast();
  const [targetPrice, setTargetPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [rationale, setRationale] = useState("");
  const [trailingSlEnabled, setTrailingSlEnabled] = useState(false);
  const [trailingSlType, setTrailingSlType] = useState("PERCENTAGE");
  const [trailingSlValue, setTrailingSlValue] = useState("");

  useEffect(() => {
    if (call) {
      setTargetPrice(call.targetPrice || "");
      setStopLoss(call.stopLoss || "");
      setRationale(call.rationale || "");
      setTrailingSlEnabled((call as any).trailingSlEnabled || false);
      setTrailingSlType((call as any).trailingSlType || "PERCENTAGE");
      setTrailingSlValue((call as any).trailingSlValue || "");
    }
  }, [call]);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/calls/${call?.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies", strategyId, "calls"] });
      onClose();
      toast({ title: "Call updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={!!call} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Call - {call?.stockName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Target Price</Label>
            <Input
              type="number"
              step="0.01"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              data-testid="input-edit-target-price"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Stop Loss</Label>
            <Input
              type="number"
              step="0.01"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              data-testid="input-edit-stop-loss"
            />
          </div>
          <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Trailing SL</span>
              <button type="button" onClick={() => setTrailingSlEnabled(!trailingSlEnabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${trailingSlEnabled ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"}`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${trailingSlEnabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
              </button>
            </div>
            {trailingSlEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={trailingSlType} onValueChange={setTrailingSlType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">%</SelectItem>
                    <SelectItem value="POINTS">Pts</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" step="0.1" min="0" value={trailingSlValue} onChange={(e) => setTrailingSlValue(e.target.value)} placeholder={trailingSlType === "PERCENTAGE" ? "e.g. 5" : "e.g. 50"} />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Rationale</Label>
            <Textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              placeholder="Add rationale (required before publishing)"
              data-testid="input-edit-rationale"
            />
          </div>
          <Button
            className="w-full"
            onClick={() => mutation.mutate({ targetPrice, stopLoss, rationale, trailingSlEnabled, trailingSlType: trailingSlEnabled ? trailingSlType : undefined, trailingSlValue: trailingSlEnabled ? trailingSlValue : undefined })}
            disabled={mutation.isPending}
            data-testid="button-save-edit-call"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Update
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditPositionDialog({
  position,
  onClose,
  strategyId,
}: {
  position: Position | null;
  onClose: () => void;
  strategyId: string;
}) {
  const { toast } = useToast();
  const [target, setTarget] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [rationale, setRationale] = useState("");
  const [trailingSlEnabled, setTrailingSlEnabled] = useState(false);
  const [trailingSlType, setTrailingSlType] = useState("PERCENTAGE");
  const [trailingSlValue, setTrailingSlValue] = useState("");

  useEffect(() => {
    if (position) {
      setTarget(position.target || "");
      setStopLoss(position.stopLoss || "");
      setRationale(position.rationale || "");
      setTrailingSlEnabled((position as any).trailingSlEnabled || false);
      setTrailingSlType((position as any).trailingSlType || "PERCENTAGE");
      setTrailingSlValue((position as any).trailingSlValue || "");
    }
  }, [position]);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/positions/${position?.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies", strategyId, "positions"] });
      onClose();
      toast({ title: "Position updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={!!position} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Position - {position?.symbol}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Target</Label>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              data-testid="input-edit-position-target"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Stop Loss</Label>
            <Input
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              data-testid="input-edit-position-stop-loss"
            />
          </div>
          <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Trailing SL</span>
              <button type="button" onClick={() => setTrailingSlEnabled(!trailingSlEnabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${trailingSlEnabled ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"}`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${trailingSlEnabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
              </button>
            </div>
            {trailingSlEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={trailingSlType} onValueChange={setTrailingSlType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">%</SelectItem>
                    <SelectItem value="POINTS">Pts</SelectItem>
                    <SelectItem value="PRICE">₹</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" step="0.1" min="0" value={trailingSlValue} onChange={(e) => setTrailingSlValue(e.target.value)} placeholder={trailingSlType === "PERCENTAGE" ? "e.g. 5" : trailingSlType === "POINTS" ? "e.g. 50" : "e.g. 250"} />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Rationale</Label>
            <Textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              placeholder="Add rationale (required before publishing)"
              data-testid="input-edit-position-rationale"
            />
          </div>
          <Button
            className="w-full"
            onClick={() => mutation.mutate({ target, stopLoss, rationale, trailingSlEnabled, trailingSlType: trailingSlEnabled ? trailingSlType : undefined, trailingSlValue: trailingSlEnabled ? trailingSlValue : undefined })}
            disabled={mutation.isPending}
            data-testid="button-save-edit-position"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Update
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CloseCallDialog({
  call,
  onClose,
  strategyId,
  strategyType,
  livePrices,
}: {
  call: Call | null;
  onClose: () => void;
  strategyId: string;
  strategyType: string;
  livePrices?: Record<string, { ltp: number; change: number; changePercent: number }>;
}) {
  const { toast } = useToast();
  const [sellPrice, setSellPrice] = useState("");
  const [useManualPrice, setUseManualPrice] = useState(false);

  useEffect(() => {
    if (call) {
      setSellPrice("");
      setUseManualPrice(false);
    }
  }, [call]);

  const isFnO = ["Option", "Future", "Index", "CommodityFuture"].includes(strategyType);
  const currentLTP = call ? livePrices?.[call.stockName]?.ltp : undefined;

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/calls/${call?.id}/close`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies", strategyId, "calls"] });
      onClose();
      toast({ title: "Call closed" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleFnOClose = () => {
    if (useManualPrice) {
      if (!sellPrice || Number(sellPrice) <= 0) {
        toast({ title: "Enter a valid exit price", variant: "destructive" });
        return;
      }
      mutation.mutate({ sellPrice });
      return;
    }
    if (!currentLTP) {
      toast({ title: "Market price unavailable", description: "Use 'Enter Price Manually' to provide the exit price.", variant: "destructive" });
      return;
    }
    mutation.mutate({ sellPrice: String(currentLTP), closeAtMarket: true });
  };

  return (
    <Dialog open={!!call} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Close Call - {call?.stockName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Entry: {call?.buyRangeStart ? Number(call.buyRangeStart).toFixed(2) : call?.entryPrice ? Number(call.entryPrice).toFixed(2) : "N/A"}
          </div>
          {isFnO ? (
            <>
              {!useManualPrice && currentLTP !== undefined ? (
                <div className="text-sm font-medium">
                  Current Market Price: {"\u20B9"}{currentLTP.toFixed(2)}
                </div>
              ) : !useManualPrice ? (
                <div className="text-sm text-amber-600 dark:text-amber-400">
                  Live price unavailable. Use manual entry below.
                </div>
              ) : null}
              {useManualPrice && (
                <div className="space-y-1.5">
                  <Label>Exit / Sell Price</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    placeholder="Enter exit price manually"
                    data-testid="input-manual-sell-price"
                  />
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setUseManualPrice(!useManualPrice)}
                data-testid="button-toggle-manual-price"
              >
                {useManualPrice ? "Use Market Price" : "Enter Price Manually"}
              </Button>
              <Button
                className="w-full"
                variant="destructive"
                onClick={handleFnOClose}
                disabled={mutation.isPending || (!useManualPrice && !currentLTP)}
                data-testid="button-confirm-close-call"
              >
                {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {useManualPrice ? "Close Call" : "Confirm Close at Market Price"}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Exit / Sell Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  placeholder="Enter exit price"
                  data-testid="input-sell-price"
                />
              </div>
              <Button
                className="w-full"
                variant="destructive"
                onClick={() => mutation.mutate({ sellPrice: sellPrice || undefined })}
                disabled={mutation.isPending}
                data-testid="button-confirm-close-call"
              >
                {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Close Call
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClosePositionDialog({
  position,
  onClose,
  strategyId,
  strategyType,
  livePrices,
  getOptionPremiumLTP,
}: {
  position: Position | null;
  onClose: () => void;
  strategyId: string;
  strategyType: string;
  livePrices?: Record<string, { ltp: number; change: number; changePercent: number }>;
  getOptionPremiumLTP: (pos: Position) => number | null;
}) {
  const { toast } = useToast();
  const [exitPrice, setExitPrice] = useState("");
  const [useManualPrice, setUseManualPrice] = useState(false);

  useEffect(() => {
    if (position) {
      setExitPrice("");
      setUseManualPrice(false);
    }
  }, [position]);

  const isFnO = ["Option", "Future", "Index", "CommodityFuture"].includes(strategyType) ||
    !!(position?.strikePrice && position?.expiry);
  const currentLTP = position ? (
    position.strikePrice && position.expiry
      ? getOptionPremiumLTP(position)
      : (position.symbol ? livePrices?.[position.symbol]?.ltp : undefined)
  ) : undefined;

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/positions/${position?.id}/close`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies", strategyId, "positions"] });
      onClose();
      toast({ title: "Position closed" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleFnOClose = () => {
    if (useManualPrice) {
      if (!exitPrice || Number(exitPrice) <= 0) {
        toast({ title: "Exit price required", description: "Please enter a valid exit price.", variant: "destructive" });
        return;
      }
      mutation.mutate({ exitPrice: String(exitPrice) });
      return;
    }
    if (!currentLTP) {
      toast({ title: "Market price unavailable", description: "Please enter exit price manually or wait for live price.", variant: "destructive" });
      return;
    }
    mutation.mutate({ exitPrice: String(currentLTP), closeAtMarket: true });
  };

  const symbolLabel = position
    ? `${position.symbol || ""}${position.expiry ? " " + position.expiry : ""}${position.strikePrice ? " " + position.strikePrice : ""}${position.callPut ? " " + position.callPut : ""}`.trim()
    : "";

  return (
    <Dialog open={!!position} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Close Position - {symbolLabel || position?.symbol}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Entry: {position?.entryPrice ? Number(position.entryPrice).toFixed(2) : "N/A"}
            {position?.buySell && <span className="ml-2">({position.buySell})</span>}
          </div>
          {isFnO ? (
            <>
              {!useManualPrice && currentLTP != null ? (
                <div className="text-sm font-medium">
                  Current Market Price: {"\u20B9"}{Number(currentLTP).toFixed(2)}
                </div>
              ) : !useManualPrice ? (
                <div className="text-sm text-amber-600 dark:text-amber-400">
                  Live price is loading or market is closed...
                </div>
              ) : null}
              {useManualPrice ? (
                <div className="space-y-1.5">
                  <Label>Exit / Close Price</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={exitPrice}
                    onChange={(e) => setExitPrice(e.target.value)}
                    placeholder="Enter exit price"
                    data-testid="input-exit-price-manual"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This F&O position will be closed at the prevailing market price.
                </p>
              )}
              <Button
                className="w-full"
                variant="destructive"
                onClick={handleFnOClose}
                disabled={mutation.isPending || (!useManualPrice && !currentLTP)}
                data-testid="button-confirm-close-position"
              >
                {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {useManualPrice ? "Close at Entered Price" : "Confirm Close at Market Price"}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setUseManualPrice(!useManualPrice)}
                data-testid="button-toggle-manual-price"
              >
                {useManualPrice ? "Use Market Price Instead" : "Enter Price Manually"}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Exit / Close Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  placeholder="Enter exit price"
                  data-testid="input-exit-price"
                />
              </div>
              <Button
                className="w-full"
                variant="destructive"
                onClick={() => mutation.mutate({ exitPrice: exitPrice || undefined })}
                disabled={mutation.isPending}
                data-testid="button-confirm-close-position"
              >
                {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Close Position
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StrategyDialog({
  open,
  onOpenChange,
  onSubmit,
  loading,
  plans,
  mode,
  strategy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: any) => void;
  loading: boolean;
  plans: Plan[];
  mode: "create" | "edit";
  strategy?: Strategy | null;
}) {
  const [form, setForm] = useState({
    name: "",
    type: "Equity",
    description: "",
    theme: [] as string[],
    managementStyle: "",
    horizon: "",
    volatility: "",
    benchmark: "",
    minimumInvestment: "",
    rebalanceFrequency: "",
    planIds: [] as string[],
  });

  useEffect(() => {
    if (mode === "edit" && strategy && open) {
      setForm({
        name: strategy.name || "",
        type: strategy.type || "Equity",
        description: strategy.description || "",
        theme: strategy.theme || [],
        managementStyle: strategy.managementStyle || "",
        horizon: strategy.horizon || "",
        volatility: strategy.volatility || "",
        benchmark: strategy.benchmark || "",
        minimumInvestment: strategy.minimumInvestment || "",
        rebalanceFrequency: (strategy as any).rebalanceFrequency || "",
        planIds: strategy.planIds || [],
      });
    } else if (mode === "create" && open) {
      setForm({
        name: "",
        type: "Equity",
        description: "",
        theme: [],
        managementStyle: "",
        horizon: "",
        volatility: "",
        benchmark: "",
        minimumInvestment: "",
        rebalanceFrequency: "",
        planIds: [],
      });
    }
  }, [mode, strategy, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const togglePlan = (planId: string) => {
    setForm((prev) => ({
      ...prev,
      planIds: prev.planIds.includes(planId)
        ? prev.planIds.filter((id) => id !== planId)
        : [...prev.planIds, planId],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit Strategy" : "Create New Strategy"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Strategy Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              data-testid="input-strategy-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Strategy Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger data-testid="select-strategy-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Equity">Equity</SelectItem>
                <SelectItem value="Basket">Basket</SelectItem>
                <SelectItem value="Future">Future</SelectItem>
                <SelectItem value="Commodity">Commodity</SelectItem>
                <SelectItem value="CommodityFuture">Commodity Future</SelectItem>
                <SelectItem value="Option">Option</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Horizon</Label>
            <Select value={form.horizon} onValueChange={(v) => setForm({ ...form, horizon: v })}>
              <SelectTrigger data-testid="select-horizon">
                <SelectValue placeholder="Select Horizon" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Intraday">Intraday</SelectItem>
                <SelectItem value="Positional">Positional</SelectItem>
                <SelectItem value="Short Term">Short Term</SelectItem>
                <SelectItem value="Swing">Swing</SelectItem>
                <SelectItem value="Long Term">Long Term</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Volatility</Label>
            <Select value={form.volatility} onValueChange={(v) => setForm({ ...form, volatility: v })}>
              <SelectTrigger data-testid="select-volatility">
                <SelectValue placeholder="Select Volatility" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="High">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Benchmark</Label>
            <Select value={form.benchmark} onValueChange={(v) => setForm({ ...form, benchmark: v })}>
              <SelectTrigger data-testid="select-benchmark">
                <SelectValue placeholder="Select Benchmark" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Nifty 50">Nifty 50</SelectItem>
                <SelectItem value="Sensex">Sensex</SelectItem>
                <SelectItem value="Nifty Bank">Nifty Bank</SelectItem>
                <SelectItem value="Nifty Midcap">Nifty Midcap</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.type === "Basket" && (
            <>
              <div className="space-y-1.5">
                <Label>Rebalance Frequency</Label>
                <Select value={form.rebalanceFrequency} onValueChange={(v) => setForm({ ...form, rebalanceFrequency: v })}>
                  <SelectTrigger data-testid="select-rebalance-frequency">
                    <SelectValue placeholder="Select Frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                    <SelectItem value="Quarterly">Quarterly</SelectItem>
                    <SelectItem value="Semi-Annual">Semi-Annual</SelectItem>
                    <SelectItem value="Annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Minimum Investment (₹)</Label>
                <Input
                  type="number"
                  step="1"
                  value={form.minimumInvestment}
                  onChange={(e) => setForm({ ...form, minimumInvestment: e.target.value })}
                  placeholder="e.g. 50000"
                  data-testid="input-minimum-investment"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4}
              data-testid="input-strategy-description"
            />
          </div>

          {plans.length > 0 && (
            <div className="space-y-2">
              <Label>Map Pricing Plans</Label>
              <p className="text-xs text-muted-foreground">Select which plans apply to this strategy</p>
              <div className="space-y-2 rounded-md border p-3">
                {plans.map((plan) => (
                  <div key={plan.id} className="flex items-center gap-2" data-testid={`plan-option-${plan.id}`}>
                    <Checkbox
                      checked={form.planIds.includes(plan.id)}
                      onCheckedChange={() => togglePlan(plan.id)}
                      data-testid={`checkbox-plan-${plan.id}`}
                    />
                    <Label className="text-sm font-normal cursor-pointer flex items-center gap-2 flex-wrap">
                      <span>{plan.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {plan.code}
                      </Badge>
                      <span className="text-muted-foreground">
                        {"\u20B9"}{Number(plan.amount).toLocaleString("en-IN")}
                      </span>
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading} data-testid="button-save-strategy">
            {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {mode === "edit" ? "Update Strategy" : "Save & Next"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddStockSheet({
  open,
  onOpenChange,
  strategy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  strategy: Strategy | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    stockName: "",
    action: "Buy",
    buyRangeStart: "",
    buyRangeEnd: "",
    targetPrice: "",
    stopLoss: "",
    trailingSlEnabled: false,
    trailingSlType: "PERCENTAGE",
    trailingSlValue: "",
    duration: "",
    durationUnit: "Days",
    theme: "",
    rationale: "",
    publishMode: "draft" as "draft" | "watchlist" | "live",
    isPublished: false,
  });

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/strategies/${strategy?.id}/calls`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies", strategy?.id, "calls"] });
      onOpenChange(false);
      toast({ title: "Stock call added" });
      setForm({
        stockName: "",
        action: "Buy",
        buyRangeStart: "",
        buyRangeEnd: "",
        targetPrice: "",
        stopLoss: "",
        trailingSlEnabled: false,
        trailingSlType: "PERCENTAGE",
        trailingSlValue: "",
        duration: "",
        durationUnit: "Days",
        theme: "",
        rationale: "",
        publishMode: "draft",
        isPublished: false,
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.publishMode === "live" && !form.rationale.trim()) {
      toast({ title: "Rationale is required to publish a call", variant: "destructive" });
      return;
    }
    mutation.mutate({
      ...form,
      strategyId: strategy?.id,
      isPublished: form.publishMode === "live",
      buyRangeStart: form.buyRangeStart || undefined,
      buyRangeEnd: form.buyRangeEnd || undefined,
      targetPrice: form.targetPrice || undefined,
      stopLoss: form.stopLoss || undefined,
      trailingSlEnabled: form.trailingSlEnabled,
      trailingSlType: form.trailingSlEnabled ? form.trailingSlType : undefined,
      trailingSlValue: form.trailingSlEnabled ? form.trailingSlValue : undefined,
      duration: form.duration ? parseInt(form.duration) : undefined,
      durationUnit: form.duration ? form.durationUnit : undefined,
      theme: form.theme || undefined,
    });
  };

  const segmentForSearch = strategy?.type === "Commodity" || strategy?.type === "CommodityFuture" ? "Commodity" : "Equity";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Stock Call</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-1.5">
            <Label>Stock Name</Label>
            <SymbolAutocomplete
              value={form.stockName}
              onChange={(v) => setForm({ ...form, stockName: v })}
              segment={segmentForSearch}
              testId="input-stock-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Buy/Sell</Label>
            <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v })}>
              <SelectTrigger data-testid="select-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Buy">Buy</SelectItem>
                <SelectItem value="Sell">Sell</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Buy Range Start</Label>
            <Input
              type="number"
              step="0.01"
              value={form.buyRangeStart}
              onChange={(e) => setForm({ ...form, buyRangeStart: e.target.value })}
              data-testid="input-buy-range-start"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Buy Range End</Label>
            <Input
              type="number"
              step="0.01"
              value={form.buyRangeEnd}
              onChange={(e) => setForm({ ...form, buyRangeEnd: e.target.value })}
              data-testid="input-buy-range-end"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Target Price</Label>
            <Input
              type="number"
              step="0.01"
              value={form.targetPrice}
              onChange={(e) => setForm({ ...form, targetPrice: e.target.value })}
              data-testid="input-target-price"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Stop Loss</Label>
            <Input
              type="number"
              step="0.01"
              value={form.stopLoss}
              onChange={(e) => setForm({ ...form, stopLoss: e.target.value })}
              data-testid="input-stop-loss"
            />
          </div>
          <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium cursor-pointer" onClick={() => setForm({ ...form, trailingSlEnabled: !form.trailingSlEnabled })}>Trailing Stop Loss</Label>
              <button
                type="button"
                onClick={() => setForm({ ...form, trailingSlEnabled: !form.trailingSlEnabled })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.trailingSlEnabled ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"}`}
                data-testid="toggle-trailing-sl"
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${form.trailingSlEnabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
              </button>
            </div>
            {form.trailingSlEnabled && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Auto-adjusts your SL upward as price moves in your favor.</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select value={form.trailingSlType} onValueChange={(v) => setForm({ ...form, trailingSlType: v })}>
                      <SelectTrigger data-testid="select-trailing-sl-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                        <SelectItem value="POINTS">Points (Abs)</SelectItem>
                        <SelectItem value="PRICE">Price (₹)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Value {form.trailingSlType === "PERCENTAGE" ? "(%)" : form.trailingSlType === "POINTS" ? "(Pts)" : "(₹)"}</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      value={form.trailingSlValue}
                      onChange={(e) => setForm({ ...form, trailingSlValue: e.target.value })}
                      placeholder={form.trailingSlType === "PERCENTAGE" ? "e.g. 5" : form.trailingSlType === "POINTS" ? "e.g. 50" : "e.g. 250"}
                      data-testid="input-trailing-sl-value"
                    />
                  </div>
                </div>
                {form.trailingSlValue && (
                  <p className="text-xs text-green-600 dark:text-green-400">
                    SL will trail {form.trailingSlValue}{form.trailingSlType === "PERCENTAGE" ? "%" : form.trailingSlType === "POINTS" ? " pts" : " ₹"} below the highest price
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Duration</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
                placeholder="e.g. 3"
                className="flex-1"
                data-testid="input-duration"
              />
              <Select value={form.durationUnit} onValueChange={(v) => setForm({ ...form, durationUnit: v })}>
                <SelectTrigger className="w-[120px]" data-testid="select-duration-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Days">Days</SelectItem>
                  <SelectItem value="Weeks">Weeks</SelectItem>
                  <SelectItem value="Months">Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Theme</Label>
            <Select value={form.theme} onValueChange={(v) => setForm({ ...form, theme: v })}>
              <SelectTrigger data-testid="select-theme">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BTST">BTST</SelectItem>
                <SelectItem value="Momentum">Momentum</SelectItem>
                <SelectItem value="High Volatility">High Volatility</SelectItem>
                <SelectItem value="Short Term">Short Term</SelectItem>
                <SelectItem value="Medium Term">Medium Term</SelectItem>
                <SelectItem value="Long Term">Long Term</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Rationale <span className="text-destructive">*</span></Label>
            <Textarea
              value={form.rationale}
              onChange={(e) => setForm({ ...form, rationale: e.target.value })}
              rows={3}
              placeholder="Type your rationale for this call (required to publish)"
              data-testid="input-rationale"
            />
            {form.publishMode === "live" && !form.rationale.trim() && (
              <p className="text-xs text-destructive">Rationale is required to publish</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Publish Mode</Label>
            <Select value={form.publishMode} onValueChange={(v: "draft" | "watchlist" | "live") => setForm({ ...form, publishMode: v, isPublished: v === "live" })}>
              <SelectTrigger data-testid="select-publish-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="watchlist">Watchlist</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {form.publishMode === "draft" && "Saved privately, not visible to subscribers"}
              {form.publishMode === "watchlist" && "Saved to watchlist for monitoring"}
              {form.publishMode === "live" && "Published as an active recommendation"}
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={mutation.isPending} data-testid="button-save-stock">
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {form.publishMode === "live" ? "Publish Live" : form.publishMode === "watchlist" ? "Add to Watchlist" : "Save Draft"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function AddPositionSheet({
  open,
  onOpenChange,
  strategy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  strategy: Strategy | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    segment: "Equity",
    callPut: "Call",
    buySell: "Buy",
    symbol: "",
    expiry: "",
    strikePrice: "",
    entryPrice: "",
    lots: "",
    target: "",
    stopLoss: "",
    duration: "",
    durationUnit: "Days",
    theme: "",
    rationale: "",
    isPublished: false,
    publishMode: "draft" as "draft" | "watchlist" | "live",
    enableLeg: false,
    usePercentage: false,
    trailingSlEnabled: false,
    trailingSlType: "PERCENTAGE",
    trailingSlValue: "",
  });
  const [manualEntry, setManualEntry] = useState(false);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/strategies/${strategy?.id}/positions`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/strategies", strategy?.id, "positions"] });
      onOpenChange(false);
      toast({ title: "Position added" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isPublished = form.publishMode === "live" || form.publishMode === "watchlist";
    if (isPublished && !form.rationale.trim()) {
      toast({ title: "Rationale is required to publish a position", variant: "destructive" });
      return;
    }
    mutation.mutate({
      ...form,
      isPublished,
      publishMode: form.publishMode,
      strategyId: strategy?.id,
      strikePrice: form.strikePrice || undefined,
      entryPrice: form.entryPrice || undefined,
      lots: form.lots ? parseInt(form.lots) : undefined,
      target: form.target || undefined,
      stopLoss: form.stopLoss || undefined,
      trailingSlEnabled: form.trailingSlEnabled,
      trailingSlType: form.trailingSlEnabled ? form.trailingSlType : undefined,
      trailingSlValue: form.trailingSlEnabled ? form.trailingSlValue : undefined,
      duration: form.duration ? parseInt(form.duration) : undefined,
      durationUnit: form.duration ? form.durationUnit : undefined,
      theme: form.theme || undefined,
    });
  };

  const segmentForSearch = form.segment === "Equity" ? "Equity" : form.segment === "Index" ? "Index" : "FnO";
  const isFnOSegment = form.segment === "Option" || form.segment === "Future" || form.segment === "Index";
  const symbolExchange = form.segment === "Index" ? (["SENSEX", "BANKEX"].includes(form.symbol.toUpperCase()) ? "BSE" : "NSE") : "NSE";

  const now = new Date();
  const { data: expiries, isLoading: expiriesLoading } = useQuery<string[]>({
    queryKey: ["/api/option-chain/expiries", form.symbol, symbolExchange, now.getFullYear(), now.getMonth() + 1],
    queryFn: async () => {
      if (!form.symbol) return [];
      const res = await fetch(`/api/option-chain/expiries?symbol=${encodeURIComponent(form.symbol)}&exchange=${symbolExchange}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isFnOSegment && form.symbol.length > 1,
  });

  const { data: optionChain, isLoading: chainLoading } = useQuery<any[]>({
    queryKey: ["/api/option-chain", form.symbol, symbolExchange, form.expiry],
    queryFn: async () => {
      if (!form.symbol || !form.expiry) return [];
      const res = await fetch(`/api/option-chain?symbol=${encodeURIComponent(form.symbol)}&exchange=${symbolExchange}&expiry=${encodeURIComponent(form.expiry)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isFnOSegment && form.symbol.length > 1 && !!form.expiry,
  });

  const selectedStrike = optionChain?.find((s: any) => String(s.strikePrice) === form.strikePrice);
  const optionLTP = selectedStrike
    ? (form.callPut === "Call" ? selectedStrike.ce?.ltp : selectedStrike.pe?.ltp) || null
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Position</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.enableLeg}
              onCheckedChange={(v) => setForm({ ...form, enableLeg: !!v })}
              data-testid="checkbox-enable-leg"
            />
            <Label className="text-sm">Enable Leg</Label>
          </div>
          <div className="space-y-1.5">
            <Label>Segment</Label>
            <div className="flex flex-wrap gap-1">
              {["Equity", "Index", "Future", "Option"].map((seg) => (
                <Button
                  key={seg}
                  type="button"
                  variant={form.segment === seg ? "default" : "outline"}
                  size="sm"
                  onClick={() => setForm({ ...form, segment: seg, expiry: "", strikePrice: "" })}
                  data-testid={`button-segment-${seg.toLowerCase()}`}
                >
                  {seg}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1">
              {["Call", "Put"].map((cp) => (
                <Button
                  key={cp}
                  type="button"
                  variant={form.callPut === cp ? "default" : "outline"}
                  size="sm"
                  onClick={() => setForm({ ...form, callPut: cp })}
                >
                  {cp}
                </Button>
              ))}
              <div className="w-2" />
              {["Buy", "Sell"].map((bs) => (
                <Button
                  key={bs}
                  type="button"
                  variant={form.buySell === bs ? "default" : "outline"}
                  size="sm"
                  onClick={() => setForm({ ...form, buySell: bs })}
                >
                  {bs}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Symbol</Label>
            <SymbolAutocomplete
              value={form.symbol}
              onChange={(v) => setForm({ ...form, symbol: v, expiry: "", strikePrice: "" })}
              segment={segmentForSearch}
              testId="input-symbol"
            />
          </div>

          {isFnOSegment && (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={manualEntry}
                onCheckedChange={(v) => setManualEntry(!!v)}
                data-testid="checkbox-manual-entry"
              />
              <Label className="text-sm">Manual Entry (type expiry & strike manually)</Label>
            </div>
          )}

          {isFnOSegment && form.symbol && !manualEntry ? (
            <>
              <div className="space-y-1.5">
                <Label>Expiry Date</Label>
                {expiriesLoading ? (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading expiries...</div>
                ) : expiries && expiries.length > 0 ? (
                  <Select value={form.expiry} onValueChange={(v) => setForm({ ...form, expiry: v, strikePrice: "" })}>
                    <SelectTrigger data-testid="select-expiry">
                      <SelectValue placeholder="Select expiry date" />
                    </SelectTrigger>
                    <SelectContent>
                      {expiries.map((exp: string) => (
                        <SelectItem key={exp} value={exp}>
                          {new Date(exp).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={form.expiry}
                    onChange={(e) => setForm({ ...form, expiry: e.target.value })}
                    placeholder="YYYY-MM-DD"
                    data-testid="input-expiry"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Strike Price</Label>
                {chainLoading ? (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading option chain...</div>
                ) : optionChain && optionChain.length > 0 ? (
                  <Select value={form.strikePrice} onValueChange={(v) => setForm({ ...form, strikePrice: v })}>
                    <SelectTrigger data-testid="select-strike-price">
                      <SelectValue placeholder="Select strike price" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {optionChain.map((s: any) => {
                        const ceLtp = s.ce?.ltp ? `CE: ${"\u20B9"}${s.ce.ltp.toFixed(2)}` : "";
                        const peLtp = s.pe?.ltp ? `PE: ${"\u20B9"}${s.pe.ltp.toFixed(2)}` : "";
                        return (
                          <SelectItem key={s.strikePrice} value={String(s.strikePrice)}>
                            {"\u20B9"}{Number(s.strikePrice).toLocaleString("en-IN", { minimumFractionDigits: 2 })} {ceLtp ? `(${ceLtp})` : ""} {peLtp ? `(${peLtp})` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="number"
                    step="0.01"
                    value={form.strikePrice}
                    onChange={(e) => setForm({ ...form, strikePrice: e.target.value })}
                    data-testid="input-strike-price"
                  />
                )}
                {optionLTP !== null && (
                  <p className="text-xs font-medium text-green-600 dark:text-green-400">
                    Live {form.callPut} Premium: {"\u20B9"}{optionLTP.toFixed(2)}
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Expiry Date</Label>
                <Input
                  value={form.expiry}
                  onChange={(e) => setForm({ ...form, expiry: e.target.value })}
                  placeholder="YYYY-MM-DD (e.g. 2026-02-10)"
                  data-testid="input-expiry"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Strike Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.strikePrice}
                  onChange={(e) => setForm({ ...form, strikePrice: e.target.value })}
                  placeholder="e.g. 25650"
                  data-testid="input-strike-price"
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>Entry Price {isFnOSegment && optionLTP !== null && <span className="text-xs font-normal text-muted-foreground ml-1">(Current {form.callPut} Premium: {"\u20B9"}{optionLTP.toFixed(2)})</span>}</Label>
            <Input
              type="number"
              step="0.01"
              value={form.entryPrice}
              onChange={(e) => setForm({ ...form, entryPrice: e.target.value })}
              placeholder={isFnOSegment && optionLTP !== null ? `Current premium: ${optionLTP.toFixed(2)}` : ""}
              data-testid="input-entry-price"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Lots</Label>
            <Input
              type="number"
              value={form.lots}
              onChange={(e) => setForm({ ...form, lots: e.target.value })}
              data-testid="input-lots"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.usePercentage}
              onCheckedChange={(v) => setForm({ ...form, usePercentage: !!v })}
            />
            <Label className="text-sm">Switch Target & Stop Loss to Percentage</Label>
          </div>
          <div className="space-y-1.5">
            <Label>Target</Label>
            <Input
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              data-testid="input-target"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Stop Loss</Label>
            <Input
              value={form.stopLoss}
              onChange={(e) => setForm({ ...form, stopLoss: e.target.value })}
              data-testid="input-position-stop-loss"
            />
          </div>
          <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium cursor-pointer" onClick={() => setForm({ ...form, trailingSlEnabled: !form.trailingSlEnabled })}>Trailing Stop Loss</Label>
              <button
                type="button"
                onClick={() => setForm({ ...form, trailingSlEnabled: !form.trailingSlEnabled })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.trailingSlEnabled ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"}`}
                data-testid="toggle-position-trailing-sl"
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${form.trailingSlEnabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
              </button>
            </div>
            {form.trailingSlEnabled && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Auto-adjusts your SL as price moves in your favor.</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select value={form.trailingSlType} onValueChange={(v) => setForm({ ...form, trailingSlType: v })}>
                      <SelectTrigger data-testid="select-position-trailing-sl-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                        <SelectItem value="POINTS">Points (Abs)</SelectItem>
                        <SelectItem value="PRICE">Price (₹)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Value {form.trailingSlType === "PERCENTAGE" ? "(%)" : form.trailingSlType === "POINTS" ? "(Pts)" : "(₹)"}</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      value={form.trailingSlValue}
                      onChange={(e) => setForm({ ...form, trailingSlValue: e.target.value })}
                      placeholder={form.trailingSlType === "PERCENTAGE" ? "e.g. 5" : form.trailingSlType === "POINTS" ? "e.g. 50" : "e.g. 250"}
                      data-testid="input-position-trailing-sl-value"
                    />
                  </div>
                </div>
                {form.trailingSlValue && (
                  <p className="text-xs text-green-600 dark:text-green-400">
                    SL will trail {form.trailingSlValue}{form.trailingSlType === "PERCENTAGE" ? "%" : form.trailingSlType === "POINTS" ? " pts" : " ₹"} below the highest price
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Duration</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
                placeholder="e.g. 3"
                className="flex-1"
                data-testid="input-position-duration"
              />
              <Select value={form.durationUnit} onValueChange={(v) => setForm({ ...form, durationUnit: v })}>
                <SelectTrigger className="w-[120px]" data-testid="select-position-duration-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Days">Days</SelectItem>
                  <SelectItem value="Weeks">Weeks</SelectItem>
                  <SelectItem value="Months">Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Theme</Label>
            <Select value={form.theme} onValueChange={(v) => setForm({ ...form, theme: v })}>
              <SelectTrigger data-testid="select-position-theme">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BTST">BTST</SelectItem>
                <SelectItem value="Momentum">Momentum</SelectItem>
                <SelectItem value="High Volatility">High Volatility</SelectItem>
                <SelectItem value="Short Term">Short Term</SelectItem>
                <SelectItem value="Medium Term">Medium Term</SelectItem>
                <SelectItem value="Long Term">Long Term</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Rationale <span className="text-destructive">*</span></Label>
            <Textarea
              value={form.rationale}
              onChange={(e) => setForm({ ...form, rationale: e.target.value })}
              rows={3}
              placeholder="Type your rationale for this position (required to publish)"
              data-testid="input-position-rationale"
            />
            {(form.publishMode === "live" || form.publishMode === "watchlist") && !form.rationale.trim() && (
              <p className="text-xs text-destructive">Rationale is required to publish</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Publish Mode</Label>
            <Select value={form.publishMode} onValueChange={(v: "draft" | "watchlist" | "live") => setForm({ ...form, publishMode: v, isPublished: v !== "draft" })}>
              <SelectTrigger data-testid="select-publish-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft (Save without publishing)</SelectItem>
                <SelectItem value="watchlist">Watchlist (Monitor only)</SelectItem>
                <SelectItem value="live">Live (Active recommendation)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {form.publishMode === "draft" && "Saved privately, not visible to subscribers"}
              {form.publishMode === "watchlist" && "Visible to subscribers as a watchlist item"}
              {form.publishMode === "live" && "Published as an active trade recommendation"}
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={mutation.isPending} data-testid="button-save-position">
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {form.publishMode === "live" ? "Publish Live" : form.publishMode === "watchlist" ? "Add to Watchlist" : "Save Draft"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function AddBasketStockSheet({
  open,
  onOpenChange,
  strategy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  strategy: Strategy | null;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stocks, setStocks] = useState<{ symbol: string; exchange: string; weightPercent: string; quantity: string; priceAtRebalance: string; action: string }[]>([
    { symbol: "", exchange: "NSE", weightPercent: "", quantity: "", priceAtRebalance: "", action: "Buy" },
  ]);
  const [rebalanceNotes, setRebalanceNotes] = useState("");

  const { data: currentConstituents } = useQuery<BasketConstituent[]>({
    queryKey: ["/api/strategies", strategy?.id, "basket", "constituents"],
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${strategy?.id}/basket/constituents`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!strategy?.id && open,
  });

  const { data: rebalances } = useQuery<BasketRebalance[]>({
    queryKey: ["/api/strategies", strategy?.id, "basket", "rebalances"],
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${strategy?.id}/basket/rebalances`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!strategy?.id && open,
  });

  const rebalanceMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/strategies/${strategy?.id}/basket/rebalance`, data);
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies", strategy?.id, "basket", "rebalances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategies", strategy?.id, "basket", "constituents"] });
      onOpenChange(false);
      setStocks([{ symbol: "", exchange: "NSE", weightPercent: "", quantity: "", priceAtRebalance: "", action: "Buy" }]);
      setRebalanceNotes("");
      toast({ title: "Basket updated successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addStock = () => {
    setStocks([...stocks, { symbol: "", exchange: "NSE", weightPercent: "", quantity: "", priceAtRebalance: "", action: "Buy" }]);
  };

  const removeStock = (idx: number) => {
    setStocks(stocks.filter((_, i) => i !== idx));
  };

  const updateStock = (idx: number, field: string, value: string) => {
    const updated = [...stocks];
    (updated[idx] as any)[field] = value;
    setStocks(updated);
  };

  const loadCurrent = () => {
    if (currentConstituents && currentConstituents.length > 0) {
      setStocks(currentConstituents.map(c => ({
        symbol: c.symbol,
        exchange: c.exchange || "NSE",
        weightPercent: String(c.weightPercent),
        quantity: c.quantity ? String(c.quantity) : "",
        priceAtRebalance: c.priceAtRebalance ? String(c.priceAtRebalance) : "",
        action: c.action || "Buy",
      })));
    }
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    parseBasketFile(
      file,
      (parsed) => { setStocks(parsed); toast({ title: `Loaded ${parsed.length} stocks from CSV/Excel` }); },
      (msg) => { toast({ title: msg, variant: "destructive" }); }
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const totalWeight = stocks.reduce((sum, c) => sum + Number(c.weightPercent || 0), 0);

  const handleSubmit = () => {
    const validStocks = stocks.filter(s => s.symbol.trim());
    if (validStocks.length === 0) {
      toast({ title: "Add at least one stock", variant: "destructive" });
      return;
    }
    const invalidWeights = validStocks.some(c => !c.weightPercent || isNaN(Number(c.weightPercent)) || Number(c.weightPercent) <= 0);
    if (invalidWeights) {
      toast({ title: "All stocks must have a valid weight > 0", variant: "destructive" });
      return;
    }
    if (Math.abs(totalWeight - 100) > 0.5) {
      toast({ title: "Total weight must equal 100%", description: `Current total: ${totalWeight.toFixed(1)}%`, variant: "destructive" });
      return;
    }
    rebalanceMutation.mutate({
      constituents: validStocks.map(c => ({
        symbol: c.symbol,
        exchange: c.exchange,
        weightPercent: Number(c.weightPercent),
        quantity: c.quantity ? Number(c.quantity) : null,
        priceAtRebalance: c.priceAtRebalance ? Number(c.priceAtRebalance) : null,
        action: c.action,
      })),
      notes: rebalanceNotes || null,
    });
  };

  const isUpdate = (rebalances?.length || 0) > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            {isUpdate ? "Update Basket Stocks" : "Add Basket Stocks"}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <p className="text-sm font-medium">{stocks.length} Stock{stocks.length !== 1 ? "s" : ""}</p>
              <p className={`text-xs ${Math.abs(totalWeight - 100) <= 0.5 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                Total Weight: {totalWeight.toFixed(1)}%
                {Math.abs(totalWeight - 100) > 0.5 && " (must equal 100%)"}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {currentConstituents && currentConstituents.length > 0 && (
                <Button size="sm" variant="outline" onClick={loadCurrent} data-testid="button-load-current-basket">
                  Load Current
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={addStock} data-testid="button-add-basket-stock">
                <Plus className="w-3 h-3 mr-1" /> Add Stock
              </Button>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  onChange={handleCSVUpload}
                  className="hidden"
                  data-testid="input-csv-upload"
                />
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-upload-csv">
                  <Upload className="w-3 h-3 mr-1" /> Upload CSV
                </Button>
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded-md">
            CSV format: Symbol, Exchange, Weight%, Quantity, Price, Action
          </div>

          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm" data-testid="table-basket-stock-entry">
              <thead className="bg-indigo-50 dark:bg-indigo-950/30">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">Symbol</th>
                  <th className="text-left px-2 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300 w-20">Exch</th>
                  <th className="text-left px-2 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300 w-20">Weight%</th>
                  <th className="text-left px-2 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300 w-16">Qty</th>
                  <th className="text-left px-2 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300 w-24">Price</th>
                  <th className="text-left px-2 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300 w-20">Action</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s, idx) => (
                  <tr key={idx} className="border-t" data-testid={`basket-stock-row-${idx}`}>
                    <td className="px-2 py-1.5">
                      <SymbolAutocomplete
                        value={s.symbol}
                        onChange={(v) => updateStock(idx, "symbol", v)}
                        testId={`input-basket-symbol-${idx}`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select value={s.exchange} onValueChange={(v) => updateStock(idx, "exchange", v)}>
                        <SelectTrigger className="h-8 text-xs" data-testid={`select-basket-exchange-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NSE">NSE</SelectItem>
                          <SelectItem value="BSE">BSE</SelectItem>
                          <SelectItem value="MCX">MCX</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        step="0.1"
                        value={s.weightPercent}
                        onChange={(e) => updateStock(idx, "weightPercent", e.target.value)}
                        className="h-8 text-xs"
                        placeholder="%"
                        data-testid={`input-basket-weight-${idx}`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={s.quantity}
                        onChange={(e) => updateStock(idx, "quantity", e.target.value)}
                        className="h-8 text-xs"
                        placeholder="Qty"
                        data-testid={`input-basket-qty-${idx}`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        value={s.priceAtRebalance}
                        onChange={(e) => updateStock(idx, "priceAtRebalance", e.target.value)}
                        className="h-8 text-xs"
                        placeholder="₹"
                        data-testid={`input-basket-price-${idx}`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select value={s.action} onValueChange={(v) => updateStock(idx, "action", v)}>
                        <SelectTrigger className="h-8 text-xs" data-testid={`select-basket-action-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Buy">Buy</SelectItem>
                          <SelectItem value="Sell">Sell</SelectItem>
                          <SelectItem value="Hold">Hold</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1.5">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeStock(idx)} data-testid={`button-remove-basket-stock-${idx}`}>
                        <X className="w-3 h-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea
              value={rebalanceNotes}
              onChange={(e) => setRebalanceNotes(e.target.value)}
              rows={2}
              placeholder="Why are you making this change?"
              data-testid="input-basket-notes"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={rebalanceMutation.isPending || stocks.length === 0 || Math.abs(totalWeight - 100) > 0.5}
            data-testid="button-submit-basket-stocks"
          >
            {rebalanceMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {isUpdate ? "Update Basket" : "Create Basket"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BasketBuilderPanel({ strategy }: { strategy: Strategy }) {
  const { toast } = useToast();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [showRebalance, setShowRebalance] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [constituents, setConstituents] = useState<{ symbol: string; exchange: string; weightPercent: string; quantity: string; priceAtRebalance: string; action: string }[]>([]);
  const [rebalanceNotes, setRebalanceNotes] = useState("");
  const [rationaleTitle, setRationaleTitle] = useState("");
  const [rationaleBody, setRationaleBody] = useState("");
  const [rationaleCategory, setRationaleCategory] = useState("general");

  const { data: rebalances, isLoading: rebalancesLoading } = useQuery<BasketRebalance[]>({
    queryKey: ["/api/strategies", strategy.id, "basket", "rebalances"],
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${strategy.id}/basket/rebalances`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: currentConstituents } = useQuery<BasketConstituent[]>({
    queryKey: ["/api/strategies", strategy.id, "basket", "constituents"],
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${strategy.id}/basket/constituents`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: rationales } = useQuery<BasketRationale[]>({
    queryKey: ["/api/strategies", strategy.id, "basket", "rationales"],
    queryFn: async () => {
      const res = await fetch(`/api/strategies/${strategy.id}/basket/rationales`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const rebalanceMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/strategies/${strategy.id}/basket/rebalance`, data);
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies", strategy.id, "basket", "rebalances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategies", strategy.id, "basket", "constituents"] });
      setShowRebalance(false);
      setConstituents([]);
      setRebalanceNotes("");
      toast({ title: "Basket rebalanced successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rationaleMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/strategies/${strategy.id}/basket/rationale`, data);
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies", strategy.id, "basket", "rationales"] });
      setShowRationale(false);
      setRationaleTitle("");
      setRationaleBody("");
      toast({ title: "Rationale added" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteRationaleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/strategies/${strategy.id}/basket/rationale/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies", strategy.id, "basket", "rationales"] });
      toast({ title: "Rationale removed" });
    },
  });

  const handleBuilderCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    parseBasketFile(
      file,
      (parsed) => { setConstituents(parsed); toast({ title: `Loaded ${parsed.length} stocks from CSV/Excel` }); },
      (msg) => { toast({ title: msg, variant: "destructive" }); }
    );
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  const addConstituent = () => {
    setConstituents([...constituents, { symbol: "", exchange: "NSE", weightPercent: "", quantity: "", priceAtRebalance: "", action: "Buy" }]);
  };

  const removeConstituent = (index: number) => {
    setConstituents(constituents.filter((_, i) => i !== index));
  };

  const updateConstituent = (index: number, field: string, value: string) => {
    const updated = [...constituents];
    (updated[index] as any)[field] = value;
    setConstituents(updated);
  };

  const totalWeight = constituents.reduce((sum, c) => sum + Number(c.weightPercent || 0), 0);

  const handleLoadCurrent = () => {
    if (currentConstituents && currentConstituents.length > 0) {
      setConstituents(currentConstituents.map(c => ({
        symbol: c.symbol,
        exchange: c.exchange || "NSE",
        weightPercent: String(c.weightPercent),
        quantity: c.quantity ? String(c.quantity) : "",
        priceAtRebalance: c.priceAtRebalance ? String(c.priceAtRebalance) : "",
        action: c.action || "Buy",
      })));
    }
  };

  const handleSubmitRebalance = () => {
    if (constituents.length === 0) {
      toast({ title: "Add at least one stock", variant: "destructive" });
      return;
    }
    const emptySymbols = constituents.some(c => !c.symbol.trim());
    if (emptySymbols) {
      toast({ title: "All stocks must have a symbol", variant: "destructive" });
      return;
    }
    const invalidWeights = constituents.some(c => !c.weightPercent || isNaN(Number(c.weightPercent)) || Number(c.weightPercent) <= 0);
    if (invalidWeights) {
      toast({ title: "All stocks must have a valid weight greater than 0", variant: "destructive" });
      return;
    }
    if (Math.abs(totalWeight - 100) > 0.5) {
      toast({ title: "Total weight must equal 100%", description: `Current total: ${totalWeight.toFixed(1)}%. Adjust weights before submitting.`, variant: "destructive" });
      return;
    }
    rebalanceMutation.mutate({
      constituents: constituents.map(c => ({
        symbol: c.symbol,
        exchange: c.exchange,
        weightPercent: Number(c.weightPercent),
        quantity: c.quantity ? Number(c.quantity) : null,
        priceAtRebalance: c.priceAtRebalance ? Number(c.priceAtRebalance) : null,
        action: c.action,
      })),
      notes: rebalanceNotes || null,
    });
  };

  if (rebalancesLoading) {
    return <Skeleton className="h-20 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h4 className="text-sm font-semibold flex items-center gap-1.5">
            <Package className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Basket Composition
          </h4>
          <p className="text-xs text-muted-foreground">
            {currentConstituents?.length || 0} stocks | {rebalances?.length || 0} rebalance{(rebalances?.length || 0) !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRationale(true)}
            data-testid="button-add-rationale"
          >
            <FileText className="w-3 h-3 mr-1" /> Add Rationale
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setShowRebalance(true);
              if (currentConstituents && currentConstituents.length > 0 && constituents.length === 0) {
                handleLoadCurrent();
              } else if (constituents.length === 0) {
                addConstituent();
              }
            }}
            data-testid="button-rebalance"
          >
            <RefreshCw className="w-3 h-3 mr-1" /> {rebalances?.length ? "Rebalance" : "Create Basket"}
          </Button>
        </div>
      </div>

      {currentConstituents && currentConstituents.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm" data-testid="table-basket-constituents">
            <thead className="bg-indigo-50 dark:bg-indigo-950/30">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">Stock</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">Exchange</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">Weight %</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">Qty</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">Price</th>
                <th className="text-center px-3 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">Action</th>
              </tr>
            </thead>
            <tbody>
              {currentConstituents.map((c) => (
                <tr key={c.id} className="border-t" data-testid={`row-constituent-${c.symbol}`}>
                  <td className="px-3 py-2 font-medium">{c.symbol}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.exchange}</td>
                  <td className="px-3 py-2 text-right">{Number(c.weightPercent).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{c.quantity || "-"}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{c.priceAtRebalance ? `₹${Number(c.priceAtRebalance).toFixed(2)}` : "-"}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={c.action === "Buy" ? "default" : "secondary"} className="text-xs">
                      {c.action}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(!currentConstituents || currentConstituents.length === 0) && !showRebalance && (
        <div className="text-center py-6 border rounded-md bg-indigo-50/50 dark:bg-indigo-950/20">
          <Package className="w-8 h-8 text-indigo-400 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No basket composition yet.</p>
          <p className="text-xs text-muted-foreground">Click "Create Basket" to add stocks with their weights.</p>
        </div>
      )}

      {rebalances && rebalances.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-medium text-muted-foreground">Rebalance History</h5>
          {rebalances.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-xs p-2 rounded border" data-testid={`rebalance-${r.id}`}>
              <Badge variant="outline" className="text-xs">V{r.version}</Badge>
              <span className="text-muted-foreground">
                {r.effectiveDate ? new Date(r.effectiveDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
              </span>
              {r.notes && <span className="text-muted-foreground truncate max-w-[200px]">— {r.notes}</span>}
            </div>
          ))}
        </div>
      )}

      {rationales && rationales.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-medium text-muted-foreground">Recommendation Rationale</h5>
          {rationales.map((r) => (
            <div key={r.id} className="p-3 border rounded-md space-y-1" data-testid={`rationale-${r.id}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-3 h-3 text-indigo-500" />
                  <span className="text-sm font-medium">{r.title}</span>
                  <Badge variant="secondary" className="text-xs">{r.category}</Badge>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => deleteRationaleMutation.mutate(r.id)}
                  data-testid={`button-delete-rationale-${r.id}`}
                >
                  <Trash2 className="w-3 h-3 text-destructive" />
                </Button>
              </div>
              {r.body && <p className="text-xs text-muted-foreground">{r.body}</p>}
              {r.attachments && r.attachments.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {r.attachments.map((url, idx) => (
                    <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
                      Attachment {idx + 1}
                    </a>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
              </p>
            </div>
          ))}
        </div>
      )}

      <Sheet open={showRebalance} onOpenChange={setShowRebalance}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{rebalances?.length ? "Rebalance Basket" : "Create Basket Composition"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Stocks ({constituents.length})</p>
                <p className={`text-xs ${Math.abs(totalWeight - 100) <= 0.5 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                  Total Weight: {totalWeight.toFixed(1)}%
                  {Math.abs(totalWeight - 100) > 0.5 && " (must equal 100%)"}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {currentConstituents && currentConstituents.length > 0 && (
                  <Button size="sm" variant="outline" onClick={handleLoadCurrent} data-testid="button-load-current">
                    Load Current
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={addConstituent} data-testid="button-add-stock">
                  <Plus className="w-3 h-3 mr-1" /> Add Stock
                </Button>
                <div>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,.txt,.xlsx,.xls"
                    onChange={handleBuilderCSVUpload}
                    className="hidden"
                    data-testid="input-builder-csv-upload"
                  />
                  <Button size="sm" variant="outline" onClick={() => csvInputRef.current?.click()} data-testid="button-builder-upload-csv">
                    <Upload className="w-3 h-3 mr-1" /> Upload CSV
                  </Button>
                </div>
              </div>
            </div>

            {constituents.map((c, idx) => (
              <div key={idx} className="border rounded-md p-3 space-y-2" data-testid={`constituent-form-${idx}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Stock #{idx + 1}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeConstituent(idx)} data-testid={`button-remove-stock-${idx}`}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <SymbolAutocomplete
                      value={c.symbol}
                      onChange={(val) => updateConstituent(idx, "symbol", val)}
                      testId={`input-constituent-symbol-${idx}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Weight %</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={c.weightPercent}
                      onChange={(e) => updateConstituent(idx, "weightPercent", e.target.value)}
                      placeholder="e.g. 20"
                      data-testid={`input-weight-${idx}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Action</Label>
                    <Select value={c.action} onValueChange={(v) => updateConstituent(idx, "action", v)}>
                      <SelectTrigger data-testid={`select-action-${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Buy">Buy</SelectItem>
                        <SelectItem value="Sell">Sell</SelectItem>
                        <SelectItem value="Hold">Hold</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Quantity (optional)</Label>
                    <Input
                      type="number"
                      value={c.quantity}
                      onChange={(e) => updateConstituent(idx, "quantity", e.target.value)}
                      placeholder="Shares"
                      data-testid={`input-quantity-${idx}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Price at Entry (optional)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={c.priceAtRebalance}
                      onChange={(e) => updateConstituent(idx, "priceAtRebalance", e.target.value)}
                      placeholder="₹"
                      data-testid={`input-price-${idx}`}
                    />
                  </div>
                </div>
              </div>
            ))}

            <div className="space-y-1.5">
              <Label>Rebalance Notes (optional)</Label>
              <Textarea
                value={rebalanceNotes}
                onChange={(e) => setRebalanceNotes(e.target.value)}
                rows={2}
                placeholder="Why are you making this change?"
                data-testid="input-rebalance-notes"
              />
            </div>

            <Button
              className="w-full"
              onClick={handleSubmitRebalance}
              disabled={rebalanceMutation.isPending || constituents.length === 0 || Math.abs(totalWeight - 100) > 0.5}
              data-testid="button-submit-rebalance"
            >
              {rebalanceMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {rebalances?.length ? "Submit Rebalance" : "Create Basket"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={showRationale} onOpenChange={setShowRationale}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Recommendation Rationale</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={rationaleTitle}
                onChange={(e) => setRationaleTitle(e.target.value)}
                placeholder="e.g. Q3 Portfolio Rebalance Report"
                data-testid="input-rationale-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={rationaleCategory} onValueChange={setRationaleCategory}>
                <SelectTrigger data-testid="select-rationale-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="research">Research Report</SelectItem>
                  <SelectItem value="quarterly">Quarterly Review</SelectItem>
                  <SelectItem value="rebalance">Rebalance Rationale</SelectItem>
                  <SelectItem value="market_outlook">Market Outlook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={rationaleBody}
                onChange={(e) => setRationaleBody(e.target.value)}
                rows={4}
                placeholder="Detailed rationale for your basket recommendation..."
                data-testid="input-rationale-body"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => rationaleMutation.mutate({ title: rationaleTitle, body: rationaleBody, category: rationaleCategory })}
              disabled={rationaleMutation.isPending || !rationaleTitle.trim()}
              data-testid="button-submit-rationale"
            >
              {rationaleMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Add Rationale
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
