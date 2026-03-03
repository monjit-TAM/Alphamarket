import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChevronDown, User, LogOut, LayoutDashboard, ShieldCheck } from "lucide-react";
import logoImg from "@assets/Alphamarket_Logo_without_Background_1770374165590.png";
import { NotificationBell } from "./notification-bell";

export function Navbar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const navItems = [
    { label: "Strategies", href: "/strategies" },
    { label: "Advisors", href: "/advisors" },
    { label: "Market Outlook", href: "/market-outlook" },
    { label: "Learn", href: "/learn" },
  ];

  const externalLinks = [
    { label: "MF Analyzer", href: "https://mf.alphamarket.co.in" },
    { label: "Stock Analyzer", href: "https://stocks.alphamarket.co.in/upload" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-4 px-4 md:px-6 max-w-7xl mx-auto">
        <Link href="/" data-testid="link-home">
          <img src={logoImg} alt="AlphaMarket" className="h-8 object-contain" data-testid="img-logo" />
        </Link>

        <nav className="hidden md:flex items-center gap-1 ml-6">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <Button
                variant={location === item.href ? "secondary" : "ghost"}
                size="sm"
                data-testid={`link-nav-${item.label.toLowerCase()}`}
              >
                {item.label}
              </Button>
            </Link>
          ))}
          {externalLinks.map((item) => (
            <a key={item.href} href={item.href}>
              <Button variant="ghost" size="sm">
                {item.label}
              </Button>
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 ml-auto">
          <NotificationBell />
          {user ? (
            <>
              {user.role === "investor" && (
                <Link href="/investor-dashboard">
                  <Button variant="outline" size="sm" data-testid="link-investor-dashboard">
                    <LayoutDashboard className="w-4 h-4 mr-1" />
                    Dashboard
                  </Button>
                </Link>
              )}
              {user.role === "advisor" && (
                <Link href="/dashboard">
                  <Button variant="outline" size="sm" data-testid="link-dashboard">
                    <LayoutDashboard className="w-4 h-4 mr-1" />
                    Dashboard
                  </Button>
                </Link>
              )}
              {user.role === "admin" && (
                <Link href="/admin">
                  <Button variant="outline" size="sm" data-testid="link-admin">
                    <ShieldCheck className="w-4 h-4 mr-1" />
                    Admin Panel
                  </Button>
                </Link>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1" data-testid="button-user-menu">
                    <Avatar className="w-6 h-6">
                      <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                        {user.username.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem className="text-xs text-muted-foreground">
                    {user.email}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {user.role === "investor" && (
                    <Link href="/investor-dashboard">
                      <DropdownMenuItem data-testid="menu-investor-dashboard">
                        <LayoutDashboard className="w-4 h-4 mr-2" />
                        Dashboard
                      </DropdownMenuItem>
                    </Link>
                  )}
                  {user.role === "advisor" && (
                    <Link href="/dashboard">
                      <DropdownMenuItem data-testid="menu-dashboard">
                        <LayoutDashboard className="w-4 h-4 mr-2" />
                        Dashboard
                      </DropdownMenuItem>
                    </Link>
                  )}
                  {user.role === "admin" && (
                    <Link href="/admin">
                      <DropdownMenuItem data-testid="menu-admin">
                        <ShieldCheck className="w-4 h-4 mr-2" />
                        Admin Panel
                      </DropdownMenuItem>
                    </Link>
                  )}
                  <Link href="/dashboard/profile">
                    <DropdownMenuItem data-testid="menu-profile">
                      <User className="w-4 h-4 mr-2" />
                      Profile
                    </DropdownMenuItem>
                  </Link>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} data-testid="menu-logout">
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm" data-testid="link-login">
                  Sign In
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm" data-testid="link-register">
                  Get Started
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
