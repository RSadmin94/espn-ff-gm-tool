// FILE: client/src/pages/hubs/WeeklyIntelligence.tsx
/**
 * Weekly Intelligence Hub
 *
 * Full-featured page that renders the weekly assessment engine output:
 *   - League Pulse banner: standings snapshot, desperation scores, transaction activity
 *   - Rod's Opportunity Board: trade targets, waiver pickups, exploit windows
 *   - 14 Team Assessment Cards: DNA badge, threat tier, record, key signals
 *   - Sort/filter controls: by threat tier, desperation, exploitability
 *   - Deep Dive slide-over: full LLM narrative + action items per team
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { trackEvent } from "@/lib/trackEvent";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RefreshCw, Target, AlertTriangle, TrendingUp, TrendingDown,
  Zap, Activity, Search, Trophy, Clock, Users, BarChart2,
  ChevronRight, Flame, Snowflake, Eye, ArrowUpDown, Brain,
  Shield, Star, Crosshair, Loader2, CheckCircle2, XCircle,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import WeeklyStorylinesTab from "@/pages/WeeklyStorylinesTab";

// ─── Types (mirrors server interfaces) ───────────────────────────────────────

interface RodOpportunity {
  type: string;
  targetTeamId: number;
  targetOwner: string;
  action: string;
  urgency: "NOW" | "THIS_WEEK" | "MONITOR";
  reasoning: string;
  desperationScore?: number;
  exploitabilityScore?: number;
}

interface TeamRecommendation {
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  action: string;
  reasoning: string;
}

interface WeeklyRosterPlayer {
  playerId: number;
  playerName: string;
  position: string;
  proTeam: string;
  isStarter: boolean;
  avgPoints: number;
  projectedPoints: number;
  injuryRiskScore: number;
  injuryStatus: string;
  vorp: number;
}

interface WeeklyTransaction {
  type: "ADD" | "DROP" | "TRADE_IN" | "TRADE_OUT";
  playerName: string;
  position: string;
  week: number;
  date: string;
  counterpartOwner?: string;
}

interface WeeklyMatchupResult {
  week: number;
  opponentOwner: string;
  teamScore: number;
  opponentScore: number;
  won: boolean;
}

interface TeamAssessment {
  teamId: number;
  ownerName: string;
  teamName: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  standingRank: number;
  playoffProbability: number;
  rosterHealthScore: number;
  positionalGaps: string[];
  gmArchetype: string;
  exploitabilityScore: number;
  desperationScore: number;
  desperationLabel: string;
  tiltLabel: string;
  tradeWindowStatus: string;
  lastWeekResult: WeeklyMatchupResult | null;
  lastWeekTransactions: WeeklyTransaction[];
  lastWeekSummary: string;
  theirRecommendations: TeamRecommendation[];
  rodOpportunities: RodOpportunity[];
  aiGMBriefing: string;
  starters: WeeklyRosterPlayer[];
  bench: WeeklyRosterPlayer[];
  week: number;
}

// ─── Color / label helpers ────────────────────────────────────────────────────

const ARCHETYPE_COLORS: Record<string, string> = {
  "The Shark":        "bg-red-500/20 text-red-400 border-red-500/30",
  "The Grinder":      "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "The Gambler":      "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "The Builder":      "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "The Analyst":      "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "The Passive":      "bg-slate-500/20 text-slate-400 border-slate-500/30",
  "The Reactive":     "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  "The Contrarian":   "bg-pink-500/20 text-pink-400 border-pink-500/30",
};

function archetypeColor(archetype: string) {
  for (const [key, cls] of Object.entries(ARCHETYPE_COLORS)) {
    if (archetype.includes(key.replace("The ", ""))) return cls;
  }
  return "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

function desperationColor(score: number) {
  if (score >= 70) return { bar: "bg-red-500", badge: "bg-red-500/20 text-red-400 border-red-500/30", text: "text-red-400" };
  if (score >= 45) return { bar: "bg-orange-500", badge: "bg-orange-500/20 text-orange-400 border-orange-500/30", text: "text-orange-400" };
  if (score >= 25) return { bar: "bg-yellow-500", badge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", text: "text-yellow-400" };
  return { bar: "bg-slate-600", badge: "bg-slate-500/20 text-slate-400 border-slate-500/30", text: "text-slate-400" };
}

function threatTierColor(score: number) {
  if (score >= 70) return "border-l-red-500";
  if (score >= 45) return "border-l-orange-500";
  if (score >= 25) return "border-l-yellow-500";
  return "border-l-slate-600";
}

function priorityColor(priority: string) {
  if (priority === "URGENT") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (priority === "HIGH") return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  if (priority === "MEDIUM") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

function urgencyColor(urgency: string) {
  if (urgency === "NOW") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (urgency === "THIS_WEEK") return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  return "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

function oppTypeIcon(type: string) {
  if (type.includes("TRADE")) return <ArrowRight className="w-3 h-3" />;
  if (type.includes("WAIVER")) return <Crosshair className="w-3 h-3" />;
  if (type.includes("EXPLOIT")) return <Zap className="w-3 h-3" />;
  if (type.includes("BUY")) return <TrendingUp className="w-3 h-3" />;
  if (type.includes("SELL")) return <TrendingDown className="w-3 h-3" />;
  return <Target className="w-3 h-3" />;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HealthBar({ score, label }: { score: number; label?: string }) {
  const color = score >= 75 ? "bg-emerald-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right shrink-0">{score}</span>
      {label && <span className="text-xs text-slate-500 shrink-0">{label}</span>}
    </div>
  );
}

function ScorePill({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const pct = (value / max) * 100;
  const color = pct >= 70 ? "text-red-400" : pct >= 45 ? "text-orange-400" : pct >= 25 ? "text-yellow-400" : "text-slate-400";
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

// ─── League Pulse Banner ──────────────────────────────────────────────────────

function LeaguePulseBanner({ season }: { season: number }) {
  const { data, isLoading } = trpc.weeklyAssessment.leaguePulse.useQuery({ season });

  if (isLoading) {
    return (
      <Card className="bg-slate-800/60 border-slate-700/50">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-400 animate-pulse" />
            <CardTitle className="text-sm text-orange-400">League Pulse</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {Array.from({ length: 14 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const hotTeams = data.teams.filter(t => t.desperationScore >= 70);
  const totalTx = data.teams.reduce((s, t) => s + t.lastWeekTransactionCount, 0);

  return (
    <Card className="bg-slate-800/60 border-orange-500/20">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-400" />
            <CardTitle className="text-sm text-orange-400">League Pulse — Week {data.week}</CardTitle>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Flame className="w-3 h-3 text-red-400" />
              <span className="text-red-400 font-medium">{hotTeams.length}</span> desperate
            </span>
            <span className="flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-blue-400" />
              <span className="text-blue-400 font-medium">{totalTx}</span> moves last 7d
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {data.teams.map(team => {
            const dc = desperationColor(team.desperationScore);
            return (
              <div
                key={team.teamId}
                className="bg-slate-900/50 rounded-lg p-2 border border-slate-700/40 hover:border-slate-600/60 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-500 text-xs font-mono">#{team.standingRank}</span>
                  {team.lastWeekTransactionCount > 0 && (
                    <span className="text-xs text-blue-400 font-medium">{team.lastWeekTransactionCount}tx</span>
                  )}
                </div>
                <div className="text-xs text-slate-200 font-medium truncate leading-tight">{team.ownerName}</div>
                <div className="text-xs text-slate-500 mt-0.5">{team.wins}–{team.losses}</div>
                <div className="mt-1.5">
                  <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${dc.bar}`} style={{ width: `${team.desperationScore}%` }} />
                  </div>
                  <div className={`text-xs mt-0.5 ${dc.text}`}>{team.desperationLabel}</div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Rod Opportunity Board ────────────────────────────────────────────────────

function RodOpportunityBoard({ season }: { season: number }) {
  const { data, isLoading } = trpc.weeklyAssessment.rodOpportunities.useQuery({ season });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  const opps = (data as { opportunities?: RodOpportunity[] })?.opportunities ?? (data as RodOpportunity[] | undefined) ?? [];

  if (!opps.length) {
    return (
      <div className="text-center py-12 text-slate-500">
        <Target className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No opportunities identified this week.</p>
        <p className="text-xs mt-1">Check back after the next data refresh.</p>
      </div>
    );
  }

  const nowOpps = opps.filter(o => o.urgency === "NOW");
  const weekOpps = opps.filter(o => o.urgency === "THIS_WEEK");
  const monitorOpps = opps.filter(o => o.urgency === "MONITOR");

  const Section = ({ title, items, icon }: { title: string; items: RodOpportunity[]; icon: React.ReactNode }) => {
    if (!items.length) return null;
    return (
      <div>
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</span>
          <span className="text-xs text-slate-600">({items.length})</span>
        </div>
        <div className="space-y-2">
          {items.map((opp, i) => (
            <Card key={i} className={`bg-slate-800/50 border-slate-700/40 ${opp.urgency === "NOW" ? "border-l-2 border-l-red-500" : opp.urgency === "THIS_WEEK" ? "border-l-2 border-l-orange-500" : ""}`}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${urgencyColor(opp.urgency)}`}>
                      {opp.urgency === "NOW" && <AlertTriangle className="w-3 h-3" />}
                      {opp.urgency}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border bg-slate-700/40 text-slate-400 border-slate-600/40">
                      {oppTypeIcon(opp.type)}
                      {opp.type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 shrink-0">{opp.targetOwner}</span>
                </div>
                <p className="text-sm text-slate-200 font-medium leading-snug mb-1">{opp.action}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{opp.reasoning}</p>
                {(opp.desperationScore !== undefined || opp.exploitabilityScore !== undefined) && (
                  <div className="flex gap-4 mt-2 pt-2 border-t border-slate-700/40">
                    {opp.desperationScore !== undefined && (
                      <span className="text-xs text-slate-500">
                        Desperation: <span className="text-orange-400 font-medium">{opp.desperationScore}/100</span>
                      </span>
                    )}
                    {opp.exploitabilityScore !== undefined && (
                      <span className="text-xs text-slate-500">
                        Exploitability: <span className="text-orange-400 font-medium">{opp.exploitabilityScore}/100</span>
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <Section
        title="Act Now"
        items={nowOpps}
        icon={<AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
      />
      <Section
        title="This Week"
        items={weekOpps}
        icon={<Zap className="w-3.5 h-3.5 text-orange-400" />}
      />
      <Section
        title="Monitor"
        items={monitorOpps}
        icon={<Eye className="w-3.5 h-3.5 text-slate-400" />}
      />
    </div>
  );
}

// ─── Deep Dive Slide-Over ─────────────────────────────────────────────────────

function DeepDiveSheet({
  team,
  open,
  onClose,
  season,
}: {
  team: TeamAssessment | null;
  open: boolean;
  onClose: () => void;
  season: number;
}) {
  const { data: brief, isLoading } = trpc.weeklyAssessment.teamBrief.useQuery(
    { teamId: team?.teamId ?? 0, season },
    { enabled: open && !!team }
  );

  if (!team) return null;

  const dc = desperationColor(team.desperationScore);

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl bg-slate-900 border-slate-700/60 p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-700/50 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="text-slate-100 text-lg">{team.ownerName}</SheetTitle>
              <SheetDescription className="text-slate-400 text-sm mt-0.5">{team.teamName}</SheetDescription>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-bold text-slate-100">{team.wins}–{team.losses}</div>
              <div className="text-xs text-slate-500">#{team.standingRank} · {team.pointsFor.toFixed(0)} pts</div>
            </div>
          </div>
          {/* Key metrics strip */}
          <div className="flex flex-wrap gap-2 mt-3">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${archetypeColor(team.gmArchetype)}`}>
              <Brain className="w-3 h-3" />
              {team.gmArchetype}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${dc.badge}`}>
              {team.desperationScore >= 70 && <Zap className="w-3 h-3" />}
              {team.desperationLabel} · {team.desperationScore}/100
            </span>
            {team.tiltLabel && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border bg-purple-500/20 text-purple-400 border-purple-500/30">
                {team.tiltLabel}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${
              team.tradeWindowStatus === "OPEN"
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                : "bg-slate-500/20 text-slate-400 border-slate-500/30"
            }`}>
              {team.tradeWindowStatus === "OPEN" ? "🟢 Trade Window Open" : "🔴 Window Closed"}
            </span>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-6">

            {/* Score grid */}
            <div className="grid grid-cols-3 gap-3">
              <Card className="bg-slate-800/60 border-slate-700/40">
                <CardContent className="pt-3 pb-3 text-center">
                  <ScorePill value={team.desperationScore} label="Desperation" />
                </CardContent>
              </Card>
              <Card className="bg-slate-800/60 border-slate-700/40">
                <CardContent className="pt-3 pb-3 text-center">
                  <ScorePill value={team.exploitabilityScore} label="Exploitability" />
                </CardContent>
              </Card>
              <Card className="bg-slate-800/60 border-slate-700/40">
                <CardContent className="pt-3 pb-3 text-center">
                  <ScorePill value={team.playoffProbability} label="Playoff %" />
                </CardContent>
              </Card>
            </div>

            {/* Roster health */}
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Roster Health</div>
              <HealthBar score={team.rosterHealthScore} />
              {team.positionalGaps.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {team.positionalGaps.map((gap, i) => (
                    <span key={i} className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded">
                      {gap}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Last week result */}
            {team.lastWeekResult && (
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Last Week</div>
                <div className={`flex items-center gap-3 p-3 rounded-lg border ${
                  team.lastWeekResult.won
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : "bg-red-500/10 border-red-500/30"
                }`}>
                  {team.lastWeekResult.won
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    : <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200">
                      {team.lastWeekResult.won ? "W" : "L"} vs {team.lastWeekResult.opponentOwner}
                    </div>
                    <div className="text-xs text-slate-400">
                      {team.lastWeekResult.teamScore.toFixed(1)} – {team.lastWeekResult.opponentScore.toFixed(1)}
                    </div>
                  </div>
                </div>
                {team.lastWeekSummary && (
                  <p className="text-xs text-slate-400 mt-2 leading-relaxed">{team.lastWeekSummary}</p>
                )}
              </div>
            )}

            {/* Last week transactions */}
            {team.lastWeekTransactions.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Recent Moves ({team.lastWeekTransactions.length})
                </div>
                <div className="space-y-1.5">
                  {team.lastWeekTransactions.map((tx, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium border shrink-0 ${
                        tx.type === "ADD" || tx.type === "TRADE_IN"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : "bg-red-500/20 text-red-400 border-red-500/30"
                      }`}>
                        {tx.type.replace("_", " ")}
                      </span>
                      <span className="text-slate-300">{tx.playerName}</span>
                      <span className="text-slate-500">{tx.position}</span>
                      {tx.counterpartOwner && (
                        <span className="text-slate-500">← {tx.counterpartOwner}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Their recommendations */}
            {team.theirRecommendations.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Their Recommended Moves
                </div>
                <div className="space-y-2">
                  {team.theirRecommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${priorityColor(rec.priority)}`}>
                        {rec.priority}
                      </span>
                      <div>
                        <p className="text-xs text-slate-300">{rec.action}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{rec.reasoning}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rod's opportunities vs this team */}
            {team.rodOpportunities.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Target className="w-3.5 h-3.5" /> Rod's Opportunities
                </div>
                <div className="space-y-2">
                  {team.rodOpportunities.map((opp, i) => (
                    <div key={i} className="bg-slate-800/60 rounded-lg p-3 border border-slate-700/40">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${urgencyColor(opp.urgency)}`}>
                          {opp.urgency === "NOW" && <AlertTriangle className="w-3 h-3" />}
                          {opp.urgency}
                        </span>
                        <span className="text-xs text-slate-500">{opp.type.replace(/_/g, " ")}</span>
                      </div>
                      <p className="text-sm text-slate-200 font-medium mb-1">{opp.action}</p>
                      <p className="text-xs text-slate-400 leading-relaxed">{opp.reasoning}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI GM Briefing */}
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Brain className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-cyan-400">AI GM Briefing</span>
              </div>
              {isLoading ? (
                <div className="flex items-center gap-2 py-4 text-slate-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating deep analysis…
                </div>
              ) : (
                <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-700/40">
                  <div className="prose prose-sm dark:prose-invert max-w-none text-slate-300 text-xs leading-relaxed">
                    <Streamdown>
                      {(brief as TeamAssessment | undefined)?.aiGMBriefing || team.aiGMBriefing || "_No briefing available for this team._"}
                    </Streamdown>
                  </div>
                </div>
              )}
            </div>

            {/* Starters */}
            {team.starters.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Starters</div>
                <div className="space-y-1">
                  {team.starters.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-slate-700/30 last:border-0">
                      <span className="text-slate-500 w-6 shrink-0">{p.position}</span>
                      <span className="text-slate-200 flex-1 truncate">{p.playerName}</span>
                      <span className="text-slate-400">{p.avgPoints.toFixed(1)} avg</span>
                      {p.injuryStatus && p.injuryStatus !== "ACTIVE" && (
                        <span className="text-red-400 text-xs">{p.injuryStatus}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ─── Team Assessment Card ─────────────────────────────────────────────────────

function TeamCard({
  team,
  isRod,
  onDeepDive,
}: {
  team: TeamAssessment;
  isRod: boolean;
  onDeepDive: (team: TeamAssessment) => void;
}) {
  const dc = desperationColor(team.desperationScore);
  const borderAccent = threatTierColor(team.desperationScore);

  return (
    <Card className={`bg-slate-800/60 border-slate-700/50 hover:border-slate-600/60 transition-colors border-l-4 ${borderAccent} ${isRod ? "ring-1 ring-orange-500/30" : ""}`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-500 text-xs font-mono">#{team.standingRank}</span>
              <CardTitle className="text-sm text-slate-100 truncate">{team.ownerName}</CardTitle>
              {isRod && (
                <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs shrink-0">YOU</Badge>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{team.teamName}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-bold text-slate-100">{team.wins}–{team.losses}</div>
            <div className="text-xs text-slate-500">{team.pointsFor.toFixed(0)} pts</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* DNA + window badges */}
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${archetypeColor(team.gmArchetype)}`}>
            <Brain className="w-3 h-3" />
            {team.gmArchetype}
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${dc.badge}`}>
            {team.desperationScore >= 70 && <Flame className="w-3 h-3" />}
            {team.desperationScore < 25 && <Snowflake className="w-3 h-3" />}
            {team.desperationLabel}
          </span>
        </div>

        {/* Desperation + health */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Desperation</span>
            <span className={dc.text}>{team.desperationScore}/100</span>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${dc.bar}`} style={{ width: `${team.desperationScore}%` }} />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Roster Health</span>
            <span>{team.rosterHealthScore}/100</span>
          </div>
          <HealthBar score={team.rosterHealthScore} />
        </div>

        {/* Trade window */}
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${
            team.tradeWindowStatus === "OPEN"
              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
              : "bg-slate-500/20 text-slate-400 border-slate-500/30"
          }`}>
            {team.tradeWindowStatus === "OPEN" ? "🟢 Trade Open" : "🔴 Closed"}
          </span>
          <span className="text-xs text-slate-500">{team.playoffProbability}% playoff</span>
        </div>

        {/* Last week summary */}
        {team.lastWeekSummary && (
          <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{team.lastWeekSummary}</p>
        )}

        {/* Rod opportunities teaser */}
        {!isRod && team.rodOpportunities.length > 0 && (
          <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-2">
            <div className="flex items-center gap-1 mb-1">
              <Target className="w-3 h-3 text-orange-400" />
              <span className="text-xs font-medium text-orange-400">
                {team.rodOpportunities.length} opportunit{team.rodOpportunities.length === 1 ? "y" : "ies"}
              </span>
            </div>
            <p className="text-xs text-slate-300 line-clamp-1">{team.rodOpportunities[0].action}</p>
          </div>
        )}

        {/* Deep Dive button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs gap-1.5 border-slate-600/60 hover:border-slate-500/80 hover:bg-slate-700/40"
          onClick={() => onDeepDive(team)}
        >
          <Eye className="w-3 h-3" />
          Deep Dive
          <ChevronRight className="w-3 h-3 ml-auto" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Rivalry Heat Panel ─────────────────────────────────────────────────────

function RivalryHeatPanel() {
  useEffect(() => { trackEvent("feature_open", "rivalry"); }, []);
  const { data: scores, isLoading } = trpc.rivalry.getScores.useQuery(undefined, {
    staleTime: 1000 * 60 * 10,
  });
  const refreshMutation = trpc.rivalry.refresh.useMutation({
    onSuccess: (res) => toast.success(`Rivalry scores updated (${res.count} pairs)`),
    onError: () => toast.error("Failed to refresh rivalry scores"),
  });

  const heatColor = (label: string) => {
    if (label === "Inferno") return "bg-red-500/20 text-red-400 border-red-500/30";
    if (label === "Burning") return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    if (label === "Heated") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    if (label === "Simmering") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-slate-700/40 text-slate-400 border-slate-600/30";
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    );
  }

  if (!scores || scores.length === 0) {
    return (
      <div className="text-center py-16 text-slate-500">
        <Flame className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium mb-1">No rivalry data yet</p>
        <p className="text-xs mb-4">Rivalry scores are computed after each data refresh.</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
        >
          {refreshMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          Compute Now
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Rivalry Rankings</h3>
          <p className="text-xs text-slate-500">Sorted by rivalry score — based on H2H losses, playoff eliminations, close matchups, and trade outcomes.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
        >
          {refreshMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Refresh
        </Button>
      </div>

      <div className="space-y-3">
        {scores.map((r, idx) => (
          <Card key={r.rivalId} className="bg-slate-800/40 border-slate-700/40">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-slate-500 text-xs font-mono w-5 shrink-0">#{idx + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-slate-100 font-semibold text-sm truncate">{r.rivalName}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${heatColor(r.heatLabel)}`}>
                        {r.heatLabel}
                      </span>
                    </div>
                    {r.loreSentence && (
                      <p className="text-slate-400 text-xs leading-relaxed italic mb-2">"{r.loreSentence}"</p>
                    )}
                    <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                      <span>H2H: <span className="text-slate-300">{r.h2hWins}W–{r.h2hLosses}L</span></span>
                      {r.playoffEliminations > 0 && (
                        <span>Playoff elims: <span className="text-red-400">{r.playoffEliminations}</span></span>
                      )}
                      {r.closeLossCount > 0 && (
                        <span>Close losses: <span className="text-orange-400">{r.closeLossCount}</span></span>
                      )}
                      {r.tradeVerdictLosses > 0 && (
                        <span>Trade losses: <span className="text-yellow-400">{r.tradeVerdictLosses}</span></span>
                      )}
                      {r.painfulLossSeason && (
                        <span>Worst: <span className="text-slate-300">{r.painfulLossSeason} (–{r.painfulLossMargin?.toFixed(1)} pts)</span></span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold text-slate-100">{r.rivalryScore}</div>
                  <div className="text-[10px] text-slate-500">score</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type SortKey = "standing" | "desperation" | "exploitability" | "health";
type FilterKey = "all" | "open_window" | "desperate" | "opportunity";

export default function WeeklyIntelligence() {
  // Track feature open
  useEffect(() => { trackEvent("feature_open", "weekly_intel"); }, []);
  const [season] = useState(2025);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("standing");
  const [filterBy, setFilterBy] = useState<FilterKey>("all");
  const [forceRefresh, setForceRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState("storylines");
  const [deepDiveTeam, setDeepDiveTeam] = useState<TeamAssessment | null>(null);

  // ── Batch run state ──
  const [batchJobId, setBatchJobId] = useState<string | null>(null);
  const [showBatchPanel, setShowBatchPanel] = useState(false);

  const batchRunMutation = trpc.weeklyAssessment.batchRunAssessment.useMutation({
    onSuccess: (result) => {
      if (!result) return;
      setBatchJobId(result.jobId);
      setShowBatchPanel(true);
      toast.info(`Batch started — assessing ${result.teamCount} teams…`);
    },
    onError: (err) => {
      toast.error(`Batch failed: ${err.message}`);
    },
  });

  const batchStatusQuery = trpc.weeklyAssessment.batchStatus.useQuery(
    { jobId: batchJobId ?? "" },
    {
      enabled: !!batchJobId,
      refetchInterval: (query) => {
        const d = query.state.data;
        if (d?.done) return false;
        return 2500;
      },
      staleTime: 0,
    }
  );

  const batchStatus = batchStatusQuery.data;
  const prevBatchDone = useRef(false);
  useEffect(() => {
    if (batchStatus?.done && !prevBatchDone.current) {
      prevBatchDone.current = true;
      const success = batchStatus.successCount;
      const errors = batchStatus.errorCount;
      toast.success(`Batch complete — ${success} teams assessed${errors > 0 ? `, ${errors} errors` : ""}`);
      setForceRefresh(true);
      refetch().then(() => setForceRefresh(false));
    }
    if (!batchStatus?.done) prevBatchDone.current = false;
  }, [batchStatus?.done]);

  const { data, isLoading, refetch } = trpc.weeklyAssessment.fullReport.useQuery(
    { season, forceRefresh },
    { staleTime: 30 * 60 * 1000 }
  );

  const handleRefresh = () => {
    setForceRefresh(true);
    refetch().then(() => {
      setForceRefresh(false);
      toast.success("Weekly report refreshed");
    });
  };

  const rodTeamId = data?.rodTeamId ?? null;

  const filteredTeams = useMemo(() => {
    if (!data?.teams) return [];
    let teams = [...data.teams] as TeamAssessment[];

    // Search
    if (search) {
      const q = search.toLowerCase();
      teams = teams.filter(t =>
        t.ownerName.toLowerCase().includes(q) || t.teamName.toLowerCase().includes(q)
      );
    }

    // Filter
    if (filterBy === "open_window") teams = teams.filter(t => t.tradeWindowStatus === "OPEN");
    else if (filterBy === "desperate") teams = teams.filter(t => t.desperationScore >= 45);
    else if (filterBy === "opportunity") teams = teams.filter(t => t.rodOpportunities.length > 0);

    // Sort
    if (sortBy === "standing") teams.sort((a, b) => a.standingRank - b.standingRank);
    else if (sortBy === "desperation") teams.sort((a, b) => b.desperationScore - a.desperationScore);
    else if (sortBy === "exploitability") teams.sort((a, b) => b.exploitabilityScore - a.exploitabilityScore);
    else if (sortBy === "health") teams.sort((a, b) => a.rosterHealthScore - b.rosterHealthScore);

    return teams;
  }, [data?.teams, search, sortBy, filterBy]);

  const openTradeWindows = data?.teams.filter(t => t.tradeWindowStatus === "OPEN").length ?? 0;
  const desperateTeams = data?.teams.filter(t => t.desperationScore >= 70).length ?? 0;

  return (
    <AppLayout
      title="Weekly Intelligence"
      subtitle={`Season ${season} — Week ${data?.week ?? "…"} GM Briefing`}
    >
      <div className="space-y-4 sm:space-y-5">

        {/* ── Header controls ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {data && (
              <>
                <span>Generated {new Date(data.generatedAt).toLocaleString()}</span>
                {data.fromCache && (
                  <span className="bg-slate-700/40 text-slate-400 border border-slate-600/40 px-2 py-0.5 rounded">cached</span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
              className="gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? "Generating…" : "Refresh Report"}
            </Button>
            <Button
              size="sm"
              onClick={() => batchRunMutation.mutate({ season })}
              disabled={batchRunMutation.isPending || (!!batchJobId && !batchStatus?.done)}
              className="gap-1.5 bg-orange-600 hover:bg-orange-500 text-white border-0"
            >
              {batchRunMutation.isPending || (!!batchJobId && !batchStatus?.done) ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
              ) : (
                <><Zap className="w-3.5 h-3.5" /> Run All 14 Teams</>
              )}
            </Button>
            {batchJobId && (
              <button
                onClick={() => setShowBatchPanel(v => !v)}
                className="text-xs text-slate-400 hover:text-slate-200 underline"
              >
                {showBatchPanel ? "Hide progress" : "Show progress"}
              </button>
            )}
          </div>
        </div>

        {/* ── Batch Progress Panel ── */}
        {showBatchPanel && batchJobId && (
          <Card className="bg-slate-800/60 border-orange-500/30">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {batchStatus?.done ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />
                  )}
                  <CardTitle className="text-sm text-orange-400">
                    {batchStatus?.done
                      ? `Assessment Complete — ${batchStatus.successCount}/${batchStatus.totalCount} teams`
                      : `Running Assessment — ${batchStatus?.completedCount ?? 0}/${batchStatus?.totalCount ?? 14} teams`
                    }
                  </CardTitle>
                </div>
                {batchStatus && (
                  <span className="text-xs text-slate-500">
                    {batchStatus.done && batchStatus.completedAt
                      ? `Completed in ${Math.round((batchStatus.completedAt - (batchStatus.completedAt - (batchStatus.elapsedMs ?? 0))) / 1000)}s`
                      : `${Math.round((batchStatus.elapsedMs ?? 0) / 1000)}s elapsed`
                    }
                  </span>
                )}
              </div>
              {/* Progress bar */}
              {batchStatus && (
                <div className="mt-2">
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        batchStatus.done ? "bg-emerald-500" : "bg-orange-500"
                      }`}
                      style={{ width: `${Math.round(((batchStatus.completedCount ?? 0) / (batchStatus.totalCount || 14)) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>{batchStatus.completedCount ?? 0} done</span>
                    {batchStatus.errorCount > 0 && (
                      <span className="text-red-400">{batchStatus.errorCount} errors</span>
                    )}
                    <span>{batchStatus.totalCount} total</span>
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-1.5">
                {(batchStatus?.teams ?? []).map(t => (
                  <div
                    key={t.teamId}
                    className={`rounded-md px-2 py-1.5 border text-xs flex items-center gap-1.5 ${
                      t.status === "done" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
                      t.status === "error" ? "bg-red-500/10 border-red-500/30 text-red-400" :
                      t.status === "running" ? "bg-orange-500/10 border-orange-500/30 text-orange-400" :
                      "bg-slate-700/30 border-slate-600/30 text-slate-500"
                    }`}
                  >
                    {t.status === "done" && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                    {t.status === "error" && <XCircle className="w-3 h-3 shrink-0" />}
                    {t.status === "running" && <Loader2 className="w-3 h-3 shrink-0 animate-spin" />}
                    {t.status === "pending" && <Clock className="w-3 h-3 shrink-0" />}
                    <span className="truncate">{t.ownerName}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── League Pulse Banner ── */}
        <LeaguePulseBanner season={season} />

        {/* ── Summary stats ── */}
        {data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Teams Assessed", value: data.teams.length, icon: Users, color: "text-blue-400" },
              { label: "Week", value: data.week, icon: Clock, color: "text-slate-400" },
              { label: "Trade Windows Open", value: openTradeWindows, icon: TrendingUp, color: "text-emerald-400" },
              { label: "Desperate Teams", value: desperateTeams, icon: Flame, color: "text-red-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="bg-slate-800/40 border-slate-700/40">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <div>
                      <div className={`text-lg font-bold ${color}`}>{value}</div>
                      <div className="text-xs text-slate-500">{label}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : null}

        {/* ── League Executive Summary ── */}
        {data?.leagueSummary && (
          <Card className="bg-slate-800/60 border-cyan-500/20">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <BarChart2 className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-medium text-cyan-400">League Executive Summary</span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">{data.leagueSummary}</p>
            </CardContent>
          </Card>
        )}

        {/* ── Main tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-slate-800/60 border border-slate-700/40 h-auto flex-wrap gap-0.5 p-1">
            <TabsTrigger value="storylines" className="text-xs gap-1 h-8">
              <Zap className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Storylines</span><span className="sm:hidden">Stories</span>
            </TabsTrigger>
            <TabsTrigger value="teams" className="text-xs gap-1 h-8">
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">All Teams</span><span className="sm:hidden">Teams</span>
            </TabsTrigger>
            <TabsTrigger value="opportunities" className="text-xs gap-1 h-8">
              <Target className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Rod's Opportunities</span><span className="sm:hidden">Opps</span>
            </TabsTrigger>
            <TabsTrigger value="rivalry" className="text-xs gap-1 h-8">
              <Flame className="w-3.5 h-3.5" />
              <span>Rivalry</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Storylines tab (Sprint 3 landing view) ── */}
          <TabsContent value="storylines" className="mt-4">
            <WeeklyStorylinesTab season={season} />
          </TabsContent>
          {/* ── All Teams tab ── */}
          <TabsContent value="teams" className="mt-4 space-y-4">

            {/* Sort + filter bar */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <Input
                  placeholder="Search owner or team…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 text-xs bg-slate-800/60 border-slate-700/40"
                />
              </div>

              {/* Filter buttons */}
              <div className="flex gap-1 flex-wrap">
                {([
                  { key: "all", label: "All" },
                  { key: "open_window", label: "Trade Open" },
                  { key: "desperate", label: "Desperate" },
                  { key: "opportunity", label: "Has Opportunity" },
                ] as { key: FilterKey; label: string }[]).map(({ key, label }) => (
                  <Button
                    key={key}
                    variant={filterBy === key ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setFilterBy(key)}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              {/* Sort buttons */}
              <div className="flex gap-1 flex-wrap">
                <span className="text-xs text-slate-500 self-center">Sort:</span>
                {([
                  { key: "standing", label: "Rank" },
                  { key: "desperation", label: "Desperation" },
                  { key: "exploitability", label: "Exploit" },
                  { key: "health", label: "Health ↑" },
                ] as { key: SortKey; label: string }[]).map(({ key, label }) => (
                  <Button
                    key={key}
                    variant={sortBy === key ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setSortBy(key)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Team cards grid */}
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {Array.from({ length: 14 }).map((_, i) => (
                  <Card key={i} className="bg-slate-800/40 border-slate-700/40">
                    <CardContent className="pt-4 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-2 w-full" />
                      <Skeleton className="h-2 w-3/4" />
                      <Skeleton className="h-8 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {filteredTeams.map(team => (
                  <TeamCard
                    key={team.teamId}
                    team={team}
                    isRod={team.teamId === rodTeamId}
                    onDeepDive={setDeepDiveTeam}
                  />
                ))}
                {filteredTeams.length === 0 && (
                  <div className="col-span-full text-center py-12 text-slate-500">
                    <Shield className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No teams match your filters.</p>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── Rod's Opportunities tab ── */}
          <TabsContent value="opportunities" className="mt-4">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
              </div>
            ) : (
              <RodOpportunityBoard season={season} />
            )}
          </TabsContent>

          {/* ── Rivalry Heat tab ── */}
          <TabsContent value="rivalry" className="mt-4">
            <RivalryHeatPanel />
          </TabsContent>
        </Tabs>

      </div>

      {/* ── Deep Dive Slide-Over ── */}
      <DeepDiveSheet
        team={deepDiveTeam}
        open={!!deepDiveTeam}
        onClose={() => setDeepDiveTeam(null)}
        season={season}
      />
    </AppLayout>
  );
}
