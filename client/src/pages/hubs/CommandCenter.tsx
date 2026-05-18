// FILE: client/src/pages/hubs/CommandCenter.tsx
import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import TodaysMission from "@/components/TodaysMission";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Dashboard from "@/pages/Dashboard";
import Standings from "@/pages/Standings";
import Matchups from "@/pages/Matchups";
import ChampionshipEquity from "@/pages/ChampionshipEquity";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function currentOpenSeason() {
  return new Date().getFullYear() >= 2026 ? 2026 : 2025;
}

function TrialBanner() {
  const { user } = useAuth();
  const checkoutMutation = trpc.billing.createCheckoutSession.useMutation();

  if (!user) return null;

  const subscriptionStatus = (user as { subscriptionStatus?: string }).subscriptionStatus ?? "free";
  const trialStartedAt = (user as { trialStartedAt?: string | Date | null }).trialStartedAt ?? null;

  // Active subscribers — no banner
  if (subscriptionStatus === "active") return null;

  const handleUpgrade = async () => {
    try {
      const result = await checkoutMutation.mutateAsync({ origin: window.location.origin });
      if (result?.url) window.open(result.url, "_blank");
    } catch (err) {
      console.error("[TrialBanner] Checkout error:", err);
    }
  };

  // Trial active — show days remaining
  if (subscriptionStatus === "trialing" && trialStartedAt) {
    const elapsed = Date.now() - new Date(trialStartedAt).getTime();
    const daysLeft = Math.max(0, Math.ceil((TRIAL_DURATION_MS - elapsed) / (1000 * 60 * 60 * 24)));

    if (daysLeft === 0) {
      return (
        <div className="bg-red-950/60 border-b border-red-800/50 px-6 py-3 flex items-center justify-between gap-4">
          <p className="text-red-300 text-sm font-medium">
            Your free trial has ended. Upgrade to restore full access.
          </p>
          <button
            onClick={handleUpgrade}
            disabled={checkoutMutation.isPending}
            className="shrink-0 px-4 py-1.5 rounded-lg bg-white text-[#0a0a0a] text-xs font-semibold hover:bg-white/90 transition-colors disabled:opacity-60"
          >
            {checkoutMutation.isPending ? "Opening…" : "Upgrade Now →"}
          </button>
        </div>
      );
    }

    return (
      <div className="bg-zinc-900/80 border-b border-zinc-700/50 px-6 py-2.5 flex items-center justify-between gap-4">
        <p className="text-zinc-400 text-sm">
          <span className="text-white font-semibold">{daysLeft} day{daysLeft !== 1 ? "s" : ""}</span> left in your free trial.
        </p>
        <button
          onClick={handleUpgrade}
          disabled={checkoutMutation.isPending}
          className="shrink-0 px-4 py-1.5 rounded-lg bg-white text-[#0a0a0a] text-xs font-semibold hover:bg-white/90 transition-colors disabled:opacity-60"
        >
          {checkoutMutation.isPending ? "Opening…" : "Upgrade — $29/mo →"}
        </button>
      </div>
    );
  }

  // Free tier — no trial started yet
  return (
    <div className="bg-zinc-900/80 border-b border-zinc-700/50 px-6 py-2.5 flex items-center gap-2">
      <p className="text-zinc-400 text-sm">
        Connect your ESPN league to start your{" "}
        <span className="text-white font-semibold">7-day free trial</span>.
      </p>
    </div>
  );
}

function LeagueSyncBanner() {
  const [syncing, setSyncing] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("connected") === "1";
  });
  const utils = trpc.useUtils();
  const season = currentOpenSeason();
  const { data: cachedSeasons } = trpc.espn.cachedSeasons.useQuery(undefined, {
    enabled: syncing,
    refetchInterval: syncing ? 5000 : false,
  });

  useEffect(() => {
    if (!syncing || !cachedSeasons?.includes(season)) return;
    setSyncing(false);
    utils.espn.cachedSeasons.invalidate();
    utils.espn.manifests.invalidate();
    utils.pipeline.health.invalidate();

    const url = new URL(window.location.href);
    url.searchParams.delete("connected");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [cachedSeasons, season, syncing, utils]);

  if (!syncing) return null;

  return (
    <div className="mx-6 mt-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <div>
          <p className="text-sm font-semibold text-foreground">Syncing your league data...</p>
          <p className="text-xs text-muted-foreground">
            Your ESPN league is connected. We are loading the {season} season and this will disappear automatically when data is ready.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CommandCenter() {
  return (
    <AppLayout title="Command Center" subtitle="What matters most this week — and what to do about it">
      <TrialBanner />
      <LeagueSyncBanner />
      <TodaysMission season={2026} />
      <Tabs defaultValue="war-room" className="w-full">
        <div className="px-6 pt-4 border-b border-border">
          <TabsList className="bg-transparent p-0 h-auto gap-1">
            <TabsTrigger value="war-room" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 pb-3 text-sm font-medium">
              War Room
            </TabsTrigger>
            <TabsTrigger value="standings" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 pb-3 text-sm font-medium">
              Standings
            </TabsTrigger>
            <TabsTrigger value="matchups" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 pb-3 text-sm font-medium">
              Matchups
            </TabsTrigger>
            <TabsTrigger value="champ-equity" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 pb-3 text-sm font-medium">
              🏆 Champ Equity
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="war-room" className="mt-0">
          <Dashboard />
        </TabsContent>
        <TabsContent value="standings" className="mt-0">
          <Standings />
        </TabsContent>
        <TabsContent value="matchups" className="mt-0">
          <Matchups />
        </TabsContent>
        <TabsContent value="champ-equity" className="mt-0">
          <ChampionshipEquity />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
