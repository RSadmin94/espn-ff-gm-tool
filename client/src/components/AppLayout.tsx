// FILE: client/src/components/AppLayout.tsx
import React, { createContext, useContext, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ClipboardList, Star, ArrowLeftRight, Bot, ChevronRight,
  Activity, Brain, Zap, Shield, Microscope, AlertTriangle, XCircle, X, Target, BarChart3, Link2, Sunrise,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import AdvisorPanel from "./AdvisorPanel";
import PaywallPrompt from "./PaywallPrompt";

type NavItem = {
  href: string;
  icon: React.ElementType;
  label: string;
  group: string;
  badge?: string;
  panel?: string;
};

const navItems: NavItem[] = [
  // Win This Week
  { href: "/command-center", icon: LayoutDashboard, label: "Command Center", group: "Win This Week" },
  { href: "/advisor", icon: Bot, label: "AI GM Advisor", group: "Win This Week", badge: "AI", panel: "advisor" },
  { href: "/waiver-lab", icon: Zap, label: "Waiver Lab", group: "Win This Week", badge: "AI" },
  { href: "/weekly-intelligence", icon: Activity, label: "Weekly Intel", group: "Win This Week", badge: "NEW" },
  // Win Trades
  { href: "/trade-lab", icon: ArrowLeftRight, label: "Trade Lab", group: "Win Trades", badge: "AI" },
  { href: "/opponent-intel", icon: Microscope, label: "Opponent Intel", group: "Win Trades" },
  // Win Long Term
  { href: "/offseason", icon: Sunrise, label: "Offseason Intel", group: "Win Long Term", badge: "2026" },
  { href: "/draft-war-room", icon: ClipboardList, label: "Draft War Room", group: "Win Long Term" },
  { href: "/keeper-lab", icon: Star, label: "Keeper Lab", group: "Win Long Term" },
  { href: "/gm-memory", icon: Brain, label: "GM Memory", group: "Win Long Term", badge: "NEW" },
  // Admin/Data
  { href: "/data-center", icon: Shield, label: "Data Center", group: "Admin/Data" },
  { href: "/weekly-stats", icon: Activity, label: "Weekly Stats", group: "Admin/Data" },
  { href: "/backtesting", icon: Target, label: "Backtesting", group: "Admin/Data", badge: "NEW" },
  { href: "/ml-forecast", icon: BarChart3, label: "ML Forecast", group: "Admin/Data", badge: "ML" },
  { href: "/connect", icon: Link2, label: "Connect League", group: "Admin/Data" },
];

const groups = ["Win This Week", "Win Trades", "Win Long Term", "Admin/Data"];

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
    <div className={cn("flex-shrink-0 border-b px-6 py-2.5 flex items-center gap-3 text-xs", wrapper)}>
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

export default function AppLayout({ children, title, subtitle, headerRight }: AppLayoutProps) {
  const [location] = useLocation();
  const alreadyInsideLayout = useContext(InsideLayoutContext);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const subscriptionStatus = trpc.billing.getSubscriptionStatus.useQuery(undefined, {
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Listen for Chrome extension toolbar click → open advisor panel
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_ADVISOR_PANEL') setAdvisorOpen(true);
    };
    window.addEventListener('message', handleMessage);
    // Also handle ?openAdvisor=1 URL param (set when extension opens a new tab)
    const params = new URLSearchParams(window.location.search);
    if (params.get('openAdvisor') === '1') {
      setAdvisorOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('openAdvisor');
      window.history.replaceState({}, '', url.toString());
    }
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (alreadyInsideLayout) return <>{children}</>;

  return (
    <InsideLayoutContext.Provider value={true}>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Sidebar */}
        <aside className="flex-shrink-0 flex flex-col border-r border-border bg-card" style={{ width: "15.5rem" }}>
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl espn-gradient flex items-center justify-center flex-shrink-0 shadow-lg">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground leading-tight tracking-tight">ATLANTAS FINEST</p>
                <p className="text-[11px] text-muted-foreground leading-tight">GM Command Center</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <div className="flex-1 h-px bg-border" />
              <Badge variant="outline" className="text-[9px] px-2 border-primary/30 text-primary font-mono">2009 – 2026</Badge>
              <div className="flex-1 h-px bg-border" />
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto py-3 px-3">
            {groups.map((group) => {
              const items = navItems.filter((n) => n.group === group);
              return (
                <div key={group} className="mb-4">
                  <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest px-2 mb-1">{group}</p>
                  {items.map((item) => {
                    const isPanel = item.panel === "advisor";
                    const active = isPanel ? advisorOpen : (location === item.href || (item.href !== "/" && location.startsWith(item.href)));
                    const cls = cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 mb-0.5 group w-full text-left",
                      active ? "bg-primary/15 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                    );
                    const inner = (
                      <>
                        <item.icon className={cn("w-4 h-4 flex-shrink-0 transition-colors", active ? "text-primary" : "group-hover:text-foreground")} />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge && <Badge className="text-[8px] px-1 py-0 h-3.5 espn-gradient text-white border-0 font-bold">{item.badge}</Badge>}
                        {active && !isPanel && <ChevronRight className="w-3 h-3 text-primary flex-shrink-0" />}
                      </>
                    );
                    if (isPanel) {
                      return <button key={item.href} onClick={() => setAdvisorOpen(true)} className={cls}>{inner}</button>;
                    }
                    return <Link key={item.href} href={item.href} className={cls}>{inner}</Link>;
                  })}
                </div>
              );
            })}
          </nav>

          <ActiveLeagueFooter />
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {(title || subtitle) && (
            <header className="flex-shrink-0 px-8 py-4 border-b border-border bg-card/50 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div>
                  {title && <h1 className="text-lg font-bold text-foreground tracking-tight">{title}</h1>}
                  {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
                </div>
                {headerRight && <div>{headerRight}</div>}
              </div>
            </header>
          )}
          {subscriptionStatus.data && !subscriptionStatus.data.hasAccess && (
            <PaywallPrompt compact dismissible />
          )}
          <DataHealthBanner />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>

      <AdvisorPanel open={advisorOpen} onClose={() => setAdvisorOpen(false)} />
    </InsideLayoutContext.Provider>
  );
}
