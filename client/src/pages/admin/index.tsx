import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { Navbar } from "@/components/navbar";
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
import { Users, BarChart3, LayoutDashboard, LogOut, Settings } from "lucide-react";

import AdminAdvisors from "./admin-advisors";
import AdminStrategies from "./admin-strategies";
import AdminSettings from "./admin-settings";

const sidebarItems = [
  { title: "Advisors", icon: Users, path: "/admin" },
  { title: "Strategies", icon: BarChart3, path: "/admin/strategies" },
  { title: "Settings", icon: Settings, path: "/admin/settings" },
];

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center space-y-2">
            <p className="text-muted-foreground">Admin access required.</p>
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
    if (location === "/admin/strategies") return <AdminStrategies />;
    if (location === "/admin/settings") return <AdminSettings />;
    return <AdminAdvisors />;
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
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={false}>
                        <div className="flex items-center gap-2 px-2 py-1">
                          <LayoutDashboard className="w-4 h-4 text-primary" />
                          <span className="font-semibold text-sm">Admin Panel</span>
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {sidebarItems.map((item) => {
                      const isActive = location === item.path || (item.path !== "/admin" && location.startsWith(item.path));
                      return (
                        <SidebarMenuItem key={item.title}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            data-testid={`admin-sidebar-${item.title.toLowerCase()}`}
                          >
                            <Link href={item.path}>
                              <item.icon className="w-4 h-4" />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={logout}
                        data-testid="admin-sidebar-logout"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center h-10 px-3 border-b bg-background flex-shrink-0">
              <SidebarTrigger data-testid="admin-sidebar-toggle" />
              <span className="ml-2 text-sm font-medium text-muted-foreground">Admin Dashboard</span>
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
