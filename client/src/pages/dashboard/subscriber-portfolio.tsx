import { useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import DeepAnalysisPanel from "./deep-analysis-panel";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Wallet,
  IndianRupee,
  PieChart as PieChartIcon,
  BarChart3,
  RefreshCw,
  Upload,
  FileText,
  FilePlus,
  Target,
  Lightbulb,
  Send,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Plus,
  Paperclip,
  Eye,
  SortAsc,
  SortDesc,
  AlertTriangle,
  Shield,
  Search,
  Download,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// Types

interface Portfolio {
  id: string;
  name: string;
  userId: string;
  importMethod: string;
  shareWithAdvisors: boolean;
  lastSynced: string | null;
  createdAt: string;
}

interface Holding {
  id: string;
  portfolioId: string;
  assetType: string;
  symbol: string | null;
  isin: string | null;
  name: string;
  quantity: number | null;
  avgBuyPrice: number | null;
  currentPrice: number | null;
  currentValue: number | null;
  investedValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
  sector: string | null;
  assetClass: string | null;
  buyDate: string | null;
  premium: number | null;
  sumAssured: number | null;
  maturityDate: string | null;
  lockInUntil: string | null;
  interestRate: number | null;
  policyNumber: string | null;
  provider: string | null;
  updatedAt: string | null;
}

interface Suggestion {
  id: string;
  portfolioId: string;
  advisorId: string | null;
  type: string;
  assetClass: string | null;
  title: string;
  description: string;
  action: string | null;
  symbol: string | null;
  currentAllocation: number | null;
  suggestedAllocation: number | null;
  priority: string;
  status: string;
  advisorApproved: boolean | null;
  advisorNotes: string | null;
  investorResponse: string | null;
  createdAt: string;
}

interface Goal {
  id: string;
  userId: string;
  name: string;
  goalType: string;
  targetAmount: number;
  currentAmount: number | null;
  targetDate: string | null;
  horizonYears: number | null;
  monthlySip: number | null;
  inflationRate: number | null;
  expectedReturn: number | null;
  priority: string | null;
  status: string | null;
  notes: string | null;
  inflationAdjustedTarget?: number;
  projectedValue?: number;
  probability?: number;
  gap?: number;
  additionalSipNeeded?: number;
}

interface Recommendation {
  id: string;
  advisorId: string;
  investorId: string;
  portfolioId: string | null;
  title: string;
  summary: string | null;
  status: string;
  actions: { action: string; symbol: string; notes: string; done?: boolean }[];
  attachments: { name: string; url: string; type: string }[];
  sentAt: string | null;
  viewedAt: string | null;
  createdAt: string;
}

// Constants

const ASSET_COLORS: Record<string, string> = {
  stock: "#2563eb", mutual_fund: "#7c3aed", etf: "#0891b2", fd: "#d97706",
  ppf: "#059669", nps: "#0d9488", epf: "#16a34a", gold: "#eab308",
  real_estate: "#dc2626", insurance: "#6366f1", bond: "#f59e0b", crypto: "#8b5cf6",
  cash: "#64748b", other: "#94a3b8",
};

const ASSET_LABELS: Record<string, string> = {
  stock: "Stocks", mutual_fund: "Mutual Funds", etf: "ETFs", fd: "Fixed Deposits",
  ppf: "PPF", nps: "NPS", epf: "EPF", gold: "Gold",
  real_estate: "Real Estate", insurance: "Insurance", bond: "Bonds", crypto: "Crypto",
  cash: "Cash", other: "Other",
};

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

const GOAL_TYPE_ICONS: Record<string, string> = {
  retirement: "\u{1F3D6}\u{FE0F}", education: "\u{1F393}", house: "\u{1F3E0}",
  emergency: "\u{1F6E1}\u{FE0F}", wealth: "\u{1F4B0}", vacation: "\u{2708}\u{FE0F}",
  car: "\u{1F697}", wedding: "\u{1F48D}", custom: "\u{1F3AF}",
};

type SortField = "name" | "assetType" | "quantity" | "avgBuyPrice" | "currentPrice" | "currentValue" | "gainLoss" | "gainLossPercent";
type SortDir = "asc" | "desc";

// Helpers

function formatINR(val: number | string | null | undefined): string {
  if (val == null) return "\u2014";
  const n = Number(val);
  if (isNaN(n)) return "\u2014";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function formatPercent(val: number | string | null | undefined): string {
  if (val == null) return "\u2014";
  const n = Number(val);
  if (isNaN(n)) return "\u2014";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function pnlColor(val: number | string | null | undefined): string {
  if (val == null) return "text-slate-500";
  return Number(val) >= 0 ? "text-emerald-600" : "text-red-600";
}

function apiGet(url: string) {
  return fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error(`GET ${url} failed: ${r.status}`);
    return r.json();
  });
}

function apiPost(url: string, body?: any) {
  return fetch(url, {
    method: "POST", credentials: "include",
    headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  }).then((r) => {
    if (!r.ok) throw new Error(`POST ${url} failed: ${r.status}`);
    return r.json();
  });
}

function apiPatch(url: string, body: any) {
  return fetch(url, {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) throw new Error(`PATCH ${url} failed: ${r.status}`);
    return r.json();
  });
}

// Helper: convert snake_case keys to camelCase
function toCamel(obj: any): any {
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const k of Object.keys(obj)) {
      const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      out[ck] = toCamel(obj[k]);
    }
    return out;
  }
  return obj;
}

// Sub-components

function SummaryCard({ label, value, sub, icon, bg, valueColor }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; bg: string; valueColor?: string;
}) {
  return (
    <div className={`${bg} rounded-xl border border-slate-200 p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className={`text-xl font-bold ${valueColor || "text-slate-900"}`}>{value}</div>
      {sub && <div className={`text-xs mt-0.5 ${valueColor || "text-slate-500"}`}>{sub}</div>}
    </div>
  );
}

function CollapsibleSection({ title, count, icon, expanded, onToggle, action, children }: {
  title: string; count: number; icon: React.ReactNode; expanded: boolean; onToggle: () => void; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          {icon} {title}
          <span className="text-xs font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>
        </span>
        <div className="flex items-center gap-3">
          {action && <div onClick={(e: React.MouseEvent) => e.stopPropagation()}>{action}</div>}
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>
      {expanded && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// Main Component

export default function SubscriberPortfolioPage() {
  const [, navigate] = useLocation();
  // Extract userId from URL path
  const pathParts = window.location.pathname.split("/");
  const subIdx = pathParts.indexOf("subscriber");
  const userId = subIdx !== -1 ? pathParts[subIdx + 1] ?? "" : "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activePortfolioId, setActivePortfolioId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("currentValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [holdingSearch, setHoldingSearch] = useState("");
  const [expandedSections, setExpandedSections] = useState({
    holdings: true, suggestions: true, goals: true, recommendations: true,
  });
  const [showAddGoalForm, setShowAddGoalForm] = useState(false);
  const [showRecoForm, setShowRecoForm] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // Data Fetching

  const { data: portfolios = [], isLoading: loadingPortfolios } = useQuery<Portfolio[]>({
    queryKey: ["advisor-subscriber-portfolios", userId],
    queryFn: () => apiGet(`/api/advisor/subscriber/${userId}/portfolio`).then((d: any) => toCamel(d.portfolios || [])),
    enabled: !!userId,
  });

  const selectedPortfolio = useMemo(() => {
    if (!portfolios.length) return null;
    if (activePortfolioId) return portfolios.find((p) => p.id === activePortfolioId) ?? portfolios[0];
    return portfolios[0];
  }, [portfolios, activePortfolioId]);

  const portfolioId = selectedPortfolio?.id;

  // Holdings come embedded in portfolio response
  const holdings: Holding[] = toCamel((selectedPortfolio as any)?.holdings || []);
  const loadingHoldings = loadingPortfolios;


  const { data: suggestions = [] } = useQuery<Suggestion[]>({
    queryKey: ["portfolio-suggestions", portfolioId],
    queryFn: () => apiGet(`/api/portfolio/${portfolioId}/suggestions`),
    enabled: !!portfolioId,
  });


  const { data: goals = [] } = useQuery<Goal[]>({
    queryKey: ["subscriber-goals", userId],
    queryFn: () => apiGet(`/api/advisor/subscriber/${userId}/goals`),
    enabled: !!userId,
  });

  const { data: recommendations = [] } = useQuery<Recommendation[]>({
    queryKey: ["advisor-recommendations"],
    queryFn: () => apiGet(`/api/advisor/recommendations`),
    select: (data: Recommendation[]) => data.filter((r) => r.investorId === userId),
  });

  // Mutations

  const syncPricesMut = useMutation({
    mutationFn: () => apiPost(`/api/advisor/portfolio/${portfolioId}/sync-prices`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["advisor-subscriber-portfolios", userId] });
      toast({ title: "Prices synced", description: "Live prices updated from Groww & AMFI." });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const generateSuggestionsMut = useMutation({
    mutationFn: () => apiPost(`/api/portfolio/${portfolioId}/generate-suggestions`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-suggestions", portfolioId] });
      toast({ title: "Analysis complete", description: "Suggestions generated from 10-rule engine." });
    },
    onError: (e: Error) => toast({ title: "Analysis failed", description: e.message, variant: "destructive" }),
  });

  const approveSuggestionMut = useMutation({
    mutationFn: ({ id, approved, notes }: { id: string; approved: boolean; notes?: string }) =>
      apiPatch(`/api/suggestion/${id}`, { advisorApproved: approved, advisorNotes: notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-suggestions", portfolioId] });
      toast({ title: "Suggestion updated" });
    },
  });

  const importCsvMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData(); fd.append("file", file);
      return apiPost(`/api/advisor/portfolio/${portfolioId}/import-csv`, fd);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["advisor-subscriber-portfolios", userId] });
      toast({ title: "CSV imported", description: `${data.imported ?? ""} holdings added.` });
    },
    onError: (e: Error) => toast({ title: "CSV import failed", description: e.message, variant: "destructive" }),
  });

  const importPdfMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData(); fd.append("file", file);
      return apiPost(`/api/advisor/portfolio/${portfolioId}/import-pdf`, fd);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["advisor-subscriber-portfolios", userId] });
      toast({ title: "PDF imported", description: `${data.imported ?? ""} holdings parsed.` });
    },
    onError: (e: Error) => toast({ title: "PDF import failed", description: e.message, variant: "destructive" }),
  });

  const createPortfolioMut = useMutation({
    mutationFn: () => apiPost(`/api/advisor/subscriber/${userId}/portfolio`, { name: "New Portfolio" }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["advisor-subscriber-portfolios", userId] });
      setActivePortfolioId(data.id);
      toast({ title: "Portfolio created" });
    },
  });

  // Goal form
  const [goalForm, setGoalForm] = useState({
    name: "", goalType: "wealth", targetAmount: "", currentAmount: "",
    horizonYears: "", monthlySip: "", expectedReturn: "12", inflationRate: "6", priority: "medium",
  });

  const createGoalMut = useMutation({
    mutationFn: () => apiPost(`/api/advisor/subscriber/${userId}/goal`, {
      ...goalForm,
      targetAmount: Number(goalForm.targetAmount),
      currentAmount: Number(goalForm.currentAmount) || 0,
      horizonYears: Number(goalForm.horizonYears) || null,
      monthlySip: Number(goalForm.monthlySip) || null,
      expectedReturn: Number(goalForm.expectedReturn),
      inflationRate: Number(goalForm.inflationRate),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscriber-goals", userId] });
      setShowAddGoalForm(false);
      setGoalForm({ name: "", goalType: "wealth", targetAmount: "", currentAmount: "", horizonYears: "", monthlySip: "", expectedReturn: "12", inflationRate: "6", priority: "medium" });
      toast({ title: "Goal created" });
    },
  });

  // Recommendation form
  const [recoForm, setRecoForm] = useState({ title: "", summary: "", actions: [{ action: "Buy", symbol: "", notes: "" }] });
  const [recoAttachments, setRecoAttachments] = useState<{ name: string; url: string; type: string }[]>([]);

  const uploadAttachmentMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData(); fd.append("file", file);
      return apiPost(`/api/advisor/recommendation/upload`, fd);
    },
    onSuccess: (data: any) => {
      setRecoAttachments((prev) => [...prev, { name: data.name, url: data.url, type: data.type }]);
      toast({ title: "File attached" });
    },
  });

  const sendRecoMut = useMutation({
    mutationFn: () => apiPost(`/api/advisor/recommendation`, {
      investorId: userId, portfolioId, title: recoForm.title, summary: recoForm.summary,
      actions: recoForm.actions.filter((a) => a.symbol), attachments: recoAttachments, status: "sent",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["advisor-recommendations"] });
      setShowRecoForm(false);
      setRecoForm({ title: "", summary: "", actions: [{ action: "Buy", symbol: "", notes: "" }] });
      setRecoAttachments([]);
      toast({ title: "Recommendation sent" });
    },
  });

  // Deep Analysis
  const [deepAnalysis, setDeepAnalysis] = useState<any>(null);
  const deepAnalysisMut = useMutation({
    mutationFn: () => apiPost("/api/portfolio/" + portfolioId + "/deep-analysis"),
    onSuccess: (data: any) => {
      setDeepAnalysis(data);
      toast({ title: "Deep Analysis Complete", description: "Health score: " + (data.combined?.healthScore || "N/A") + "/100" });
    },
    onError: (e: Error) => toast({ title: "Analysis failed", description: e.message, variant: "destructive" }),
  });
  const runDeepAnalysis = () => deepAnalysisMut.mutate();

  const [downloadingReport, setDownloadingReport] = useState(false);
  const downloadReport = async () => {
    setDownloadingReport(true);
    try {
      const res = await fetch("/api/portfolio/" + portfolioId + "/report", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ investorName: "", generatedBy: "" }),
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "Portfolio_Report_" + new Date().toISOString().slice(0, 10) + ".pdf";
      a.click(); URL.revokeObjectURL(url);
      toast({ title: "Report Downloaded" });
    } catch (e: any) { toast({ title: "Download failed", description: e.message, variant: "destructive" }); }
    setDownloadingReport(false);
  };

  // Manual holding form
  const [holdingForm, setHoldingForm] = useState({
    assetType: "stock", name: "", symbol: "", quantity: "", avgBuyPrice: "", sector: "",
  });

  const addHoldingMut = useMutation({
    mutationFn: () => apiPost(`/api/advisor/portfolio/${portfolioId}/holding`, {
      ...holdingForm,
      quantity: Number(holdingForm.quantity) || null,
      avgBuyPrice: Number(holdingForm.avgBuyPrice) || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["advisor-subscriber-portfolios", userId] });
      setShowManualAdd(false);
      setHoldingForm({ assetType: "stock", name: "", symbol: "", quantity: "", avgBuyPrice: "", sector: "" });
      toast({ title: "Holding added" });
    },
  });

  // Computed

  const totals = useMemo(() => {
    let invested = 0, current = 0;
    for (const h of holdings) {
      invested += Number(h.investedValue) || 0;
      current += Number(h.currentValue) || Number(h.investedValue) || 0;
    }
    const pnl = current - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    return { invested, current, pnl, pnlPct, count: holdings.length };
  }, [holdings]);

  const allocationData = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holdings) {
      const type = h.assetType || "other";
      map.set(type, (map.get(type) ?? 0) + (h.currentValue ?? h.investedValue ?? 0));
    }
    return Array.from(map.entries())
      .map(([type, value]) => ({ name: ASSET_LABELS[type] || type, value, color: ASSET_COLORS[type] || "#94a3b8" }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  const sectorData = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holdings) {
      if (h.sector) map.set(h.sector, (map.get(h.sector) ?? 0) + (h.currentValue ?? h.investedValue ?? 0));
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  }, [holdings]);

  const sortedHoldings = useMemo(() => {
    let filtered = holdings;
    if (holdingSearch) {
      const q = holdingSearch.toLowerCase();
      filtered = holdings.filter((h) =>
        h.name.toLowerCase().includes(q) || (h.symbol && h.symbol.toLowerCase().includes(q)) ||
        (h.sector && h.sector.toLowerCase().includes(q)) || h.assetType.toLowerCase().includes(q)
      );
    }
    return [...filtered].sort((a, b) => {
      let av: any = a[sortField] ?? 0;
      let bv: any = b[sortField] ?? 0;
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [holdings, sortField, sortDir, holdingSearch]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const toggleSection = (key: keyof typeof expandedSections) =>
    setExpandedSections((s) => ({ ...s, [key]: !s[key] }));

  // Render



  if (loadingPortfolios) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
        <span className="ml-3 text-slate-500">Loading portfolio...</span>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsvMut.mutate(e.target.files[0])} />
      <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => e.target.files?.[0] && importPdfMut.mutate(e.target.files[0])} />
      <input ref={attachmentInputRef} type="file" accept=".pdf,.xlsx,.xls,.doc,.docx,.png,.jpg" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAttachmentMut.mutate(e.target.files[0])} />

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/dashboard")} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Client Portfolio</h1>
              <p className="text-sm text-slate-500">{portfolios.length} portfolio{portfolios.length !== 1 ? "s" : ""} &middot; {totals.count} holdings</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {portfolios.length > 1 && (
              <select value={portfolioId ?? ""} onChange={(e) => setActivePortfolioId(e.target.value)}
                className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                {portfolios.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            )}
            <button onClick={() => createPortfolioMut.mutate()} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors">
              <Plus className="w-4 h-4" /> New Portfolio
            </button>
            <button onClick={() => csvInputRef.current?.click()} disabled={!portfolioId} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50">
              <Upload className="w-4 h-4" /> CSV
            </button>
            <button onClick={() => pdfInputRef.current?.click()} disabled={!portfolioId} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50">
              <FileText className="w-4 h-4" /> CAS PDF
            </button>
            <button onClick={() => setShowManualAdd(true)} disabled={!portfolioId} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50">
              <FilePlus className="w-4 h-4" /> Manual
            </button>
            <button onClick={() => syncPricesMut.mutate()} disabled={!portfolioId || syncPricesMut.isPending}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${syncPricesMut.isPending ? "animate-spin" : ""}`} /> Sync Prices
            </button>
            <button onClick={() => generateSuggestionsMut.mutate()} disabled={!portfolioId || generateSuggestionsMut.isPending}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
              <Lightbulb className={`w-4 h-4 ${generateSuggestionsMut.isPending ? "animate-spin" : ""}`} /> Analyze
            </button>
            <button onClick={() => setShowRecoForm(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors">
              <Send className="w-4 h-4" /> Recommend
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Invested Value" value={formatINR(totals.invested)} icon={<Wallet className="w-5 h-5 text-blue-600" />} bg="bg-blue-50" />
        <SummaryCard label="Current Value" value={formatINR(totals.current)} icon={<IndianRupee className="w-5 h-5 text-emerald-600" />} bg="bg-emerald-50" />
        <SummaryCard label="Total P&L" value={formatINR(totals.pnl)} sub={formatPercent(totals.pnlPct)}
          icon={totals.pnl >= 0 ? <TrendingUp className="w-5 h-5 text-emerald-600" /> : <TrendingDown className="w-5 h-5 text-red-600" />}
          bg={totals.pnl >= 0 ? "bg-emerald-50" : "bg-red-50"} valueColor={pnlColor(totals.pnl)} />
        <SummaryCard label="Holdings" value={String(totals.count)} sub={`${allocationData.length} asset classes`}
          icon={<PieChartIcon className="w-5 h-5 text-violet-600" />} bg="bg-violet-50" />
      </div>

      {/* Charts */}
      {holdings.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-blue-600" /> Asset Allocation
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={allocationData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  outerRadius={100} innerRadius={55} paddingAngle={2}
                  label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {allocationData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
                </Pie>
                <Tooltip formatter={(value: number) => formatINR(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600" /> Sector Exposure
            </h3>
            {sectorData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={sectorData} layout="vertical" margin={{ left: 80, right: 20 }}>
                  <XAxis type="number" tickFormatter={(v: number) => `\u20B9${(v / 1000).toFixed(0)}K`} />
                  <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => formatINR(value)} />
                  <Bar dataKey="value" fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-slate-400 text-sm">No sector data available. Add sectors to holdings.</div>
            )}
          </div>
        </div>
      )}

      {/* Holdings Table */}
      <div className="mb-6">
        <CollapsibleSection title="Holdings" count={holdings.length} icon={<Wallet className="w-4 h-4" />}
          expanded={expandedSections.holdings} onToggle={() => toggleSection("holdings")}>
          <div className="mb-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" value={holdingSearch} onChange={(e) => setHoldingSearch(e.target.value)}
              placeholder="Search by name, symbol, sector, or type..."
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          {loadingHoldings ? (
            <div className="text-center py-8 text-slate-400"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading holdings...</div>
          ) : sortedHoldings.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Wallet className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No holdings yet. Import a CSV, CAS PDF, or add manually.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    {([["name","Name"],["assetType","Type"],["quantity","Qty"],["avgBuyPrice","Buy Price"],["currentPrice","CMP"],["currentValue","Value"],["gainLoss","P&L"],["gainLossPercent","P&L %"]] as [SortField,string][]).map(([field,label]) => (
                      <th key={field} onClick={() => toggleSort(field)}
                        className="py-3 px-3 text-left font-medium text-slate-600 cursor-pointer hover:text-slate-900 select-none whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">{label}
                          {sortField === field && (sortDir === "asc" ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedHoldings.map((h) => (
                    <tr key={h.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900 max-w-[200px] truncate" title={h.name}>{h.name}</div>
                        {h.symbol && <div className="text-xs text-slate-400">{h.symbol}</div>}
                      </td>
                      <td className="py-3 px-3">
                        <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: (ASSET_COLORS[h.assetType] || "#94a3b8") + "18", color: ASSET_COLORS[h.assetType] || "#64748b" }}>
                          {ASSET_LABELS[h.assetType] || h.assetType}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-700 tabular-nums">{h.quantity ?? "\u2014"}</td>
                      <td className="py-3 px-3 text-slate-700 tabular-nums">{h.avgBuyPrice != null ? `\u20B9${Number(h.avgBuyPrice).toLocaleString("en-IN")}` : "\u2014"}</td>
                      <td className="py-3 px-3 text-slate-700 tabular-nums">{h.currentPrice != null ? `\u20B9${Number(h.currentPrice).toLocaleString("en-IN")}` : "\u2014"}</td>
                      <td className="py-3 px-3 font-medium text-slate-900 tabular-nums">{formatINR(h.currentValue ?? h.investedValue)}</td>
                      <td className={`py-3 px-3 font-medium tabular-nums ${pnlColor(h.gainLoss)}`}>{formatINR(h.gainLoss)}</td>
                      <td className={`py-3 px-3 font-medium tabular-nums ${pnlColor(h.gainLossPercent)}`}>{formatPercent(h.gainLossPercent)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="py-3 px-3 text-slate-900" colSpan={5}>Total</td>
                    <td className="py-3 px-3 text-slate-900 tabular-nums">{formatINR(totals.current)}</td>
                    <td className={`py-3 px-3 tabular-nums ${pnlColor(totals.pnl)}`}>{formatINR(totals.pnl)}</td>
                    <td className={`py-3 px-3 tabular-nums ${pnlColor(totals.pnlPct)}`}>{formatPercent(totals.pnlPct)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* Suggestions */}
      <div className="mb-6">
        <CollapsibleSection title="Suggestions" count={suggestions.length} icon={<Lightbulb className="w-4 h-4" />}
          expanded={expandedSections.suggestions} onToggle={() => toggleSection("suggestions")}>
          {suggestions.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-40" />Click "Analyze" to run the 10-rule suggestion engine.
            </div>
          ) : (
            <div className="space-y-3">
              {suggestions.map((s) => (
                <div key={s.id} className={`rounded-lg border p-4 ${s.advisorApproved === true ? "bg-emerald-50 border-emerald-200" : s.advisorApproved === false ? "bg-red-50 border-red-200 opacity-60" : "bg-white border-slate-200"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${PRIORITY_STYLES[s.priority] || PRIORITY_STYLES.medium}`}>{s.priority}</span>
                        <span className="text-xs text-slate-400 capitalize">{s.type.replace(/_/g, " ")}</span>
                      </div>
                      <h4 className="font-medium text-slate-900 text-sm">{s.title}</h4>
                      <p className="text-sm text-slate-600 mt-1">{s.description}</p>
                      {s.advisorNotes && <p className="text-xs text-slate-500 mt-1 italic">Note: {s.advisorNotes}</p>}
                      {s.investorResponse && (
                        <p className="text-xs mt-1">Investor: <span className={s.investorResponse === "accepted" ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>{s.investorResponse}</span></p>
                      )}
                    </div>
                    {s.advisorApproved == null && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => approveSuggestionMut.mutate({ id: s.id, approved: true })}
                          className="p-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition-colors" title="Approve">
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => approveSuggestionMut.mutate({ id: s.id, approved: false })}
                          className="p-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 transition-colors" title="Reject">
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    {s.advisorApproved === true && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
                    {s.advisorApproved === false && <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* Goals */}
      <div className="mb-6">
        <CollapsibleSection title="Financial Goals" count={goals.length} icon={<Target className="w-4 h-4" />}
          expanded={expandedSections.goals} onToggle={() => toggleSection("goals")}
          action={<button onClick={() => setShowAddGoalForm(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add Goal</button>}>
          {showAddGoalForm && (
            <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 mb-3">Set New Goal for Client</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input placeholder="Goal name" value={goalForm.name} onChange={(e) => setGoalForm((f) => ({ ...f, name: e.target.value }))} className="col-span-2 text-sm border border-blue-200 rounded-lg px-3 py-2 bg-white" />
                <select value={goalForm.goalType} onChange={(e) => setGoalForm((f) => ({ ...f, goalType: e.target.value }))} className="text-sm border border-blue-200 rounded-lg px-3 py-2 bg-white">
                  {Object.entries(GOAL_TYPE_ICONS).map(([k, v]) => <option key={k} value={k}>{v} {k}</option>)}
                </select>
                <select value={goalForm.priority} onChange={(e) => setGoalForm((f) => ({ ...f, priority: e.target.value }))} className="text-sm border border-blue-200 rounded-lg px-3 py-2 bg-white">
                  <option value="high">High priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="low">Low priority</option>
                </select>
                <input placeholder="Target amount" type="number" value={goalForm.targetAmount} onChange={(e) => setGoalForm((f) => ({ ...f, targetAmount: e.target.value }))} className="text-sm border border-blue-200 rounded-lg px-3 py-2 bg-white" />
                <input placeholder="Current amount" type="number" value={goalForm.currentAmount} onChange={(e) => setGoalForm((f) => ({ ...f, currentAmount: e.target.value }))} className="text-sm border border-blue-200 rounded-lg px-3 py-2 bg-white" />
                <input placeholder="Years" type="number" value={goalForm.horizonYears} onChange={(e) => setGoalForm((f) => ({ ...f, horizonYears: e.target.value }))} className="text-sm border border-blue-200 rounded-lg px-3 py-2 bg-white" />
                <input placeholder="Monthly SIP" type="number" value={goalForm.monthlySip} onChange={(e) => setGoalForm((f) => ({ ...f, monthlySip: e.target.value }))} className="text-sm border border-blue-200 rounded-lg px-3 py-2 bg-white" />
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => createGoalMut.mutate()} disabled={!goalForm.name || !goalForm.targetAmount} className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">Create Goal</button>
                <button onClick={() => setShowAddGoalForm(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50">Cancel</button>
              </div>
            </div>
          )}
          {goals.length === 0 && !showAddGoalForm ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              <Target className="w-8 h-8 mx-auto mb-2 opacity-40" />No goals set yet. Click "Add Goal" to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {goals.map((g) => {
                const prob = g.probability ?? 0;
                const probColor = prob >= 75 ? "text-emerald-600" : prob >= 40 ? "text-amber-600" : "text-red-600";
                const barColor = prob >= 75 ? "bg-emerald-500" : prob >= 40 ? "bg-amber-500" : "bg-red-500";
                return (
                  <div key={g.id} className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{GOAL_TYPE_ICONS[g.goalType] || "\u{1F3AF}"}</span>
                        <h4 className="font-medium text-slate-900 text-sm">{g.name}</h4>
                      </div>
                      {g.priority && <span className={`text-xs px-2 py-0.5 rounded-full border ${PRIORITY_STYLES[g.priority] || ""}`}>{g.priority}</span>}
                    </div>
                    <div className="text-xs text-slate-500 mb-2">
                      Target: {formatINR(g.targetAmount)} {g.horizonYears ? `\u00B7 ${g.horizonYears}yr` : ""} {g.monthlySip ? `\u00B7 SIP ${formatINR(g.monthlySip)}/mo` : ""}
                    </div>
                    {g.probability != null && (
                      <>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-500">Goal probability</span>
                          <span className={`font-semibold ${probColor}`}>{prob.toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, prob)}%` }} />
                        </div>
                      </>
                    )}
                    {g.gap != null && g.gap > 0 && (
                      <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Gap: {formatINR(g.gap)}
                        {g.additionalSipNeeded ? ` \u2014 needs \u20B9${Math.round(g.additionalSipNeeded).toLocaleString("en-IN")}/mo extra` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* Recommendations */}
      <div className="mb-6">
        <CollapsibleSection title="Recommendations" count={recommendations.length} icon={<Send className="w-4 h-4" />}
          expanded={expandedSections.recommendations} onToggle={() => toggleSection("recommendations")}>
          {showRecoForm && (
            <div className="mb-4 bg-violet-50 border border-violet-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-violet-900 mb-3">New Recommendation</h4>
              <div className="space-y-3">
                <input placeholder="Title (e.g. March Rebalancing)" value={recoForm.title} onChange={(e) => setRecoForm((f) => ({ ...f, title: e.target.value }))} className="w-full text-sm border border-violet-200 rounded-lg px-3 py-2 bg-white" />
                <textarea placeholder="Summary / rationale" value={recoForm.summary} onChange={(e) => setRecoForm((f) => ({ ...f, summary: e.target.value }))} rows={2} className="w-full text-sm border border-violet-200 rounded-lg px-3 py-2 bg-white resize-none" />
                <div>
                  <label className="text-xs font-medium text-violet-700 mb-1 block">Action Items</label>
                  {recoForm.actions.map((a, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <select value={a.action} onChange={(e) => { const actions = [...recoForm.actions]; actions[i] = { ...a, action: e.target.value }; setRecoForm((f) => ({ ...f, actions })); }}
                        className="text-sm border border-violet-200 rounded-lg px-2 py-1.5 bg-white w-24">
                        {["Buy","Sell","Hold","Switch","SIP"].map((v) => <option key={v}>{v}</option>)}
                      </select>
                      <input placeholder="Symbol" value={a.symbol} onChange={(e) => { const actions = [...recoForm.actions]; actions[i] = { ...a, symbol: e.target.value }; setRecoForm((f) => ({ ...f, actions })); }}
                        className="text-sm border border-violet-200 rounded-lg px-2 py-1.5 bg-white flex-1" />
                      <input placeholder="Notes" value={a.notes} onChange={(e) => { const actions = [...recoForm.actions]; actions[i] = { ...a, notes: e.target.value }; setRecoForm((f) => ({ ...f, actions })); }}
                        className="text-sm border border-violet-200 rounded-lg px-2 py-1.5 bg-white flex-[2]" />
                    </div>
                  ))}
                  <button onClick={() => setRecoForm((f) => ({ ...f, actions: [...f.actions, { action: "Buy", symbol: "", notes: "" }] }))} className="text-xs text-violet-600 hover:text-violet-700">+ Add action</button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => attachmentInputRef.current?.click()} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 border border-violet-200 rounded-lg px-2 py-1">
                    <Paperclip className="w-3 h-3" /> Attach file
                  </button>
                  {recoAttachments.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-700 px-2 py-1 rounded-md">
                      <FileText className="w-3 h-3" /> {a.name}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => sendRecoMut.mutate()} disabled={!recoForm.title} className="text-sm px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">Send Recommendation</button>
                  <button onClick={() => { setShowRecoForm(false); setRecoAttachments([]); }} className="text-sm px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50">Cancel</button>
                </div>
              </div>
            </div>
          )}
          {recommendations.length === 0 && !showRecoForm ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              <Send className="w-8 h-8 mx-auto mb-2 opacity-40" />No recommendations sent yet.
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.map((r) => (
                <div key={r.id} className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-medium text-slate-900 text-sm">{r.title}</h4>
                    <div className="flex items-center gap-2">
                      {r.viewedAt && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Eye className="w-3 h-3" /> Viewed</span>}
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "sent" ? "bg-blue-100 text-blue-700" : r.status === "draft" ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>{r.status}</span>
                    </div>
                  </div>
                  {r.summary && <p className="text-sm text-slate-600 mb-2">{r.summary}</p>}
                  {r.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {r.actions.map((a, i) => (
                        <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border ${a.done ? "bg-emerald-50 border-emerald-200 line-through opacity-60" : "bg-slate-50 border-slate-200"}`}>
                          <span className="font-medium">{a.action}</span> {a.symbol}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.attachments.map((a, i) => (
                        <a key={i} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 border border-blue-200 rounded-md px-2 py-0.5">
                          <Download className="w-3 h-3" /> {a.name}
                        </a>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-slate-400 mt-2">{r.sentAt ? new Date(r.sentAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Draft"}</p>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* Deep Analysis */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600" /> Deep Analysis (AlphaLens Engine)
          </h3>
          <div className="flex gap-2">
            <button onClick={() => runDeepAnalysis()} disabled={!portfolioId || deepAnalysisMut.isPending}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50">
              <Shield className={`w-4 h-4 ${deepAnalysisMut.isPending ? "animate-spin" : ""}`} />
              {deepAnalysisMut.isPending ? "Analyzing..." : "Run Deep Analysis"}
            </button>
            <a href="https://stocks.alphamarket.co.in" target="_blank" rel="noreferrer"
              className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-3 py-2">Stock Analyzer</a>
            <a href="https://mf.alphamarket.co.in" target="_blank" rel="noreferrer"
              className="text-xs text-violet-600 hover:text-violet-700 border border-violet-200 rounded-lg px-3 py-2">MF Analyzer</a>
            <button onClick={() => downloadReport()} disabled={!deepAnalysis || downloadingReport} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-900 transition-colors disabled:opacity-50"><Download className="w-4 h-4" />{downloadingReport ? "Generating..." : "Download PDF"}</button>
          </div>
        </div>
        <DeepAnalysisPanel data={deepAnalysis} onUpdate={(d: any) => setDeepAnalysis(d)} />
      </div>

      {/* Manual Add Holding Modal */}
      {showManualAdd && (
        <ModalOverlay onClose={() => setShowManualAdd(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Add Holding Manually</h3>
            <div className="space-y-3">
              <select value={holdingForm.assetType} onChange={(e) => setHoldingForm((f) => ({ ...f, assetType: e.target.value }))} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2">
                {Object.entries(ASSET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input placeholder="Name *" value={holdingForm.name} onChange={(e) => setHoldingForm((f) => ({ ...f, name: e.target.value }))} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
              <input placeholder="Symbol (e.g. RELIANCE)" value={holdingForm.symbol} onChange={(e) => setHoldingForm((f) => ({ ...f, symbol: e.target.value }))} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Quantity" type="number" value={holdingForm.quantity} onChange={(e) => setHoldingForm((f) => ({ ...f, quantity: e.target.value }))} className="text-sm border border-slate-200 rounded-lg px-3 py-2" />
                <input placeholder="Avg Buy Price" type="number" value={holdingForm.avgBuyPrice} onChange={(e) => setHoldingForm((f) => ({ ...f, avgBuyPrice: e.target.value }))} className="text-sm border border-slate-200 rounded-lg px-3 py-2" />
              </div>
              <input placeholder="Sector (optional)" value={holdingForm.sector} onChange={(e) => setHoldingForm((f) => ({ ...f, sector: e.target.value }))} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => addHoldingMut.mutate()} disabled={!holdingForm.name} className="flex-1 text-sm px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">Add Holding</button>
              <button onClick={() => setShowManualAdd(false)} className="text-sm px-4 py-2.5 rounded-lg border border-slate-300 hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
