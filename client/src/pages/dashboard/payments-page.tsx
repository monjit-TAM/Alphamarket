import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { IndianRupee, CheckCircle2, Clock, XCircle } from "lucide-react";

interface PaymentRecord {
  id: string;
  orderId: string;
  userId: string;
  strategyId: string | null;
  planId: string | null;
  advisorId: string | null;
  amount: string;
  currency: string;
  status: string;
  paymentMethod: string | null;
  cfPaymentId: string | null;
  subscriptionId: string | null;
  paidAt: string | null;
  createdAt: string;
  customerName?: string;
  customerEmail?: string;
  strategyName?: string;
  planName?: string;
}

export default function PaymentsPage() {
  const { data: payments, isLoading } = useQuery<PaymentRecord[]>({
    queryKey: ["/api/advisor/payments"],
  });

  const totalRevenue = (payments || [])
    .filter(p => p.status === "PAID")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const paidCount = (payments || []).filter(p => p.status === "PAID").length;
  const pendingCount = (payments || []).filter(p => p.status === "PENDING" || p.status === "ACTIVE").length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold" data-testid="text-payments-title">Payments</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold flex items-center gap-0.5 mt-1" data-testid="text-total-revenue">
                  <IndianRupee className="w-5 h-5" />
                  {totalRevenue.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                <IndianRupee className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Successful Payments</p>
                <p className="text-2xl font-bold mt-1" data-testid="text-paid-count">{paidCount}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold mt-1" data-testid="text-pending-count">{pendingCount}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Transaction History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!payments || payments.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground" data-testid="text-no-payments">
              No payment transactions yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Customer</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Strategy</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Method</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b last:border-b-0" data-testid={`row-payment-${p.id}`}>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {new Date(p.createdAt).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">{p.customerName || "—"}</p>
                          <p className="text-xs text-muted-foreground">{p.customerEmail || ""}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">{p.strategyName || "—"}</td>
                      <td className="px-4 py-3">{p.planName || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                        {"\u20B9"}{Number(p.amount).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.paymentMethod || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {p.status === "PAID" ? (
                          <Badge variant="default" className="bg-green-600 text-white">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Paid
                          </Badge>
                        ) : p.status === "PENDING" || p.status === "ACTIVE" ? (
                          <Badge variant="secondary">
                            <Clock className="w-3 h-3 mr-1" />
                            Pending
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <XCircle className="w-3 h-3 mr-1" />
                            {p.status}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
