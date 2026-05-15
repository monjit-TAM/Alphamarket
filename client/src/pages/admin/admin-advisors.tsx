import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle, XCircle, Pencil, Trash2, Search, Shield, FileText,
  Landmark, IndianRupee, Clock, CircleDollarSign, ArrowUpRight, ArrowDownRight,
  BarChart3, Users, Briefcase, TrendingUp, PieChart, Activity,
} from "lucide-react";
import type { User } from "@shared/schema";

type SafeUser = Omit<User, "password">;

interface BankDetails {
  id?: number;
  advisor_id: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  account_holder_name: string;
  upi_id: string;
  account_type: string;
  micr_code: string;
  branch_address: string;
  username?: string;
  company_name?: string;
  email?: string;
}

interface PaymentEntry {
  id: number;
  advisor_id: string;
  amount: number;
  type: "credit" | "debit";
  status: "pending" | "completed" | "rejected";
  notes: string;
  requested_at: string;
  processed_at: string | null;
  processed_by: string | null;
}

interface PaymentData {
  payments: PaymentEntry[];
  summary: {
    totalRevenue: number;
    totalPaid: number;
    pendingAmount: number;
    claimable: number;
  };
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminAdvisors() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [editUser, setEditUser] = useState<SafeUser | null>(null);
  const [bankPayUser, setBankPayUser] = useState<SafeUser | null>(null);
  const [editForm, setEditForm] = useState({
    companyName: "",
    email: "",
    phone: "",
    sebiRegNumber: "",
    overview: "",
    role: "" as string,
  });

  const { data: users, isLoading } = useQuery<SafeUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, isApproved }: { id: string; isApproved: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}`, { isApproved });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
      setEditUser(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openEdit = (user: SafeUser) => {
    setEditUser(user);
    setEditForm({
      companyName: user.companyName || "",
      email: user.email || "",
      phone: user.phone || "",
      sebiRegNumber: user.sebiRegNumber || "",
      overview: user.overview || "",
      role: user.role,
    });
  };

  const filtered = (users || []).filter((u) => {
    if (search && !u.username.toLowerCase().includes(search.toLowerCase()) && !(u.companyName || "").toLowerCase().includes(search.toLowerCase()) && !u.email.toLowerCase().includes(search.toLowerCase())) return false;
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "newest") return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    if (sortBy === "oldest") return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    if (sortBy === "alpha") return (a.companyName || a.username || "").localeCompare(b.companyName || b.username || "");
    if (sortBy === "alpha-desc") return (b.companyName || b.username || "").localeCompare(a.companyName || a.username || "");
    return 0;
  });
  const advisors = sorted.filter((u) => u.role === "advisor");
  const investors = sorted.filter((u) => u.role === "investor");
  const admins = sorted.filter((u) => u.role === "admin");

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <h1 className="text-xl font-bold" data-testid="admin-heading-users">User Management</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-56"
              data-testid="admin-input-search-users"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-32" data-testid="admin-filter-role">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="advisor">Advisors</SelectItem>
              <SelectItem value="investor">Investors</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-36" data-testid="admin-sort-users">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="alpha">A → Z</SelectItem>
              <SelectItem value="alpha-desc">Z → A</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <>
          {(roleFilter === "all" || roleFilter === "advisor") && advisors.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  Advisors ({advisors.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {advisors.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onApprove={(approved) => approveMutation.mutate({ id: user.id, isApproved: approved })}
                    onEdit={() => openEdit(user)}
                    onDelete={() => deleteMutation.mutate(user.id)}
                    onBankPay={() => setBankPayUser(user)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {(roleFilter === "all" || roleFilter === "investor") && investors.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Investors ({investors.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {investors.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onEdit={() => openEdit(user)}
                    onDelete={() => deleteMutation.mutate(user.id)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {(roleFilter === "all" || roleFilter === "admin") && admins.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Admins ({admins.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {admins.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onEdit={() => openEdit(user)}
                    onDelete={() => deleteMutation.mutate(user.id)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {filtered.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No users found
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) setEditUser(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User: {editUser?.username}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editUser) {
                updateMutation.mutate({ id: editUser.id, data: editForm });
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label>Company Name</Label>
              <Input
                value={editForm.companyName}
                onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                data-testid="admin-edit-company"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                data-testid="admin-edit-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                data-testid="admin-edit-phone"
              />
            </div>
            <div className="space-y-1.5">
              <Label>SEBI Registration Number</Label>
              <Input
                value={editForm.sebiRegNumber}
                onChange={(e) => setEditForm({ ...editForm, sebiRegNumber: e.target.value })}
                data-testid="admin-edit-sebi"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Overview</Label>
              <Textarea
                value={editForm.overview}
                onChange={(e) => setEditForm({ ...editForm, overview: e.target.value })}
                rows={3}
                data-testid="admin-edit-overview"
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="admin-button-save-user">
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bank & Payments Dialog */}
      {bankPayUser && (
        <BankPayDialog user={bankPayUser} onClose={() => setBankPayUser(null)} />
      )}
    </div>
  );
}

/* ─── Bank & Payments Dialog ─── */
function BankPayDialog({ user, onClose }: { user: SafeUser; onClose: () => void }) {
  const { toast } = useToast();
  const [revenueAmount, setRevenueAmount] = useState("");
  const [revenueNotes, setRevenueNotes] = useState("");
  const [activeTab, setActiveTab] = useState("bank");

  const { data: bankDetails, isLoading: bankLoading } = useQuery<BankDetails | null>({
    queryKey: [`/api/admin/advisor/${user.id}/bank-details`],
  });

  const { data: paymentData, isLoading: payLoading } = useQuery<PaymentData>({
    queryKey: [`/api/admin/advisor/${user.id}/payments`],
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery<any>({
    queryKey: [`/api/admin/advisor/${user.id}/analytics`],
    enabled: activeTab === "analytics",
  });

  const addRevenueMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/advisor/${user.id}/add-revenue`, {
        amount: Number(revenueAmount),
        notes: revenueNotes || "Revenue credit",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/advisor/${user.id}/payments`] });
      toast({ title: "Revenue added successfully" });
      setRevenueAmount("");
      setRevenueNotes("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const processPaymentMutation = useMutation({
    mutationFn: async ({ paymentId, status, notes }: { paymentId: number; status: string; notes?: string }) => {
      const res = await apiRequest("PUT", `/api/admin/advisor/${user.id}/process-payment/${paymentId}`, { status, notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/advisor/${user.id}/payments`] });
      toast({ title: "Payment processed" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const summary = paymentData?.summary;
  const payments = paymentData?.payments || [];
  const pendingPayments = payments.filter((p) => p.type === "debit" && p.status === "pending");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="w-5 h-5" />
            Bank & Payments — {user.companyName || user.username}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="bank">Bank Details</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="history">
              History
              {pendingPayments.length > 0 && (
                <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0">{pendingPayments.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          {/* Bank Details Tab */}
          <TabsContent value="bank" className="mt-4">
            {bankLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : !bankDetails ? (
              <div className="text-center py-8 text-muted-foreground">
                <Landmark className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>No bank details submitted yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <BankField label="Bank Name" value={bankDetails.bank_name} />
                <BankField label="Account Holder" value={bankDetails.account_holder_name} />
                <BankField label="Account Number" value={bankDetails.account_number} />
                <BankField label="Account Type" value={bankDetails.account_type} />
                <BankField label="IFSC Code" value={bankDetails.ifsc_code} />
                <BankField label="MICR Code" value={bankDetails.micr_code} />
                <BankField label="UPI ID" value={bankDetails.upi_id} />
                <BankField label="Branch" value={bankDetails.branch_address} className="sm:col-span-2" />
              </div>
            )}
          </TabsContent>

          {/* Revenue Tab */}
          <TabsContent value="revenue" className="mt-4 space-y-4">
            {payLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SummaryCard icon={<CircleDollarSign className="w-4 h-4 text-blue-500" />} label="Total Revenue" value={formatCurrency(summary?.totalRevenue || 0)} />
                  <SummaryCard icon={<ArrowUpRight className="w-4 h-4 text-green-500" />} label="Paid Out" value={formatCurrency(summary?.totalPaid || 0)} />
                  <SummaryCard icon={<Clock className="w-4 h-4 text-amber-500" />} label="Pending" value={formatCurrency(summary?.pendingAmount || 0)} />
                  <SummaryCard icon={<IndianRupee className="w-4 h-4 text-primary" />} label="Claimable" value={formatCurrency(summary?.claimable || 0)} />
                </div>

                {/* Add Revenue Form */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Add Revenue Credit</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-3">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Amount (₹)</Label>
                        <Input
                          type="number"
                          min="1"
                          placeholder="Enter amount"
                          value={revenueAmount}
                          onChange={(e) => setRevenueAmount(e.target.value)}
                        />
                      </div>
                      <div className="flex-[2] space-y-1">
                        <Label className="text-xs">Notes</Label>
                        <Input
                          placeholder="e.g. March subscription revenue"
                          value={revenueNotes}
                          onChange={(e) => setRevenueNotes(e.target.value)}
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={!revenueAmount || Number(revenueAmount) <= 0 || addRevenueMutation.isPending}
                      onClick={() => addRevenueMutation.mutate()}
                    >
                      {addRevenueMutation.isPending ? "Adding..." : "Add Revenue"}
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Payment History Tab */}
          <TabsContent value="history" className="mt-4 space-y-3">
            {payLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>No payment history</p>
              </div>
            ) : (
              <>
                {/* Pending Requests */}
                {pendingPayments.length > 0 && (
                  <Card className="border-amber-200 dark:border-amber-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
                        <Clock className="w-4 h-4" />
                        Pending Requests ({pendingPayments.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {pendingPayments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-3 p-2 rounded bg-amber-50 dark:bg-amber-950/20">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{formatCurrency(p.amount)}</div>
                            <div className="text-xs text-muted-foreground">{p.notes} · {formatDate(p.requested_at)}</div>
                          </div>
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs"
                              disabled={processPaymentMutation.isPending}
                              onClick={() => processPaymentMutation.mutate({ paymentId: p.id, status: "completed" })}
                            >
                              <CheckCircle className="w-3 h-3 mr-1" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={processPaymentMutation.isPending}
                              onClick={() => processPaymentMutation.mutate({ paymentId: p.id, status: "rejected", notes: "Rejected by admin" })}
                            >
                              <XCircle className="w-3 h-3 mr-1" /> Reject
                            </Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Full History */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">All Transactions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {payments.map((p) => (
                        <div key={p.id} className="flex items-center gap-3 p-2 rounded text-sm bg-muted/50">
                          <div className="flex-shrink-0">
                            {p.type === "credit" ? (
                              <ArrowDownRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ArrowUpRight className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{formatCurrency(p.amount)}</span>
                            <span className="text-muted-foreground ml-2 text-xs">{p.notes}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge variant={p.status === "completed" ? "secondary" : p.status === "pending" ? "outline" : "destructive"} className="text-[10px]">
                              {p.status}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{formatDate(p.requested_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="mt-4 space-y-4">
            {analyticsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : !analytics ? (
              <div className="text-center py-8 text-muted-foreground">
                <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>No analytics data available</p>
              </div>
            ) : (
              <>
                {/* Recommendations (Calls + Positions) */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-500" />
                      Recommendations (Calls + Positions)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 mb-3">
                      <MiniStat label="Total" value={analytics.calls?.total || 0} />
                      <MiniStat label="Published" value={analytics.calls?.published || 0} />
                      <MiniStat label="Active" value={analytics.calls?.active || 0} color="text-green-600" />
                      <MiniStat label="Closed" value={analytics.calls?.closed || 0} />
                      <MiniStat label="This Week" value={analytics.calls?.thisWeek || 0} />
                      <MiniStat label="This Month" value={analytics.calls?.thisMonth || 0} />
                      <MiniStat label="Hit Rate" value={`${analytics.calls?.hitRate || 0}%`} color="text-green-600" />
                      <MiniStat label="Avg Return" value={`${analytics.calls?.avgReturn || 0}%`} color="text-blue-600" />
                    </div>
                    <p className="text-xs text-muted-foreground">{analytics.calls?.closedCount || 0} closed recommendations analyzed for performance</p>
                  </CardContent>
                </Card>

                {/* Customers */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-500" />
                      Subscribers
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                      <MiniStat label="Total" value={analytics.customers?.totalSubscribers || 0} />
                      <MiniStat label="New (Week)" value={analytics.customers?.newThisWeek || 0} />
                      <MiniStat label="New (Month)" value={analytics.customers?.newThisMonth || 0} />
                      <MiniStat label="New (YTD)" value={analytics.customers?.newYTD || 0} />
                      <MiniStat label="Active" value={analytics.customers?.activeSubs || 0} color="text-green-600" />
                      <MiniStat label="Churned" value={analytics.customers?.churned || 0} color="text-red-500" />
                    </div>
                  </CardContent>
                </Card>

                {/* Portfolio Analytics */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <PieChart className="w-4 h-4 text-teal-500" />
                      Portfolio Analytics
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      <MiniStat label="Portfolios" value={analytics.portfolios?.totalPortfolios || 0} />
                      <MiniStat label="Total AUM" value={formatCurrency(analytics.portfolios?.totalAUM || 0)} />
                      <MiniStat label="Avg Size" value={formatCurrency(analytics.portfolios?.avgPortfolioSize || 0)} />
                      <MiniStat label="Largest" value={formatCurrency(analytics.portfolios?.largestPortfolio || 0)} />
                    </div>
                    {analytics.portfolios?.sizeBuckets && (
                      <div className="mt-2">
                        <p className="text-xs text-muted-foreground mb-1.5">Distribution by Size</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(analytics.portfolios.sizeBuckets as Record<string, number>).map(([bucket, count]) => (
                            <span key={bucket} className="text-xs px-2 py-1 rounded-full bg-muted">
                              {bucket}: <span className="font-semibold">{count as number}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Sales */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-amber-500" />
                      Sales & Revenue
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <SummaryCard icon={<CircleDollarSign className="w-4 h-4 text-blue-500" />} label="Total Revenue" value={formatCurrency(analytics.sales?.totalRevenue || 0)} />
                      <SummaryCard icon={<ArrowUpRight className="w-4 h-4 text-green-500" />} label="This Week" value={formatCurrency(analytics.sales?.weeklySales || 0)} />
                      <SummaryCard icon={<TrendingUp className="w-4 h-4 text-purple-500" />} label="This Month" value={formatCurrency(analytics.sales?.monthlySales || 0)} />
                      <SummaryCard icon={<BarChart3 className="w-4 h-4 text-amber-500" />} label="YTD" value={formatCurrency(analytics.sales?.ytdSales || 0)} />
                    </div>
                    <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                      <span>Subscription Revenue: {formatCurrency(analytics.sales?.subscriptionRevenue || 0)}</span>
                      <span>Advisor Credits: {formatCurrency(analytics.sales?.advisorPayments || 0)}</span>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Helper Components ─── */
function MiniStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="text-center">
      <p className={`text-sm font-bold ${color || ""}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function BankField({ label, value, className }: { label: string; value: string | null | undefined; className?: string }) {
  return (
    <div className={`space-y-0.5 ${className || ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

/* ─── User Row ─── */
function UserRow({
  user,
  onApprove,
  onEdit,
  onDelete,
  onBankPay,
}: {
  user: SafeUser;
  onApprove?: (approved: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onBankPay?: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 rounded-md bg-muted/50" data-testid={`admin-user-row-${user.id}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{user.companyName || user.username}</span>
          <Badge variant="outline" className="text-xs">{user.role}</Badge>
          {user.role === "advisor" && (
            user.isApproved ? (
              <Badge variant="secondary" className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30">
                <CheckCircle className="w-3 h-3 mr-1" /> Approved
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
                Pending Approval
              </Badge>
            )
          )}
        </div>
        <p className="text-xs text-muted-foreground">{user.email}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Registered: {user.createdAt ? new Date(user.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) + " at " + new Date(user.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "N/A"}
        </p>
        {user.sebiRegNumber && (
          <p className="text-xs text-muted-foreground">SEBI: {user.sebiRegNumber}</p>
        )}
        {user.sebiCertUrl && (
          <a
            href={user.sebiCertUrl.startsWith("/objects/") ? user.sebiCertUrl : user.sebiCertUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary flex items-center gap-1"
            data-testid={`admin-cert-link-${user.id}`}
          >
            <FileText className="w-3 h-3" /> View SEBI Certificate
          </a>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {user.role === "advisor" && onBankPay && (
          <Button variant="outline" size="sm" onClick={onBankPay} data-testid={`admin-bankpay-${user.id}`}>
            <Landmark className="w-3 h-3 mr-1" /> Bank & Pay
          </Button>
        )}
        {user.role === "advisor" && onApprove && (
          <>
            {!user.isApproved ? (
              <Button
                size="sm"
                onClick={() => onApprove(true)}
                data-testid={`admin-approve-${user.id}`}
              >
                <CheckCircle className="w-3 h-3 mr-1" /> Approve
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onApprove(false)}
                data-testid={`admin-disapprove-${user.id}`}
              >
                <XCircle className="w-3 h-3 mr-1" /> Disapprove
              </Button>
            )}
          </>
        )}
        <Button variant="outline" size="icon" onClick={onEdit} data-testid={`admin-edit-user-${user.id}`}>
          <Pencil className="w-3 h-3" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="icon" data-testid={`admin-delete-user-${user.id}`}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete User?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete {user.companyName || user.username} and all their data including strategies, calls, plans, and content. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} data-testid={`admin-confirm-delete-${user.id}`}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
