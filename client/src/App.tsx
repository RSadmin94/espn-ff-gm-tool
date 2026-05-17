// FILE: client/src/App.tsx
import { useEffect } from "react";
import { useLocation } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import { trackEvent, checkReturnVisit } from "@/lib/trackEvent";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Dashboard from "./pages/Dashboard";
import Standings from "./pages/Standings";
import Rosters from "./pages/Rosters";
import DraftHistory from "./pages/DraftHistory";
import Keepers from "./pages/Keepers";
import Matchups from "./pages/Matchups";
import TradeAnalyzer from "./pages/TradeAnalyzer";
import WaiverWire from "./pages/WaiverWire";
import Advisor from "./pages/Advisor";
import DataRefresh from "./pages/DataRefresh";
import StartSit from "./pages/StartSit";
import KeeperCalculator from "./pages/KeeperCalculator";
import PlayerProfiles from "./pages/PlayerProfiles";
import OwnerStats from "./pages/OwnerStats";
import UsageMonitor from "./pages/UsageMonitor";
import PickValueCalculator from "./pages/PickValueCalculator";
import DraftPickTracker from "./pages/DraftPickTracker";
import KeeperROI from "./pages/KeeperROI";
import TradeOfferGenerator from "./pages/TradeOfferGenerator";
import DataHealth from "./pages/DataHealth";
import WeeklyStats from "./pages/WeeklyStats";
import LeagueAnalytics from "./pages/LeagueAnalytics";
import ManagerBehavior from "./pages/ManagerBehavior";
import CommandCenter from "@/pages/hubs/CommandCenter";
import DraftWarRoom from "@/pages/hubs/DraftWarRoom";
import KeeperLab from "@/pages/hubs/KeeperLab";
import TradeLab from "@/pages/hubs/TradeLab";
import WaiverLab from "@/pages/hubs/WaiverLab";
import OpponentIntel from "@/pages/hubs/OpponentIntel";
import DataCenter from "@/pages/hubs/DataCenter";
import BacktestingHub from "@/pages/hubs/BacktestingHub";
import GMDecisionMemory from "@/pages/hubs/GMDecisionMemory";
import MLForecast from "@/pages/MLForecast";
import WeeklyIntelligence from "@/pages/hubs/WeeklyIntelligence";
import OffseasonHub from "@/pages/hubs/OffseasonHub";
import LeagueConnect from "@/pages/LeagueConnect";
import Reveal from "@/pages/Reveal";
import BillingSuccess from "@/pages/BillingSuccess";
import BillingCancel from "@/pages/BillingCancel";
import BehavioralAnalytics from "@/pages/BehavioralAnalytics";
import ActivityCaptureDashboard from "@/pages/ActivityCaptureDashboard";

function PageTracker() {
  const [location] = useLocation();
  useEffect(() => {
    trackEvent("page_view", location, { page: location });
  }, [location]);
  return null;
}

function Router() {
  return (
    <>
    <PageTracker />
    <Switch>
      <Route path="/" component={() => { useEffect(() => { window.location.replace("/command-center"); }, []); return null; }} />
      <Route path="/command-center" component={CommandCenter} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/draft-war-room" component={DraftWarRoom} />
      <Route path="/keeper-lab" component={KeeperLab} />
      <Route path="/trade-lab" component={TradeLab} />
      <Route path="/waiver-lab" component={WaiverLab} />
      <Route path="/opponent-intel" component={OpponentIntel} />
      <Route path="/data-center" component={DataCenter} />
      <Route path="/backtesting" component={BacktestingHub} />
      <Route path="/gm-memory" component={GMDecisionMemory} />
      <Route path="/standings" component={Standings} />
      <Route path="/rosters" component={Rosters} />
      <Route path="/draft" component={DraftHistory} />
      <Route path="/keepers" component={Keepers} />
      <Route path="/keeper-calculator" component={KeeperCalculator} />
      <Route path="/matchups" component={Matchups} />
      <Route path="/trade" component={TradeAnalyzer} />
      <Route path="/waiver" component={WaiverWire} />
      <Route path="/advisor" component={Advisor} />
      <Route path="/refresh" component={DataRefresh} />
      <Route path="/startsit" component={StartSit} />
      <Route path="/player-profiles" component={PlayerProfiles} />
      <Route path="/owner-stats" component={OwnerStats} />
      <Route path="/usage-monitor" component={UsageMonitor} />
      <Route path="/pick-value" component={PickValueCalculator} />
      <Route path="/pick-tracker" component={DraftPickTracker} />
      <Route path="/keeper-roi" component={KeeperROI} />
      <Route path="/trade-offer" component={TradeOfferGenerator} />
      <Route path="/data-health" component={DataHealth} />
      <Route path="/weekly-stats" component={WeeklyStats} />
      <Route path="/analytics" component={LeagueAnalytics} />
      <Route path="/manager-behavior" component={ManagerBehavior} />
      <Route path="/ml-forecast" component={MLForecast} />
      <Route path="/weekly-intelligence" component={WeeklyIntelligence} />
      <Route path="/offseason" component={OffseasonHub} />
      <Route path="/connect" component={LeagueConnect} />
      <Route path="/reveal" component={Reveal} />
      <Route path="/billing/success" component={BillingSuccess} />
      <Route path="/billing/cancel" component={BillingCancel} />
      <Route path="/admin/behavioral" component={BehavioralAnalytics} />
      <Route path="/admin/activity-capture" component={ActivityCaptureDashboard} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
    </>
  );
}

function App() {
  // Session start tracking — fires once per browser session
  useEffect(() => {
    const key = "ff_gm_session_tracked";
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      trackEvent("session_start", "app");
      if (checkReturnVisit()) {
        trackEvent("return_visit", "app");
      }
    }
  }, []);

  // Drop-off tracking — fires when user leaves the page
  useEffect(() => {
    const handleDropOff = () => {
      const page = window.location.pathname;
      const timeOnPage = Date.now() - (parseInt(sessionStorage.getItem("ff_gm_page_entered") ?? "0", 10) || Date.now());
      // Use sendBeacon for reliability on page unload
      const payload = JSON.stringify({
        json: {
          eventType: "drop_off",
          featureName: "app",
          page,
          action: "page_exit",
          sessionId: sessionStorage.getItem("ff_gm_session_id"),
          metadata: JSON.stringify({ timeOnPageMs: timeOnPage }),
        },
      });
      navigator.sendBeacon("/api/trpc/usageMonitor.logUIEvent", new Blob([payload], { type: "application/json" }));
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") handleDropOff();
    };
    const handlePageEnter = () => {
      sessionStorage.setItem("ff_gm_page_entered", String(Date.now()));
    };
    window.addEventListener("beforeunload", handleDropOff);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handlePageEnter);
    handlePageEnter();
    return () => {
      window.removeEventListener("beforeunload", handleDropOff);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handlePageEnter);
    };
  }, []);
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
