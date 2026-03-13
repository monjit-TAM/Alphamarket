import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/navbar";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  HelpCircle,
  Globe,
  BarChart3,
  BookOpen,
  ListChecks,
  FolderKanban,
  IndianRupee,
  User,
  LogOut,
  CreditCard,
  MessageCircle,
} from "lucide-react";

import DashboardHome from "./dashboard-home";
import StrategyManagement from "./strategy-management";
import PlansPage from "./plans";
import ContentPage from "./content-page";
import AdvisorProfile from "./advisor-profile";
import MicrositeEditor from "./microsite-editor";
import ReportsPage from "./reports";
import PaymentsPage from "./payments-page";
import QuestionsPage from "./questions-page";
import SubscriberPortfolioPage from "./subscriber-portfolio";

const sidebarItems = [
  { title: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { title: "Strategies", icon: ListChecks, path: "/dashboard/strategies" },
  { title: "Plans", icon: FolderKanban, path: "/dashboard/plans" },
  { title: "Payments", icon: CreditCard, path: "/dashboard/payments" },
  { title: "Questions", icon: MessageCircle, path: "/dashboard/questions" },
  { title: "Content", icon: BookOpen, path: "/dashboard/content" },
  { title: "Reports", icon: BarChart3, path: "/dashboard/reports" },
  { title: "Microsite", icon: Globe, path: "/dashboard/microsite" },
  { title: "Profile", icon: User, path: "/dashboard/profile" },
];

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/advisor/questions/unread-count"],
    enabled: !!user && user.role === "advisor",
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.count || 0;

  if (!user || user.role !== "advisor") {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center space-y-2">
            <p className="text-muted-foreground">You need to be signed in as an Advisor to access the dashboard.</p>
            <Link href="/login">
              <a className="text-primary font-medium">Sign In</a>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const style = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3rem",
  };

  const renderPage = () => {
    if (location === "/dashboard/strategies") return <StrategyManagement />;
    if (location.startsWith("/dashboard/subscriber/") && location.endsWith("/portfolio")) return <SubscriberPortfolioPage />;
    if (location === "/dashboard/plans") return <PlansPage />;
    if (location === "/dashboard/payments") return <PaymentsPage />;
    if (location === "/dashboard/questions") return <QuestionsPage />;
    if (location === "/dashboard/content") return <ContentPage />;
    if (location === "/dashboard/reports") return <ReportsPage />;
    if (location === "/dashboard/microsite") return <MicrositeEditor />;
    if (location === "/dashboard/profile") return <AdvisorProfile />;
    return <DashboardHome />;
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-[calc(100vh-3.5rem)] w-full">
          <Sidebar>
            <SidebarContent className="pt-2">
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {sidebarItems.map((item) => {
                      const isActive = location === item.path || (item.path !== "/dashboard" && location.startsWith(item.path));
                      return (
                        <SidebarMenuItem key={item.title}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            data-testid={`sidebar-${item.title.toLowerCase()}`}
                          >
                            <Link href={item.path}>
                              <item.icon className="w-4 h-4" />
                              <span className="flex-1">{item.title}</span>
                              {item.title === "Questions" && unreadCount > 0 && (
                                <Badge variant="destructive" className="text-[10px] ml-auto" data-testid="badge-sidebar-unread">
                                  {unreadCount}
                                </Badge>
                              )}
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={logout}
                        data-testid="sidebar-logout"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <a href="/walkthrough.html" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-blue-400 hover:text-blue-300">
                          <HelpCircle className="w-4 h-4" />
                          <span>Product Guide</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center h-10 px-3 border-b bg-background flex-shrink-0">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
            </div>
            <main className="flex-1 overflow-y-auto p-4 md:p-6">
              {renderPage()}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </div>
  );
}
