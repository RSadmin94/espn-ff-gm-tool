// FILE: client/src/components/AppLayout.tsx
import React, { createContext, useContext, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ClipboardList, Star, ArrowLeftRight, Bot, ChevronRight,
  Activity, Brain, Zap, Shield, Microscope, AlertTriangle, XCircle, X, Target, BarChart3, Link2, Sunrise,
  ChevronDown, Settings2, Users, LineChart, Menu,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import AdvisorPanel from "./AdvisorPanel";
import LeagueSwitcher from "./LeagueSwitcher";

type NavItem = {
  href: string;
  icon: React.ElementType;
  label: string;
  group: string;
  badge?: string;
  panel?: string;
};

// ─── Navigation Groups ──────────────────────────────────────────────────────
const navItems: NavItem[] = [
  // Intelligence
  { href: "/command-center", icon: LayoutDashboard, label: "Command Center", group: "Intelligence" },
  { href: "/weekly-intelligence", icon: Activity, label: "Weekly Intel", group: "Intelligence", badge: "LIVE" },
  { href: "/opponent-intel", icon: Microscope, label: "Opponent DNA", group: "Intelligence" },
  { href: "/gm-memory", icon: Brain, label: "GM Memory", group: "Intelligence" },
  // Team Tools
  { href: "/waiver-lab", icon: Zap, label: "Waivers", group: "Team Tools", badge: "AI" },
  { href: "/trade-lab", icon: ArrowLeftRight, label: "Trades", group: "Team Tools", badge: "AI" },
  { href: "/keeper-lab", icon: Star, label: "Keepers", group: "Team Tools" },
  { href: "/draft-war-room", icon: ClipboardList, label: "Draft Room", group: "Team Tools", badge: "AI" },
  { href: "/offseason", icon: Sunrise, label: "Offseason", group: "Team Tools", badge: "2026" },
  { href: "/rosters", icon: Users, label: "Rosters", group: "Team Tools" },
  { href: "/data-center", icon: Shield, label: "Data Center", group: "Team Tools" },
  // System
  { href: "/connect", icon: Link2, label: "Connect League", group: "System" },
  { href: "/weekly-stats", icon: Activity, label: "Weekly Stats", group: "System" },
  { href: "/backtesting", icon: Target, label: "Backtesting", group: "System" },
  { href: "/ml-forecast", icon: BarChart3, label: "ML Forecast", group: "System" },
  { href: "/usage-monitor", icon: Settings2, label: "Usage Monitor", group: "System" },
  { href: "/admin/behavioral", icon: LineChart, label: "Behavioral Analytics", group: "System" },
  { href: "/admin/activity-capture", icon: Activity, label: "Activity Capture", group: "System" },
];

const primaryGroups = ["Intelligence", "Team Tools"];
const systemGroup = "System";

function DataHealthBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { data } = trpc.pipeline.health.useQuery({}, { refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 });
  if (dismissed || !data) return null;
  const { cookiesPresent, overallHealth, staleSeasons, partialSeasons } = data;
  let variant: "red" | "amber" | "yellow" | null = null;
  if (!cookiesPresent) variant = "red";
  else if (overallHealth === "critical" || overallHealth === "degraded" || staleSeasons > 3) variant = "amber";
  else if (overallHealth === "warning") variant = "yellow";
  if (!variant) return null;
  const config = {
    red: {
      wrapper: "bg-red-950/60 border-red-500/40 text-red-200",
      icon: <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />,
      message: (<>ESPN cookies are missing or expired. Live data is unavailable.{" "}<Link href="/data-center" className="underline underline-offset-2 hover:text-red-100 font-semibold">Go to Data Center → Credentials</Link>{" "}to update.</>),
    },
    amber: {
      wrapper: "bg-amber-950/60 border-amber-500/40 text-amber-200",
      icon: <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />,
      message: (<>League data is stale ({staleSeasons} season{staleSeasons !== 1 ? "s" : ""} not refreshed in 7+ days).{" "}<Link href="/data-center" className="underline underline-offset-2 hover:text-amber-100 font-semibold">Go to Data Center</Link>{" "}to sync.</>),
    },
    yellow: {
      wrapper: "bg-yellow-950/40 border-yellow-500/30 text-yellow-200",
      icon: <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />,
      message: (<>Some league data may be incomplete ({partialSeasons} partial season{partialSeasons !== 1 ? "s" : ""}).{" "}<Link href="/data-center" className="underline underline-offset-2 hover:text-yellow-100 font-semibold">Go to Data Center</Link>{" "}to review.</>),
    },
  };
  const { wrapper, icon, message } = config[variant];
  return (
    <div className={cn("flex-shrink-0 border-b px-4 py-2.5 flex items-center gap-3 text-xs", wrapper)}>
      {icon}
      <span className="flex-1">{message}</span>
      <button onClick={() => setDismissed(true)} className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity" aria-label="Dismiss">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

const InsideLayoutContext = createContext(false);

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
}

function ActiveLeagueFooter() {
  const activeLeague = trpc.league.getActive.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const league = activeLeague.data;
  return (
    <div className="px-5 py-3 border-t border-border">
      <div className="flex items-center gap-2">
        <Brain className="w-3 h-3 text-primary/60" />
        {league ? (
          <p className="text-[10px] text-muted-foreground truncate">
            {league.leagueName || `League ${league.leagueId}`}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">AI-Powered · No league</p>
        )}
      </div>
      {league ? (
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
          {league.provider?.toUpperCase()} · Season {league.season}
          {" · "}
          <Link href="/connect" className="hover:text-primary underline underline-offset-2">Switch</Link>
        </p>
      ) : (
        <Link href="/connect" className="text-[10px] text-primary hover:underline">Connect a league →</Link>
      )}
    </div>
  );
}

// ─── Shared sidebar nav content ──────────────────────────────────────────────
function SidebarNav({
  location,
  advisorOpen,
  onAdvisorOpen,
  onNavClick,
}: {
  location: string;
  advisorOpen: boolean;
  onAdvisorOpen: () => void;
  onNavClick?: () => void;
}) {
  const [systemExpanded, setSystemExpanded] = useState(false);
  return (
    <>
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {primaryGroups.map((group) => {
          const items = navItems.filter((n) => n.group === group);
          return (
            <div key={group} className="mb-5">
              <p className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest px-2 mb-1.5">{group}</p>
              {items.map((item) => {
                const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                const cls = cn(
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 mb-0.5 group w-full text-left",
                  active ? "bg-primary/15 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                );
                return (
                  <Link key={item.href} href={item.href} className={cls} onClick={onNavClick}>
                    <item.icon className={cn("w-4 h-4 flex-shrink-0 transition-colors", active ? "text-primary" : "group-hover:text-foreground")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && <Badge className="text-[8px] px-1 py-0 h-3.5 espn-gradient text-white border-0 font-bold">{item.badge}</Badge>}
                    {active && <ChevronRight className="w-3 h-3 text-primary flex-shrink-0" />}
                  </Link>
                );
              })}
            </div>
          );
        })}

        {/* AI GM Advisor — prominent CTA */}
        <div className="mb-5 px-1">
          <button
            onClick={() => { onAdvisorOpen(); onNavClick?.(); }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-150",
              advisorOpen
                ? "bg-primary text-primary-foreground shadow-md"
                : "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
            )}
          >
            <Bot className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 truncate">AI GM Advisor</span>
            <Badge className="text-[8px] px-1 py-0 h-3.5 espn-gradient text-white border-0 font-bold">AI</Badge>
          </button>
        </div>

        {/* System group — collapsible */}
        <div className="mb-2">
          <button
            onClick={() => setSystemExpanded(v => !v)}
            className="flex items-center gap-2 px-3 py-2 mb-1.5 w-full rounded-lg border border-border/60 bg-accent/30 hover:bg-accent/60 hover:border-border transition-all duration-150 group"
          >
            <Settings2 className="w-3.5 h-3.5 text-muted-foreground/70 group-hover:text-foreground transition-colors" />
            <p className="text-[11px] font-semibold text-muted-foreground/70 group-hover:text-foreground uppercase tracking-wider flex-1 text-left transition-colors">System</p>
            <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/60 transition-transform", systemExpanded ? "rotate-180" : "")} />
          </button>
          {systemExpanded && navItems.filter(n => n.group === systemGroup).map((item) => {
            const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const cls = cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all duration-150 mb-0.5 group w-full text-left",
              active ? "bg-primary/15 text-primary" : "text-muted-foreground/70 hover:text-foreground hover:bg-accent/60"
            );
            return (
              <Link key={item.href} href={item.href} className={cls} onClick={onNavClick}>
                <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && <Badge className="text-[8px] px-1 py-0 h-3.5 bg-zinc-700 text-zinc-300 border-0 font-bold">{item.badge}</Badge>}
                {active && <ChevronRight className="w-3 h-3 text-primary flex-shrink-0" />}
              </Link>
            );
          })}
        </div>
      </nav>
      <LeagueSwitcher />
    </>
  );
}

export default function AppLayout({ children, title, subtitle, headerRight }: AppLayoutProps) {
  const [location] = useLocation();
  const alreadyInsideLayout = useContext(InsideLayoutContext);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close mobile nav on route change
  useEffect(() => { setMobileNavOpen(false); }, [location]);

  // Listen for Chrome extension toolbar click → open advisor panel
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_ADVISOR_PANEL') setAdvisorOpen(true);
    };
    window.addEventListener('message', handleMessage);
    const params = new URLSearchParams(window.location.search);
    if (params.get('openAdvisor') === '1') {
      setAdvisorOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('openAdvisor');
      window.history.replaceState({}, '', url.toString());
    }
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Prevent body scroll when mobile nav is open
  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileNavOpen]);

  if (alreadyInsideLayout) return <>{children}</>;

  return (
    <InsideLayoutContext.Provider value={true}>
      <div className="flex h-screen bg-background overflow-hidden">

        {/* ── Desktop sidebar (hidden on mobile) ── */}
        <aside className="hidden lg:flex flex-shrink-0 flex-col border-r border-border bg-card" style={{ width: "15.5rem" }}>
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl espn-gradient flex items-center justify-center flex-shrink-0 shadow-lg">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground leading-tight tracking-tight">{import.meta.env.VITE_APP_TITLE || "GM WAR ROOM"}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">GM Command Center</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <div className="flex-1 h-px bg-border" />
              <Badge variant="outline" className="text-[9px] px-2 border-primary/30 text-primary font-mono">2009 – 2026</Badge>
              <div className="flex-1 h-px bg-border" />
            </div>
          </div>
          <SidebarNav
            location={location}
            advisorOpen={advisorOpen}
            onAdvisorOpen={() => setAdvisorOpen(true)}
          />
        </aside>

        {/* ── Mobile drawer overlay ── */}
        {mobileNavOpen && (
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ── Mobile slide-out drawer ── */}
        <aside
          className={cn(
            "lg:hidden fixed inset-y-0 left-0 z-50 flex flex-col bg-card border-r border-border transition-transform duration-300 ease-in-out",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          )}
          style={{ width: "16rem" }}
        >
          {/* Drawer header */}
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl espn-gradient flex items-center justify-center flex-shrink-0 shadow-lg">
                <Activity className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground leading-tight tracking-tight">{import.meta.env.VITE_APP_TITLE || "GM WAR ROOM"}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">GM Command Center</p>
              </div>
            </div>
            <button
              onClick={() => setMobileNavOpen(false)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <SidebarNav
            location={location}
            advisorOpen={advisorOpen}
            onAdvisorOpen={() => setAdvisorOpen(true)}
            onNavClick={() => setMobileNavOpen(false)}
          />
        </aside>

        {/* ── Main content ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Mobile top bar (always visible on mobile) */}
          <div className="lg:hidden flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              {title && <h1 className="text-sm font-bold text-foreground truncate">{title}</h1>}
              {subtitle && <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>}
            </div>
            {headerRight && <div className="flex-shrink-0">{headerRight}</div>}
          </div>

          {/* Desktop page header */}
          {(title || subtitle) && (
            <header className="hidden lg:flex flex-shrink-0 px-8 py-4 border-b border-border bg-card/50 backdrop-blur-sm">
              <div className="flex items-center justify-between w-full">
                <div>
                  {title && <h1 className="text-lg font-bold text-foreground tracking-tight">{title}</h1>}
                  {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
                </div>
                {headerRight && <div>{headerRight}</div>}
              </div>
            </header>
          )}

          <DataHealthBanner />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>

      <AdvisorPanel open={advisorOpen} onClose={() => setAdvisorOpen(false)} />
    </InsideLayoutContext.Provider>
  );
}
