import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Users, Shield, BarChart3, TrendingUp, IndianRupee, PieChart,
  Activity, Briefcase, ArrowRight,
} from "lucide-react";

function formatCurrency(val: number) {
  if (val >= 10000000) return "\u20b9" + (val / 10000000).toFixed(2) + " Cr";
  if (val >= 100000) return "\u20b9" + (val / 100000).toFixed(2) + " L";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

export default function AdminHome() {
  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/dashboard-stats"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <h1 className="text-xl font-bold">Dashboard Overview</h1>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1,2,3,4,5,6,7,8].map(i => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const cards = [
    { icon: <Shield className="w-5 h-5 text-blue-500" />, label: "Total Advisors", value: stats?.totalAdvisors || 0, link: "/admin/advisors", desc: "Registered advisors on platform" },
    { icon: <Users className="w-5 h-5 text-purple-500" />, label: "Total Investors", value: stats?.totalInvestors || 0, link: "/admin/advisors", desc: "Registered investor accounts" },
    { icon: <BarChart3 className="w-5 h-5 text-teal-500" />, label: "Strategies", value: stats?.totalStrategies || 0, link: "/admin/strategies", desc: "Published & draft strategies" },
    { icon: <Briefcase className="w-5 h-5 text-amber-500" />, label: "Active Subscriptions", value: stats?.activeSubscriptions || 0, link: "/admin/advisors", desc: "Currently active subscriptions" },
    { icon: <PieChart className="w-5 h-5 text-green-500" />, label: "Total AUM", value: formatCurrency(stats?.totalAUM || 0), link: "/admin/advisors", desc: "Assets under management across all portfolios" },
    { icon: <IndianRupee className="w-5 h-5 text-emerald-500" />, label: "Total Revenue", value: formatCurrency(stats?.totalRevenue || 0), link: "/admin/monetization", desc: "Revenue from subscription payments" },
    { icon: <TrendingUp className="w-5 h-5 text-rose-500" />, label: "Advisor Credits", value: formatCurrency(stats?.totalAdvisorCredits || 0), link: "/admin/advisors", desc: "Credits allocated to advisors" },
    { icon: <Activity className="w-5 h-5 text-indigo-500" />, label: "Calls This Month", value: stats?.callsThisMonth || 0, link: "/admin/strategies", desc: "Strategy calls published this month" },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-xl font-bold" data-testid="admin-heading-dashboard">Dashboard Overview</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map((card, i) => (
          <Link key={i} href={card.link}>
            <Card className="hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {card.icon}
                    <span className="text-xs">{card.label}</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-2xl font-bold">{card.value}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{card.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
