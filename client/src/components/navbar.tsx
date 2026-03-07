import { Link, useLocation } from "wouter";
import { useState } from "react";
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
import {
  ChevronDown, User, LogOut, LayoutDashboard, ShieldCheck,
  Search, Menu, X, Activity, TrendingUp, BarChart3, BookOpen,
  Users, LineChart, Briefcase, FlaskConical, Target, Compass
} from "lucide-react";
import logoImg from "@assets/AlphaMarket_Logo_Dark.png";
import { NotificationBell } from "./notification-bell";

export function Navbar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const isActive = (href: string) => location === href || location.startsWith(href + "/");

  return (
    <>
      {/* ── Top Bar (dark, Amazon-style) ───────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-slate-900 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex h-14 items-center gap-4">
            {/* Logo */}
            <Link href="/" className="flex-shrink-0">
              <img src={logoImg} alt="AlphaMarket" className="h-8 object-contain" />
            </Link>

            {/* Search Bar (desktop) */}
            <div className="hidden md:flex flex-1 max-w-xl mx-4">
              <div className="flex w-full">
                <select className="h-9 px-2 text-xs bg-slate-700 border-0 rounded-l-md text-slate-300 focus:outline-none focus:ring-1 focus:ring-red-500">
                  <option>All</option>
                  <option>Strategies</option>
                  <option>Advisors</option>
                  <option>Stocks</option>
                </select>
                <input
                  type="text"
                  placeholder="Search strategies, advisors, stocks..."
                  className="flex-1 h-9 px-3 text-sm bg-white text-gray-900 border-0 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <button className="h-9 px-3 bg-red-600 hover:bg-red-700 rounded-r-md transition-colors">
                  <Search className="h-4 w-4 text-white" />
                </button>
              </div>
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-1 ml-auto">
              {/* Mobile search toggle */}
              <button
                className="md:hidden p-2 hover:bg-slate-800 rounded"
                onClick={() => setSearchOpen(!searchOpen)}
              >
                <Search className="h-5 w-5" />
              </button>

              <NotificationBell />

              {user ? (
                <>
                  {/* Hello, Username (Amazon style) */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="hidden md:flex flex-col items-start px-2 py-1 hover:bg-slate-800 rounded text-left">
                        <span className="text-xs text-slate-400">Hello, {user.username.split(" ")[0]}</span>
                        <span className="text-sm font-semibold flex items-center gap-1">
                          Account <ChevronDown className="h-3 w-3" />
                        </span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <div className="px-3 py-2 border-b">
                        <p className="text-sm font-medium">{user.username}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                      {user.role === "investor" && (
                        <Link href="/investor-dashboard">
                          <DropdownMenuItem><LayoutDashboard className="w-4 h-4 mr-2" /> My Dashboard</DropdownMenuItem>
                        </Link>
                      )}
                      {user.role === "advisor" && (
                        <Link href="/dashboard">
                          <DropdownMenuItem><LayoutDashboard className="w-4 h-4 mr-2" /> Advisor Dashboard</DropdownMenuItem>
                        </Link>
                      )}
                      {user.role === "admin" && (
                        <Link href="/admin">
                          <DropdownMenuItem><ShieldCheck className="w-4 h-4 mr-2" /> Admin Panel</DropdownMenuItem>
                        </Link>
                      )}
                      <Link href="/dashboard/profile">
                        <DropdownMenuItem><User className="w-4 h-4 mr-2" /> Profile</DropdownMenuItem>
                      </Link>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={logout}><LogOut className="w-4 h-4 mr-2" /> Sign Out</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Mobile avatar */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="md:hidden p-1">
                        <Avatar className="w-7 h-7">
                          <AvatarFallback className="text-xs bg-red-700 text-white">
                            {user.username.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem className="text-xs text-muted-foreground">{user.email}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={logout}><LogOut className="w-4 h-4 mr-2" /> Sign Out</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Link href="/login">
                    <button className="hidden md:flex flex-col items-start px-2 py-1 hover:bg-slate-800 rounded text-left">
                      <span className="text-xs text-slate-400">Hello, Sign in</span>
                      <span className="text-sm font-semibold flex items-center gap-1">Account <ChevronDown className="h-3 w-3" /></span>
                    </button>
                  </Link>
                  <Link href="/register">
                    <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white border-0">
                      Get Started
                    </Button>
                  </Link>
                </div>
              )}

              {/* Mobile menu toggle */}
              <button
                className="md:hidden p-2 hover:bg-slate-800 rounded"
                onClick={() => setMobileOpen(!mobileOpen)}
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* ── Navigation Bar (secondary, lighter) ──────────────────────── */}
        <nav className="bg-slate-800 border-t border-slate-700">
          <div className="max-w-7xl mx-auto px-4">
            <div className="hidden md:flex items-center gap-1 h-10 text-sm overflow-x-auto">
              {[
                { label: "Strategies", href: "/strategies", icon: BarChart3 },
                { label: "Advisors", href: "/advisors", icon: Users },
                { label: "Market Outlook", href: "/market-outlook", icon: TrendingUp },
                { label: "Learn", href: "/learn", icon: BookOpen },
              ].map((item) => (
                <Link key={item.href} href={item.href}>
                  <button
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-slate-700 transition-colors whitespace-nowrap ${
                      isActive(item.href) ? "bg-slate-700 text-red-500" : "text-slate-300"
                    }`}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                </Link>
              ))}

              <div className="w-px h-5 bg-slate-600 mx-1" />

              {/* DYOR Research — highlighted */}
              <a href="/dyor/app">
                <button
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
                    isActive("/dyor/app")
                      ? "bg-red-700 text-white"
                      : "text-red-500 hover:bg-slate-700 font-medium"
                  }`}
                >
                  <Activity className="h-3.5 w-3.5" />
                  DYOR Research
                </button>
              </a>

              <div className="w-px h-5 bg-slate-600 mx-1" />

              {/* External tools */}
              <a href="https://mf.alphamarket.co.in" className="flex items-center gap-1.5 px-3 py-1.5 rounded text-slate-400 hover:bg-slate-700 hover:text-slate-300 transition-colors whitespace-nowrap">
                <Briefcase className="h-3.5 w-3.5" /> MF Analyzer
              </a>
              <a href="https://stocks.alphamarket.co.in/upload" className="flex items-center gap-1.5 px-3 py-1.5 rounded text-slate-400 hover:bg-slate-700 hover:text-slate-300 transition-colors whitespace-nowrap">
                <LineChart className="h-3.5 w-3.5" /> Stock Analyzer
              </a>
            </div>
          </div>
        </nav>

        {/* ── Mobile Search ────────────────────────────────────────────── */}
        {searchOpen && (
          <div className="md:hidden px-4 py-2 bg-slate-800 border-t border-slate-700">
            <div className="flex">
              <input
                type="text"
                placeholder="Search..."
                className="flex-1 h-9 px-3 text-sm bg-white text-gray-900 rounded-l-md focus:outline-none"
                autoFocus
              />
              <button className="h-9 px-3 bg-red-600 rounded-r-md">
                <Search className="h-4 w-4 text-white" />
              </button>
            </div>
          </div>
        )}

        {/* ── Mobile Menu ──────────────────────────────────────────────── */}
        {mobileOpen && (
          <div className="md:hidden bg-slate-800 border-t border-slate-700 pb-3">
            {[
              { label: "Strategies", href: "/strategies", icon: BarChart3 },
              { label: "Advisors", href: "/advisors", icon: Users },
              { label: "Market Outlook", href: "/market-outlook", icon: TrendingUp },
              { label: "Learn", href: "/learn", icon: BookOpen },
              { label: "DYOR Research", href: "/dyor/app", icon: Activity, external: true },
            ].map((item) => (
              <Link key={item.href} href={item.href}>
                <button
                  className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm ${
                    isActive(item.href) ? "text-red-500 bg-slate-700" : "text-slate-300 hover:bg-slate-700"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              </Link>
            ))}
            <div className="border-t border-slate-700 mt-2 pt-2 px-4">
              <a href="https://mf.alphamarket.co.in" className="flex items-center gap-3 py-2 text-sm text-slate-400">
                <Briefcase className="h-4 w-4" /> MF Analyzer
              </a>
              <a href="https://stocks.alphamarket.co.in/upload" className="flex items-center gap-3 py-2 text-sm text-slate-400">
                <LineChart className="h-4 w-4" /> Stock Analyzer
              </a>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
